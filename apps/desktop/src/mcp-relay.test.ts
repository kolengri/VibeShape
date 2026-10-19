import { describe, expect, it } from "bun:test"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { type JSONRPCMessage, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js"
import { createMcpRelay } from "./mcp-relay"

function transport(send: (message: JSONRPCMessage) => Promise<void> = async () => {}) {
  const sent: JSONRPCMessage[] = [],
    versions: string[] = []
  const calls = { started: 0, closed: 0, terminated: 0 }
  const port: Transport & { terminateSession(): Promise<void> } = {
    async start() {
      calls.started += 1
    },
    async close() {
      calls.closed += 1
      port.onclose?.()
    },
    async terminateSession() {
      calls.terminated += 1
    },
    async send(message) {
      sent.push(message)
      await send(message)
    },
    setProtocolVersion(version) {
      versions.push(version)
    },
  }
  return { port, sent, versions, calls }
}
const initialize: JSONRPCMessage = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "fixture", version: "1" },
  },
}
const initialized = (id: number): JSONRPCMessage => ({
  jsonrpc: "2.0",
  id,
  result: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    serverInfo: { name: "fixture", version: "1" },
  },
})

describe("SDK transport relay", () => {
  it("forwards tools, cancellation, progress and resources verbatim and negotiates only the matching initialize response", async () => {
    const remote = transport(),
      stdio = transport()
    const relay = createMcpRelay(remote.port, stdio.port, () => {
      throw new Error("Unexpected relay failure")
    })
    await relay.start()
    const outgoing: JSONRPCMessage[] = [
      initialize,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "model_info", arguments: {} },
      },
      { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2 } },
    ]
    for (const message of outgoing) stdio.port.onmessage?.(message)
    expect(remote.sent).toEqual(outgoing)
    remote.port.onmessage?.(initialized(5))
    expect(remote.versions).toEqual([])
    const incoming: JSONRPCMessage[] = [
      initialized(0),
      {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: "fixture", progress: 0.5 },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        result: { contents: [{ uri: "vibeshape://session", text: "fixture" }] },
      },
    ]
    for (const message of incoming) remote.port.onmessage?.(message)
    expect(stdio.sent).toEqual([initialized(5), ...incoming])
    expect(remote.versions).toEqual([LATEST_PROTOCOL_VERSION])
    await relay.close()
    expect(remote.calls).toEqual({ started: 1, closed: 1, terminated: 1 })
    expect(stdio.calls.closed).toBe(1)
  })
  it("bounds outstanding messages and closes both transports exactly once", async () => {
    const releases: (() => void)[] = []
    const remote = transport(() => new Promise<void>((resolve) => releases.push(resolve))),
      stdio = transport()
    let failures = 0
    const relay = createMcpRelay(remote.port, stdio.port, () => {
      failures += 1
    })
    for (let id = 1; id <= 10; id += 1)
      stdio.port.onmessage?.({ jsonrpc: "2.0", id, method: "tools/list" })
    expect(remote.sent).toHaveLength(8)
    expect(failures).toBe(1)
    for (const release of releases) release()
    await relay.close()
    await relay.close()
    expect(remote.calls.terminated).toBe(1)
    expect(remote.calls.closed).toBe(1)
    expect(stdio.calls.closed).toBe(1)
  })
  it("releases a failed send and retains transport cleanup after a disconnect", async () => {
    const remote = transport(async () => {
        throw new Error("Fixture stream failure")
      }),
      stdio = transport()
    let failures = 0
    const relay = createMcpRelay(remote.port, stdio.port, () => {
      failures += 1
    })
    stdio.port.onmessage?.(initialize)
    await new Promise<void>((resolve) => setImmediate(resolve))
    remote.port.onerror?.(new Error("Later error"))
    await relay.close()
    expect(failures).toBe(1)
    expect(stdio.calls.closed).toBe(1)
  })
})
