import { afterEach, describe, expect, it } from "bun:test"
import * as acp from "@agentclientprotocol/sdk"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { createJevAgent } from "./agent"
import { readConfiguration } from "./configuration"
import type { Decide } from "./contracts"
import type { ToolPort } from "./controller"
import type { connectMcp } from "./mcp"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
const tool: Tool = { name: "create_draft", inputSchema: { type: "object" } }
const server = { name: "vs_test", command: "unused-test-fixture", args: [], env: [] }
function fixture(
  decide: Decide,
  overrides: Partial<ToolPort> = {},
  onElicit?: (
    params: acp.CreateElicitationRequest,
    signal: AbortSignal,
  ) => Promise<acp.CreateElicitationResponse>,
) {
  let forward: Parameters<typeof connectMcp>[2] | undefined
  let connectionTimeout: number | undefined
  const calls: string[] = []
  const updates: acp.SessionUpdate[] = []
  const port: ToolPort = {
    tools: [tool],
    close: async () => {},
    async call(name) {
      calls.push(name)
      const value =
        name === "read_agent_skill"
          ? { result: { ok: true, value: { text: "Use exact drafts." } } }
          : name === "model_info"
            ? {
                result: {
                  ok: true,
                  value: {
                    summary: {
                      kind: "org.vibeshape.document.summary",
                      schemaVersion: 1,
                      documentId: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
                      revision: 0,
                      classification: "semantic",
                      truncated: false,
                      data: {
                        name: "Part",
                        createdAt: "2026-10-20T12:00:00.000Z",
                        updatedAt: "2026-10-20T12:00:00.000Z",
                      },
                    },
                    measurements: null,
                    measurementDiagnostic: null,
                  },
                },
              }
            : { result: { ok: true } }
      return { value, photos: [], failed: false }
    },
    ...overrides,
  }
  const adapter = createJevAgent(
    readConfiguration({ TYPESAFE_API_KEY: "test", JEV_TIMEOUT_MS: "120000", JEV_MAX_STEPS: "48" }),
    {
      decide,
      connect: async (_server, _cwd, elicit, timeoutMs) => {
        forward = elicit
        connectionTimeout = timeoutMs
        return port
      },
    },
  )
  const toAgent = new TransformStream<Uint8Array>()
  const toClient = new TransformStream<Uint8Array>()
  const agentConnection = adapter.app.connect(acp.ndJsonStream(toClient.writable, toAgent.readable))
  const client = acp
    .client({ name: "test-vibeshape" })
    .onRequest(acp.methods.client.elicitation.create, ({ params, signal }) =>
      onElicit ? onElicit(params, signal) : { action: "decline" },
    )
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      updates.push(params.update)
    })
    .connect(acp.ndJsonStream(toAgent.writable, toClient.readable))
  cleanup.push(async () => {
    client.close()
    agentConnection.close()
    await adapter.close()
  })
  return {
    client,
    updates,
    calls,
    port,
    get connectionTimeout() {
      return connectionTimeout
    },
    elicit: (...args: Parameters<Parameters<typeof connectMcp>[2]>) => {
      if (!forward) throw new Error("Not connected")
      return forward(...args)
    },
  }
}

async function open(f: ReturnType<typeof fixture>) {
  const initialization = await f.client.agent.request<
    acp.InitializeResponse,
    acp.InitializeRequest
  >(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { elicitation: { form: {} } },
  })
  const created = await f.client.agent.request<acp.NewSessionResponse, acp.NewSessionRequest>(
    acp.methods.agent.session.new,
    { cwd: process.cwd(), mcpServers: [server] },
  )
  return { ...created, initialization }
}
describe("Jev ACP adapter", () => {
  it("keeps 48 near-limit operations within the desktop ACP display budget", async () => {
    const upload: Tool = { name: "append_import_chunk", inputSchema: { type: "object" } }
    const base64 = "A".repeat(122_880)
    let calls = 0
    const f = fixture(async () => ({
      kind: "tool",
      tool: upload,
      arguments: {
        uploadId: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
        offset: calls * 92_160,
        base64,
      },
      needsArguments: false,
      confidence: 1,
    }))
    f.port.tools = [upload]
    const original = f.port.call
    f.port.call = async (name, args, signal) => {
      if (name !== upload.name) return original(name, args, signal)
      expect(args.base64).toBe(base64)
      calls++
      return {
        value:
          calls === 48
            ? {
                result: {
                  ok: false,
                  diagnostic: {
                    code: "fixture-rejection",
                    message: "CAD rejection remains visible",
                    retryable: false,
                  },
                },
              }
            : { content: [{ type: "text", text: (calls % 2 ? "\0" : "界").repeat(32_000) }] },
        photos: [],
        failed: calls === 48,
      }
    }
    const { sessionId } = await open(f)
    expect(
      await f.client.agent.request<acp.PromptResponse, acp.PromptRequest>(
        acp.methods.agent.session.prompt,
        { sessionId, prompt: [{ type: "text", text: "Continue the upload" }] },
      ),
    ).toEqual({ stopReason: "end_turn" })
    expect(calls).toBe(48)
    const tools = f.updates.filter(
      (update) =>
        update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update",
    )
    expect(tools).toHaveLength(96)
    expect(
      tools.every((update) => update.rawInput === undefined && update.rawOutput === undefined),
    ).toBe(true)
    expect(tools.at(-1)?.status).toBe("failed")
    expect(JSON.stringify(tools.at(-1)?.content)).toContain("CAD rejection remains visible")
    const bytes = f.updates.reduce(
      (sum, update) => sum + Buffer.byteLength(JSON.stringify({ sessionId, update })),
      0,
    )
    expect(bytes).toBeLessThan(2 * 1024 * 1024)
    expect(JSON.stringify(tools)).toContain("Tool result truncated in chat display")
  })
  it("keeps complete bounded evidence in decision context when its chat display is truncated", async () => {
    const evidence = { result: { ok: true, value: "x".repeat(12_000) } }
    let decisions = 0
    const f = fixture(async (state) => {
      if (decisions++ === 0)
        return {
          kind: "tool",
          tool,
          arguments: { baseRevision: 0 },
          needsArguments: false,
          confidence: 1,
        }
      expect(state.history.find((entry) => entry.tool === tool.name)?.result).toEqual(evidence)
      return { kind: "done", confidence: 1 }
    })
    const original = f.port.call
    f.port.call = (name, args, signal) =>
      name === tool.name
        ? Promise.resolve({ value: evidence, photos: [], failed: false })
        : original(name, args, signal)
    const { sessionId } = await open(f)
    await f.client.agent.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text: "Create" }],
    })
    expect(decisions).toBe(2)
    const start = f.updates.find((update) => update.sessionUpdate === "tool_call")
    const finish = f.updates.find((update) => update.sessionUpdate === "tool_call_update")
    expect(start).toMatchObject({ rawInput: { baseRevision: 0 } })
    expect(finish).not.toHaveProperty("rawInput")
    expect(JSON.stringify(finish)).toContain("Tool result truncated in chat display")
    expect(JSON.stringify(finish)).not.toContain("x".repeat(12_000))
  })
  it("passes the configured operation timeout to the MCP connection", async () => {
    const f = fixture(async () => ({ kind: "done", confidence: 1 }))
    await open(f)
    expect(f.connectionTimeout).toBe(120_000)
  })
  it.each([undefined, "form" as const])(
    "forwards legacy and explicit MCP form elicitations with an ACP discriminator: %s",
    async (mode) => {
      let received: acp.CreateElicitationRequest | undefined
      const f = fixture(
        async () => ({ kind: "done", confidence: 1 }),
        {},
        async (params) => {
          received = params
          return { action: "decline" }
        },
      )
      await open(f)
      expect(
        await f.elicit(
          {
            ...(mode ? { mode } : {}),
            message: "Choose material",
            requestedSchema: { type: "object", properties: {} },
          },
          new AbortController().signal,
        ),
      ).toEqual({ action: "decline" })
      expect(received?.mode).toBe("form")
    },
  )
  it("cancels the forwarded ACP question when its MCP request is cancelled", async () => {
    let started: (() => void) | undefined
    let cancelled: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const stopped = new Promise<void>((resolve) => {
      cancelled = resolve
    })
    const f = fixture(
      async () => ({ kind: "done", confidence: 1 }),
      {},
      async (_params, signal) => {
        started?.()
        return new Promise((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              cancelled?.()
              resolve({ action: "cancel" })
            },
            { once: true },
          ),
        )
      },
    )
    await open(f)
    const request = new AbortController()
    const pending = f.elicit(
      { message: "Choose material", requestedSchema: { type: "object", properties: {} } },
      request.signal,
    )
    await ready
    request.abort()
    expect(
      await pending.then(
        (result) => result.action,
        () => "cancelled",
      ),
    ).toBeOneOf(["cancel", "cancelled"])
    await stopped
  })

  it("uses the real ACP protocol for initialization, a tool update and turn completion", async () => {
    let decisions = 0
    const f = fixture(async () =>
      decisions++ === 0
        ? {
            kind: "tool",
            tool,
            arguments: { baseRevision: 0 },
            needsArguments: false,
            confidence: 1,
          }
        : { kind: "done", confidence: 1 },
    )
    const { sessionId, initialization } = await open(f)
    expect(initialization.agentCapabilities?.loadSession).toBe(false)
    expect(initialization.agentCapabilities?.promptCapabilities?.image).toBe(false)
    const response = await f.client.agent.request<acp.PromptResponse, acp.PromptRequest>(
      acp.methods.agent.session.prompt,
      { sessionId, prompt: [{ type: "text", text: "Create a part" }] },
    )
    expect(response.stopReason).toBe("end_turn")
    expect(f.calls).toContain("create_draft")
    expect(
      f.updates.some(
        (update) => update.sessionUpdate === "tool_call" && update.name === "create_draft",
      ),
    ).toBe(true)
    expect(
      f.updates.some(
        (update) => update.sessionUpdate === "tool_call_update" && update.status === "completed",
      ),
    ).toBe(true)
  })
  it("cancels an active inference and accepts a later turn", async () => {
    let started: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    let first = true
    const f = fixture(async (_state, _tools, signal) => {
      if (!first) return { kind: "done", confidence: 1 }
      first = false
      started?.()
      await new Promise<never>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      )
      throw new Error("unreachable")
    })
    const { sessionId } = await open(f)
    const pending = f.client.agent.request<acp.PromptResponse, acp.PromptRequest>(
      acp.methods.agent.session.prompt,
      { sessionId, prompt: [{ type: "text", text: "Create" }] },
    )
    await ready
    await f.client.agent.notify(acp.methods.agent.session.cancel, { sessionId })
    expect((await pending).stopReason).toBe("cancelled")
    const next = await f.client.agent.request<acp.PromptResponse, acp.PromptRequest>(
      acp.methods.agent.session.prompt,
      { sessionId, prompt: [{ type: "text", text: "Inspect instead" }] },
    )
    expect(next.stopReason).toBe("end_turn")
    expect(f.calls).not.toContain("create_draft")
  })
  it("rejects concurrent prompts and does not open a second project session", async () => {
    let started: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const f = fixture(async (_state, _tools, signal) => {
      started?.()
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      )
    })
    const { sessionId } = await open(f)
    const prompt = { sessionId, prompt: [{ type: "text" as const, text: "Create" }] }
    const pending = f.client.agent.request<acp.PromptResponse, acp.PromptRequest>(
      acp.methods.agent.session.prompt,
      prompt,
    )
    await ready
    await expect(
      f.client.agent.request<acp.PromptResponse, acp.PromptRequest>(
        acp.methods.agent.session.prompt,
        prompt,
      ),
    ).rejects.toThrow()
    await expect(
      f.client.agent.request<acp.NewSessionResponse, acp.NewSessionRequest>(
        acp.methods.agent.session.new,
        { cwd: process.cwd(), mcpServers: [server] },
      ),
    ).rejects.toThrow()
    await f.client.agent.notify(acp.methods.agent.session.cancel, { sessionId })
    expect((await pending).stopReason).toBe("cancelled")
  })
})
