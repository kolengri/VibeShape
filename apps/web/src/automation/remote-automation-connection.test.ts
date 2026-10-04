// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRemoteAutomationConnection } from "./remote-automation-connection"

const mocks = vi.hoisted(() => ({
  createHandle: vi.fn(),
  execute: vi.fn(),
  activeWork: vi.fn(),
  review: vi.fn(),
}))
vi.mock("../document/document-controller", () => ({
  createActiveDocumentAutomationSession: mocks.createHandle,
  getProjectActiveWorkBlock: mocks.activeWork,
}))
vi.mock("./automation-review-controller", () => ({
  automationReviews: { getSnapshot: mocks.review },
}))
vi.mock("./local-tool-executor", () => ({
  createLocalToolExecutor: () => ({ execute: mocks.execute }),
}))

const id = "0195b5ac-b250-7a2c-8c33-000000000001"
const credential = {
  protocolVersion: 1,
  sessionId: id,
  browserToken: "A".repeat(43),
  pairingCode: "ABCDEF0123456789",
  expiresAt: Date.now() + 3600000,
}
const actor = { type: "mcp", clientId: "org.vibeshape.mcp.remote-client", sessionId: id }
const client = {
  clientId: "verified-oauth-client",
  name: "CAD test client",
  redirectUri: "https://client.example/callback",
}
const result = {
  ok: false,
  diagnostic: { code: "geometry-unavailable", message: "No geometry.", retryable: true },
}
const consentId = "69a2b4b3-322c-4154-bae6-bfafb86b4255"
const work = {
  type: "work",
  requestId: "68a2b4b3-322c-4154-bae6-bfafb86b4255",
  operation: { tool: "model_info", arguments: {} },
}
const fetchMock = vi.fn<typeof fetch>()
const dispose = vi.fn()
const optOut = vi.fn()
const optIn = vi.fn()
const sockets: FakeSocket[] = []
let connection: ReturnType<typeof createRemoteAutomationConnection>

class FakeSocket {
  readonly send = vi.fn()
  readonly close = vi.fn()
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(readonly url: string) {
    sockets.push(this)
  }
  receive(message: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }))
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sockets.length = 0
  vi.stubGlobal("WebSocket", FakeSocket)
  vi.stubGlobal("fetch", fetchMock)
  mocks.createHandle.mockReturnValue({
    ok: true,
    documentId: id,
    dispose,
    enableAutoApply: optIn,
    disableAutoApply: optOut,
    readInfo: () => ({ summary: { documentId: id, revision: 4, data: { name: "Bracket" } } }),
  })
  optIn.mockReturnValue(true)
  optOut.mockReturnValue(true)
  mocks.activeWork.mockReturnValue(null)
  mocks.review.mockReturnValue(null)
  mocks.execute.mockResolvedValue(result)
  fetchMock.mockImplementation(async (url) =>
    String(url).endsWith("/browser/pair")
      ? Response.json(credential)
      : new Response(null, { status: 204 }),
  )
  connection = createRemoteAutomationConnection("https://mcp.example/mcp")
})
afterEach(() => {
  connection.dispose()
  vi.unstubAllGlobals()
})
async function paired() {
  expect(await connection.enable("browser-challenge")).toBe(true)
  const socket = sockets.at(-1)
  if (!socket) throw new Error("Missing browser socket.")
  expect(socket.url).toBe(`wss://mcp.example/browser/socket/${id}`)
  expect(socket.url).not.toContain(credential.browserToken)
  socket.onopen?.()
  expect(socket.send).toHaveBeenCalledWith(
    JSON.stringify({ type: "authenticate", token: credential.browserToken }),
  )
  socket.receive({ type: "paired", sessionId: id, expiresAt: credential.expiresAt })
  return socket
}
async function authorized() {
  const socket = await paired()
  socket.receive({ type: "consent", requestId: consentId, client })
  expect(connection.consent(true)).toBe(true)
  socket.receive({ type: "ready", actor, expiresAt: credential.expiresAt })
  return socket
}

describe("browser-owned remote automation lifecycle", () => {
  it("requires pairing, exact client consent and a separate idle auto-apply opt-in", async () => {
    const socket = await paired()
    expect(connection.getSnapshot()).toMatchObject({
      pairingCode: credential.pairingCode,
      connected: false,
      autoApply: false,
    })
    expect(connection.enableAutoApply()).toBe(false)
    socket.receive({ type: "consent", requestId: consentId, client })
    expect(connection.getSnapshot().consent?.client).toEqual(client)
    expect(optIn).not.toHaveBeenCalled()
    connection.consent(true)
    socket.receive({ type: "ready", actor, expiresAt: credential.expiresAt })
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: false })
    expect(optIn).not.toHaveBeenCalled()
    expect(connection.enableAutoApply()).toBe(true)
    expect(optIn).toHaveBeenCalledWith(actor)
    optOut.mockReturnValueOnce(false)
    expect(connection.disableAutoApply()).toBe(false)
    expect(connection.getSnapshot().autoApply).toBe(true)
    expect(connection.disableAutoApply()).toBe(true)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: false })
    expect(dispose).not.toHaveBeenCalled()
    await connection.disable()
    expect(dispose).toHaveBeenCalledOnce()
    expect(connection.getSnapshot()).toMatchObject({
      connected: false,
      autoApply: false,
      pairingCode: null,
    })
  })

  it("stops immediately during work and discards late results before network revocation returns", async () => {
    let finish!: (value: unknown) => void
    mocks.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const socket = await authorized()
    connection.enableAutoApply()
    socket.receive(work)
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce())
    expect(connection.enableAutoApply()).toBe(false)
    let acknowledge!: (value: Response) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve
        }),
    )
    const stopping = connection.disable()
    expect(connection.getSnapshot()).toMatchObject({
      connected: false,
      autoApply: false,
      busy: false,
    })
    expect(dispose).toHaveBeenCalledOnce()
    expect(mocks.execute.mock.calls[0]?.[1].aborted).toBe(true)
    const before = socket.send.mock.calls.length
    finish(result)
    await Promise.resolve()
    await Promise.resolve()
    expect(socket.send.mock.calls.length).toBe(before)
    acknowledge(new Response(null, { status: 204 }))
    await stopping
    await paired()
    expect(connection.getSnapshot().autoApply).toBe(false)
    expect(connection.getSnapshot().connected).toBe(false)
  })

  it("revokes on connection failure without reconnecting or replaying work", async () => {
    const socket = await authorized()
    connection.enableAutoApply()
    socket.onerror?.()
    expect(dispose).toHaveBeenCalledOnce()
    expect(connection.getSnapshot()).toMatchObject({
      connected: false,
      autoApply: false,
      error: true,
    })
    socket.receive(work)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(sockets).toHaveLength(1)
  })

  it("rejects unsolicited grants, mismatched actors, invalid messages and overlapping work", async () => {
    const socket = await paired()
    socket.receive({ type: "ready", actor, expiresAt: credential.expiresAt })
    expect(connection.getSnapshot().error).toBe(true)
    expect(optIn).not.toHaveBeenCalled()
    await authorized()
    const current = sockets[1]
    if (!current) throw new Error("Missing new socket.")
    mocks.execute.mockImplementation(() => new Promise(() => {}))
    current.receive(work)
    current.receive(work)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, error: true })
    expect(mocks.execute).toHaveBeenCalledOnce()
  })

  it("uses no remote path when unconfigured and blocks pairing during an ordinary edit or review", async () => {
    const absent = createRemoteAutomationConnection(undefined)
    expect(absent.getSnapshot().available).toBe(false)
    expect(await absent.enable("challenge")).toBe(false)
    mocks.activeWork.mockReturnValue("editor-draft")
    expect(await connection.enable("challenge")).toBe(false)
    mocks.activeWork.mockReturnValue(null)
    mocks.review.mockReturnValue({ status: "ready" })
    expect(await connection.enable("challenge")).toBe(false)
    expect(mocks.createHandle).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
