import { afterEach, describe, expect, test } from "bun:test"
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AssistantEvent } from "@vibeshape/automation-api/assistant"
import { assistantJevAgentSchema } from "@vibeshape/automation-api/assistant-jev"
import { vi } from "../../../tests/unit/support/bun-test"
import { createAssistantLaunchResolver } from "./assistant-jev-runtime"
import { type AssistantServiceOptions, createAssistantService } from "./assistant-service"

const fixture = String.raw`
const fs = require("node:fs");
const scenario = process.env.PROBE_SCENARIO || process.argv[2];
const reply = (id,result) => process.stdout.write(JSON.stringify({jsonrpc:"2.0",id,result})+"\n");
if (process.argv.includes("--test-connection")) {
  if (scenario === "hang") setInterval(()=>{},1000);
  else if (scenario === "controlled") require("node:readline").createInterface({input:process.stdin}).once("line",()=>{
    process.stdout.write(JSON.stringify({ok:true,checks:["agent","jev","arguments"]})+"\n",()=>process.exit(0));
  });
  else if (scenario === "overflow") process.stdout.write("x".repeat(70*1024));
  else if (scenario === "malformed") console.log(JSON.stringify({ok:false,stage:"jev",code:"request-failed",message:"private secret"}));
  else if (scenario === "weak-success") console.log(JSON.stringify({ok:true,checks:["agent"]}));
  else console.log(JSON.stringify(scenario === "failure" ? {ok:false,stage:"arguments",code:"request-failed",httpStatus:401} : {ok:true,checks:process.env.JEV_ARGUMENTS_AGENT ? ["agent","jev","arguments"] : ["agent","jev"]}));
} else {
 require("node:readline").createInterface({input:process.stdin}).on("line",line=>{
   const {id,method,params} = JSON.parse(line);
   fs.appendFileSync("calls.jsonl",JSON.stringify({method,params})+"\n");
   if (method === "initialize") {
     if (scenario === "hang") return;
     if (scenario === "stderr-overflow") return process.stderr.write("x".repeat(70*1024));
     if (scenario === "overflow") return process.stdout.write("x".repeat(70*1024));
     if (scenario === "exit") return process.exit(3);
     if (scenario === "malformed") return process.stdout.write('[{"jsonrpc":"2.0","method":"invalid-batch"}]\n');
     return reply(id,{protocolVersion:scenario === "bad-version" ? 999 : 1});
   }
   if (method === "session/new") return reply(id,{sessionId:"active-session"});
   if (method === "session/prompt") return reply(id,{stopReason:"end_turn"});
   process.exit(11);
 });
}
`
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function host({
  productionProbeDeadline = false,
  ...overrides
}: Partial<AssistantServiceOptions> & { productionProbeDeadline?: boolean } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "vibeshape-probe-"))
  cleanup.push(() => rm(cwd, { recursive: true, force: true }))
  const script = join(cwd, "jev.cjs")
  await writeFile(script, fixture)
  const children: ChildProcessWithoutNullStreams[] = []
  const events: AssistantEvent[] = []
  let attachments = 0
  const service = createAssistantService({
    cwd,
    applicationVersion: "1.2.3",
    ...(productionProbeDeadline ? {} : { connectionTestTimeoutMs: 2000 }),
    getMcpSetup: async () => {
      attachments += 1
      return {
        protocolVersion: 1,
        mcpServers: {
          vibeshape: {
            command: "/electron",
            args: ["/mcp.cjs", "--descriptor", "/descriptor.json"],
            env: { ELECTRON_RUN_AS_NODE: "1" },
          },
        },
      }
    },
    onEvent: (event) => {
      events.push(event)
    },
    spawn: ((...args: Parameters<typeof spawn>) => {
      const child = spawn(...args) as ChildProcessWithoutNullStreams
      children.push(child)
      return child
    }) as typeof spawn,
    ...overrides,
  })
  cleanup.push(() => service.close())
  return {
    cwd,
    service,
    events,
    children,
    agent: (scenario = "success") => ({ command: process.execPath, args: [script, scenario] }),
    attachments: () => attachments,
    calls: async () =>
      (await readFile(join(cwd, "calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
  }
}

describe("isolated desktop connection tests", () => {
  test.skipIf(process.platform !== "win32")(
    "allows a Windows local helper probe to finish after cold startup",
    async () => {
      const f = await host({
        productionProbeDeadline: true,
        resolveLaunch: () => ({
          ok: true,
          launch: {
            agent: {
              command: process.execPath,
              args: [join(f.cwd, "jev.cjs"), "--test-connection"],
            },
            env: { ...process.env, PROBE_SCENARIO: "controlled" },
          },
        }),
      })
      vi.useFakeTimers()
      try {
        const pending = f.service.testConnection({
          projectId: "project",
          agent: assistantJevAgentSchema.parse({
            kind: "jev",
            settings: { argumentsAgent: { command: "codex-acp", args: [] } },
          }),
        })
        const child = f.children[0]
        if (!child) throw new Error("Missing probe process.")
        child.stdin.on("error", () => {})
        await once(child, "spawn")
        vi.advanceTimersByTime(31_000)
        vi.useRealTimers()
        child.stdin.end("complete\n")
        expect(await pending).toEqual({ ok: true, checks: ["agent", "jev", "arguments"] })
      } finally {
        vi.useRealTimers()
      }
    },
  )
  test("probes an adapter handshake without session or CAD attachment and cleans its process", async () => {
    const f = await host()
    expect(await f.service.testConnection({ projectId: "project", agent: f.agent() })).toEqual({
      ok: true,
      checks: ["agent"],
    })
    expect(await f.calls()).toEqual([
      {
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientInfo: { name: "vibeshape", version: "1.2.3" },
          clientCapabilities: {},
        },
      },
    ])
    expect(f.attachments()).toBe(0)
    expect(f.events).toEqual([])
    expect(f.children[0]?.exitCode !== null || f.children[0]?.signalCode !== null).toBe(true)
  })

  test("does not replace an active connection or emit history events", async () => {
    const f = await host()
    const connected = await f.service.handle({
      operation: "connect",
      input: { projectId: "project", agent: f.agent() },
    })
    if (!connected.ok) throw new Error("Failed fixture connection.")
    const before = [...f.events]
    expect(await f.service.testConnection({ projectId: "project", agent: f.agent() })).toEqual({
      ok: true,
      checks: ["agent"],
    })
    expect(f.events).toEqual(before)
    expect(f.attachments()).toBe(1)
    expect(f.children[0]?.exitCode).toBeNull()
    expect(
      await f.service.handle({
        operation: "prompt",
        input: {
          projectId: "project",
          sessionToken: connected.value.sessionToken,
          text: "still connected",
        },
      }),
    ).toMatchObject({
      ok: true,
      value: { sessionToken: connected.value.sessionToken, status: "ready" },
    })
  })

  test("rejects malformed input before spawning and reports unavailable built-in credentials", async () => {
    const f = await host()
    expect(
      await f.service.testConnection({ projectId: "project", agent: { command: "", args: [] } }),
    ).toEqual({ ok: false, code: "invalid-request", stage: "agent" })
    expect(
      await f.service.testConnection({
        projectId: "project",
        agent: f.agent(),
        jevCredentials: { apiKey: "secret" },
      }),
    ).toEqual({ ok: false, code: "invalid-request", stage: "agent" })
    expect(
      await f.service.testConnection({
        projectId: "project",
        agent: assistantJevAgentSchema.parse({ kind: "jev", settings: {} }),
      }),
    ).toEqual({ ok: false, code: "jev-configuration-required", stage: "agent" })
    expect(f.children).toHaveLength(0)
  })

  test("releases the project lock after launch failure so the user can retry", async () => {
    const f = await host()
    expect(
      await f.service.testConnection({
        projectId: "project",
        agent: { command: join(f.cwd, "missing-adapter"), args: [] },
      }),
    ).toEqual({ ok: false, code: "launch-failed", stage: "agent" })
    expect(await f.service.testConnection({ projectId: "project", agent: f.agent() })).toEqual({
      ok: true,
      checks: ["agent"],
    })
  })

  test("enforces one probe per project, allows other projects, and cancels during service shutdown", async () => {
    const f = await host()
    const first = f.service.testConnection({ projectId: "one", agent: f.agent("hang") })
    expect(await f.service.testConnection({ projectId: "one", agent: f.agent() })).toEqual({
      ok: false,
      code: "agent-busy",
      stage: "agent",
    })
    expect(await f.service.testConnection({ projectId: "two", agent: f.agent() })).toEqual({
      ok: true,
      checks: ["agent"],
    })
    await f.service.close()
    expect(await first).toEqual({ ok: false, code: "stale-session", stage: "agent" })
    expect(await f.service.testConnection({ projectId: "one", agent: f.agent() })).toEqual({
      ok: false,
      code: "stale-session",
      stage: "agent",
    })
    for (const child of f.children)
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })

  test.each([
    ["hang", "timeout"],
    ["overflow", "protocol-error"],
    ["stderr-overflow", "protocol-error"],
    ["malformed", "protocol-error"],
    ["bad-version", "protocol-error"],
    ["exit", "agent-exited"],
  ] as const)("bounds and cleans a failing external agent (%s)", async (scenario, code) => {
    const f = await host({ connectionTestTimeoutMs: scenario === "hang" ? 60 : 2000 })
    expect(
      await f.service.testConnection({ projectId: "project", agent: f.agent(scenario) }),
    ).toEqual({ ok: false, stage: "agent", code })
    expect(f.children[0]?.exitCode !== null || f.children[0]?.signalCode !== null).toBe(true)
    expect(f.events).toEqual([])
  })

  test.each([
    "success",
    "local-helper",
    "failure",
    "malformed",
    "weak-success",
    "overflow",
    "hang",
  ])("validates built-in process output (%s) without a CAD connection", async (scenario) => {
    const f = await host({ connectionTestTimeoutMs: scenario === "hang" ? 60 : 2000 })
    const resolver = createAssistantLaunchResolver({
      executable: process.execPath,
      runtimeDirectory: f.cwd,
      env: { TYPESAFE_API_KEY: "test-key" },
    })
    const service = createAssistantService({
      cwd: f.cwd,
      applicationVersion: "1",
      getMcpSetup: async () => {
        throw new Error("Probe must not attach CAD.")
      },
      onEvent: () => {
        throw new Error("Probe must not emit events.")
      },
      connectionTestTimeoutMs: scenario === "hang" ? 60 : 2000,
      resolveLaunch: (...args) => {
        const result = resolver(...args)
        if (result.ok) result.launch.env = { ...result.launch.env, PROBE_SCENARIO: scenario }
        return result
      },
    })
    cleanup.push(() => service.close())
    expect(
      await service.testConnection({
        projectId: "project",
        agent: assistantJevAgentSchema.parse({
          kind: "jev",
          settings:
            scenario === "local-helper"
              ? { argumentsAgent: { command: "codex-acp", args: [] } }
              : {},
        }),
      }),
    ).toEqual(
      scenario === "local-helper"
        ? { ok: true, checks: ["agent", "jev", "arguments"] }
        : scenario === "success"
          ? { ok: true, checks: ["agent", "jev"] }
          : scenario === "failure"
            ? { ok: false, stage: "arguments", code: "request-failed", httpStatus: 401 }
            : {
                ok: false,
                stage: "agent",
                code: scenario === "hang" ? "timeout" : "protocol-error",
              },
    )
  })
})
