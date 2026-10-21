import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { Readable, Writable } from "node:stream"
import * as acp from "@agentclientprotocol/sdk"
import {
  type AssistantConnectionTestResult,
  type AssistantErrorCode,
  assistantConnectionTestResultSchema,
  assistantConnectionTestSchema,
} from "@vibeshape/automation-api/assistant"
import type { z } from "zod"
import type { AssistantServiceOptions } from "./assistant-service"
import {
  type AssistantProcessLaunch,
  assistantConnectionFailure,
  killAssistantProcess,
  spawnAssistantProcess,
  waitForAssistantSpawn,
} from "./assistant-transport"

class ProbeFailure extends Error {
  constructor(readonly code: AssistantErrorCode) {
    super(code)
  }
}

type ProbeInput = z.infer<typeof assistantConnectionTestSchema>

function resolveProbeLaunch(
  options: AssistantServiceOptions,
  input: ProbeInput,
): AssistantProcessLaunch {
  if (options.resolveLaunch) {
    const resolved = options.resolveLaunch(input.projectId, input.agent, input.jevCredentials, {
      testConnection: true,
    })
    if (!resolved.ok) throw new ProbeFailure(resolved.code)
    return resolved.launch
  }
  if ("command" in input.agent) return { agent: input.agent }
  throw new ProbeFailure("jev-configuration-required")
}

function captureProbeOutput(
  child: ChildProcessWithoutNullStreams,
  builtin: boolean,
  fail: (code: AssistantErrorCode) => void,
) {
  let output = ""
  let bytes = 0
  const count = (chunk: Buffer) => {
    bytes += chunk.byteLength
    if (bytes > 64 * 1024) fail("protocol-error")
  }
  child.stdout.on("data", (chunk: Buffer) => {
    count(chunk)
    if (builtin && bytes <= 64 * 1024) output += chunk.toString("utf8")
  })
  child.stderr.on("data", count)
  const exited = new Promise<number | null>((resolve) => child.once("close", resolve))
  return async (helper: boolean): Promise<AssistantConnectionTestResult> => {
    if ((await exited) !== 0) throw new ProbeFailure("agent-exited")
    let payload: unknown
    try {
      payload = JSON.parse(output)
    } catch {
      throw new ProbeFailure("protocol-error")
    }
    const result = assistantConnectionTestResultSchema.safeParse(payload)
    if (!result.success) throw new ProbeFailure("protocol-error")
    const checks = helper ? ["agent", "jev", "arguments"] : ["agent", "jev"]
    if (result.data.ok && JSON.stringify(result.data.checks) !== JSON.stringify(checks))
      throw new ProbeFailure("protocol-error")
    return result.data
  }
}

function initializeProbeAgent(
  child: ChildProcessWithoutNullStreams,
  applicationVersion: string,
  fail: (code: AssistantErrorCode) => void,
) {
  const connection = acp.client({ name: "vibeshape-connection-test" }).connect(
    acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout), {
      maxMessageBytes: 64 * 1024,
    }),
  )
  void connection.closed.then(() => fail(assistantConnectionFailure(connection.signal.reason)))
  const initialized = connection.agent
    .request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientInfo: { name: "vibeshape", version: applicationVersion },
      clientCapabilities: {},
    })
    .then((init): AssistantConnectionTestResult => {
      if (init.protocolVersion !== acp.PROTOCOL_VERSION) throw new ProbeFailure("protocol-error")
      return { ok: true, checks: ["agent"] }
    })
  return { connection, initialized }
}

function probeFailureCode(error: unknown, launched: boolean): AssistantErrorCode {
  if (error instanceof ProbeFailure) return error.code
  if (error instanceof acp.RequestError) return "initialization-failed"
  return launched ? "protocol-error" : "launch-failed"
}

// Probes own no chat session or MCP attachment, even when that project is connected.
export function createAssistantConnectionTests(options: AssistantServiceOptions) {
  const pending = new Map<
    string,
    { cancel: () => void; done: Promise<AssistantConnectionTestResult> }
  >()
  let closed = false

  async function probe(
    input: ProbeInput,
    signal: AbortSignal,
  ): Promise<AssistantConnectionTestResult> {
    let child: ChildProcessWithoutNullStreams | undefined
    let connection: acp.ClientConnection | undefined
    let finished = false
    let rejectFailure: (error: ProbeFailure) => void = () => {}
    const failed = new Promise<never>((_, reject) => {
      rejectFailure = reject
    })
    const fail = (code: AssistantErrorCode) => rejectFailure(new ProbeFailure(code))
    const abort = () => fail("stale-session")
    signal.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(
      () => fail("timeout"),
      Math.min(options.connectionTestTimeoutMs ?? 30_000, 60_000),
    )
    try {
      const launch = resolveProbeLaunch(options, input)
      const builtin = "kind" in input.agent
      const processChild = spawnAssistantProcess({ ...options, ...launch }, (code) => {
        // A one-shot probe reports on stdout and exits; read it on close, after pipe drainage.
        if (!builtin || code !== "agent-exited") fail(code)
      })
      child = processChild
      const providerResult = captureProbeOutput(child, builtin, fail)
      const run = async (): Promise<AssistantConnectionTestResult> => {
        await waitForAssistantSpawn(processChild)
        if (finished) throw new ProbeFailure("stale-session")
        if ("kind" in input.agent) {
          return providerResult(Boolean(input.agent.settings.argumentsEndpoint))
        }
        const external = initializeProbeAgent(processChild, options.applicationVersion, fail)
        connection = external.connection
        return external.initialized
      }
      return await Promise.race([run(), failed])
    } catch (error) {
      return {
        ok: false,
        code: probeFailureCode(error, child !== undefined),
        stage: "agent",
      }
    } finally {
      finished = true
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      connection?.close()
      if (child) await killAssistantProcess(child)
    }
  }

  return {
    async testConnection(payload: unknown): Promise<AssistantConnectionTestResult> {
      const parsed = assistantConnectionTestSchema.safeParse(payload)
      if (!parsed.success) return { ok: false, code: "invalid-request", stage: "agent" }
      if (closed) return { ok: false, code: "stale-session", stage: "agent" }
      if (pending.has(parsed.data.projectId))
        return { ok: false, code: "agent-busy", stage: "agent" }
      const controller = new AbortController()
      const done = probe(parsed.data, controller.signal)
      pending.set(parsed.data.projectId, { cancel: () => controller.abort(), done })
      try {
        return await done
      } finally {
        pending.delete(parsed.data.projectId)
      }
    },
    async close() {
      closed = true
      for (const test of pending.values()) test.cancel()
      await Promise.all([...pending.values()].map((test) => test.done))
    },
  }
}
