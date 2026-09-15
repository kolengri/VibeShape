// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createLocalAutomationConnection } from "./local-automation-connection"

const mocks = vi.hoisted(() => ({ request: vi.fn(), createHandle: vi.fn(), execute: vi.fn() }))
vi.mock("./local-automation-http", () => ({ localAutomationRequest: mocks.request }))
vi.mock("../document/document-controller", () => ({
  createActiveDocumentAutomationSession: mocks.createHandle,
}))
vi.mock("./local-tool-executor", () => ({
  createLocalToolExecutor: () => ({ execute: mocks.execute }),
}))
const id = "0195b5ac-b250-7a2c-8c33-000000000001"
const client = { name: "Test CAD client", version: "1" }
const credential = {
  protocolVersion: 1,
  token: "A".repeat(43),
  actor: { type: "mcp", clientId: "org.example.client", sessionId: id },
  expiresAt: Date.now() + 3600000,
  client,
}
const ok = (data: unknown) => ({ ok: true, status: 200, data })
const work = {
  requestId: "69a2b4b3-322c-4154-bae6-bfafb86b4255",
  operation: { tool: "model_info", arguments: {} },
}
const emptyPoll = ok({ protocolVersion: 1, work: null, cancelledRequestIds: [] })
const failedResult = {
  ok: false,
  diagnostic: { code: "geometry-unavailable", message: "No geometry.", retryable: true },
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
let connection: ReturnType<typeof createLocalAutomationConnection>
const dispose = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  document.head.innerHTML = '<meta name="vibeshape-local-automation" content="1">'
  mocks.createHandle.mockReturnValue({
    ok: true,
    documentId: id,
    revision: 4,
    dispose,
    readInfo: () => ({ summary: { documentId: id, revision: 4, data: { name: "Bracket" } } }),
  })
  mocks.execute.mockResolvedValue(failedResult)
  mocks.request.mockImplementation(async (path: string) => {
    if (path === "/status") return ok({ protocolVersion: 1, client, paired: false })
    if (path === "/connect") return ok(credential)
    if (path === "/poll") return emptyPoll
    if (path === "/revoke") return { ok: true, status: 204, data: null }
    return ok({ ok: true })
  })
  connection = createLocalAutomationConnection()
})
afterEach(() => {
  connection.dispose()
  vi.useRealTimers()
})

async function ready() {
  connection.start()
  await connection.status()
}
describe("browser-owned local AI connection lifecycle", () => {
  it("keeps an already disconnected snapshot stable on disable and disposal", async () => {
    const initial = connection.getSnapshot()
    const listener = vi.fn()
    connection.subscribe(listener)
    await connection.disable()
    connection.dispose()
    expect(connection.getSnapshot()).toBe(initial)
    expect(listener).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it("publishes a real disconnect once and releases the paired session", async () => {
    await ready()
    await connection.enable()
    const listener = vi.fn()
    connection.subscribe(listener)
    await connection.disable()
    const disconnected = connection.getSnapshot()
    connection.dispose()
    expect(disconnected.connected).toBe(false)
    expect(connection.getSnapshot()).toBe(disconnected)
    expect(listener).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, credential.token, true)
  })

  it("does not probe ordinary hosted or development editors", async () => {
    document.head.innerHTML = ""
    await ready()
    expect(mocks.request).not.toHaveBeenCalled()
    expect(connection.getSnapshot().available).toBe(false)
  })
  it("revokes when the bridge rejects a completed operation acknowledgement", async () => {
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path === "/poll") return ok({ protocolVersion: 1, work, cancelledRequestIds: [] })
      if (path === "/result") return { ok: false, status: 400, data: failedResult }
      return original?.(path, ...args)
    })
    await ready()
    await connection.enable()
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, error: true })
    expect(dispose).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, credential.token, true)
  })
  it("reclaims credentials that arrive after Disable and prevents duplicate pairing", async () => {
    const connecting = deferred<ReturnType<typeof ok>>()
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/connect" ? connecting.promise : original?.(path, ...args),
    )
    await ready()
    const enabling = connection.enable()
    expect(await connection.enable()).toBe(false)
    await connection.disable()
    connecting.resolve(ok(credential))
    expect(await enabling).toBe(false)
    expect(connection.getSnapshot().connected).toBe(false)
    expect(dispose).toHaveBeenCalledOnce()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, credential.token, true)
  })
  it.each(["/poll", "/result"])(
    "ignores a late rejected %s from a previous pairing",
    async (heldPath) => {
      const held = deferred<ReturnType<typeof ok>>()
      const original = mocks.request.getMockImplementation()
      let first = true
      mocks.request.mockImplementation((path: string, ...args: unknown[]) => {
        if (path === heldPath && first) {
          first = false
          return held.promise
        }
        if (path === "/poll" && heldPath === "/result" && first)
          return Promise.resolve(ok({ protocolVersion: 1, work, cancelledRequestIds: [] }))
        return original?.(path, ...args)
      })
      await ready()
      await connection.enable()
      await vi.advanceTimersByTimeAsync(0)
      await connection.disable()
      await connection.enable()
      held.reject(new Error("The old connection ended."))
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.getSnapshot()).toMatchObject({ connected: true, error: false })
      expect(dispose).toHaveBeenCalledTimes(1)
    },
  )
})
