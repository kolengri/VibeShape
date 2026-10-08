import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { createProjectToolPort } from "./project-tool-port"

const mocks = (() => ({
  createHandle: vi.fn(),
  execute: vi.fn(),
  activeWork: vi.fn(),
  review: vi.fn(),
  createExecutor: vi.fn(),
  projectPort: vi.fn(),
}))()
mock.module("../document/document-controller", () => ({
  createActiveDocumentAutomationSession: mocks.createHandle,
  getProjectActiveWorkBlock: mocks.activeWork,
}))
mock.module("./automation-review-controller", () => ({
  automationReviews: { getSnapshot: mocks.review },
}))
mock.module("./local-tool-executor", () => ({
  createLocalToolExecutor: mocks.createExecutor,
}))
mock.module("./project-tool-port", () => ({
  createProjectToolPort: mocks.projectPort,
}))

const { createRemoteAutomationConnection } = await import("./remote-automation-connection")

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
const fetchMock = vi.fn<(...arguments_: Parameters<typeof fetch>) => ReturnType<typeof fetch>>()
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
  mocks.createExecutor.mockReturnValue({ execute: mocks.execute })
  mocks.projectPort.mockReturnValue({ execute: vi.fn() })
  mocks.createHandle.mockReturnValue({
    ok: true,
    documentId: id,
    dispose,
    enableAutoApply: optIn,
    disableAutoApply: optOut,
    readInfo: () => ({ summary: { documentId: id, revision: 4, data: { name: "Bracket" } } }),
    readIdentity: () => ({ id, name: "Bracket", revision: 4 }),
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
function projectOptions() {
  return mocks.projectPort.mock.calls.at(-1)?.[0] as Parameters<typeof createProjectToolPort>[0]
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}
const nextId = "0195b5ac-b250-7a2c-8c33-000000000002"
const projectWork = {
  ...work,
  operation: {
    tool: "open_project",
    arguments: { projectId: nextId, expectedProjectId: id, expectedRevision: 4 },
  },
}

describe("remote AI project management consent", () => {
  it("requires explicit idle opt-in, and clears the grant on Stop and the next pairing", async () => {
    expect(connection.setProjectManagement(true)).toBe(false)
    await authorized()
    expect(connection.getSnapshot().projectManagement).toBe(false)
    expect(projectOptions().isAllowed()).toBe(false)
    expect(connection.setProjectManagement(true)).toBe(true)
    expect(projectOptions().isAllowed()).toBe(true)
    mocks.review.mockReturnValue({ status: "ready" })
    expect(connection.setProjectManagement(false)).toBe(false)
    mocks.review.mockReturnValue(null)
    await connection.disable()
    expect(connection.getSnapshot()).toMatchObject({ connected: false, projectManagement: false })
    await authorized()
    expect(connection.getSnapshot()).toMatchObject({ connected: true, projectManagement: false })
  })

  it("replaces the handle and executor without changing the socket or token during a project switch", async () => {
    const socket = await authorized()
    connection.setProjectManagement(true)
    connection.enableAutoApply()
    const old = mocks.createHandle.mock.results[0]?.value
    const next = {
      ...old,
      documentId: nextId,
      dispose: vi.fn(),
      readIdentity: () => ({ id: nextId, name: "Assembly", revision: 1 }),
      readInfo: () => ({
        summary: { documentId: nextId, revision: 1, data: { name: "Assembly" } },
      }),
    }
    mocks.createHandle.mockReturnValue(next)
    const options = projectOptions()
    const pending = deferred()
    mocks.execute.mockImplementation(async () => {
      old.readIdentity = () => null
      connection.validateDocumentScope()
      expect(connection.getSnapshot().connected).toBe(true)
      await pending.promise
      expect(options.replaceSession()).toBe(true)
      return { ok: true, value: { projectId: nextId, name: "Assembly", revision: 1 } }
    })
    socket.receive(projectWork)
    expect(connection.getSnapshot().busy).toBe(true)
    expect(connection.isProjectActionPending()).toBe(true)
    expect(connection.setProjectManagement(false)).toBe(false)
    pending.resolve()
    await vi.waitFor(() => expect(connection.getSnapshot().busy).toBe(false))
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      autoApply: false,
      projectManagement: true,
    })
    expect(mocks.createExecutor).toHaveBeenLastCalledWith(next, actor, expect.anything())
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(socket.close).not.toHaveBeenCalled()
    expect(sockets).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: "result",
        protocolVersion: 1,
        requestId: work.requestId,
        tool: "open_project",
        result: { ok: true, value: { projectId: nextId, name: "Assembly", revision: 1 } },
      }),
    )
    expect(next.dispose).not.toHaveBeenCalled()
  })

  it("preserves the existing handle and auto-apply for a same-project no-op", async () => {
    const socket = await authorized()
    connection.setProjectManagement(true)
    connection.enableAutoApply()
    mocks.execute.mockResolvedValue({
      ok: true,
      value: { projectId: id, name: "Bracket", revision: 4 },
    })
    socket.receive({
      ...projectWork,
      operation: {
        ...projectWork.operation,
        arguments: { ...projectWork.operation.arguments, projectId: id },
      },
    })
    await vi.waitFor(() => expect(connection.getSnapshot().busy).toBe(false))
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: true })
    expect(mocks.createHandle).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
  })

  it("refreshes a reopened source after rollback without retaining its auto-apply grant", async () => {
    const socket = await authorized()
    connection.setProjectManagement(true)
    connection.enableAutoApply()
    const old = mocks.createHandle.mock.results[0]?.value
    const replacement = { ...old, dispose: vi.fn() }
    const options = projectOptions()
    mocks.createHandle.mockReturnValue(replacement)
    mocks.execute.mockImplementation(async () => {
      old.readIdentity = () => null
      expect(options.replaceSession()).toBe(true)
      return result
    })
    socket.receive(projectWork)
    await vi.waitFor(() => expect(connection.getSnapshot().busy).toBe(false))
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      autoApply: false,
      projectManagement: true,
    })
    expect(mocks.createExecutor).toHaveBeenLastCalledWith(replacement, actor, expect.anything())
    expect(socket.close).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(replacement.dispose).not.toHaveBeenCalled()
  })

  it("does not reacquire a handle or send a result when Stop races the asynchronous switch", async () => {
    const socket = await authorized()
    connection.setProjectManagement(true)
    const pending = deferred()
    const options = projectOptions()
    mocks.execute.mockImplementation(async () => {
      await pending.promise
      expect(options.isAllowed()).toBe(false)
      expect(options.replaceSession()).toBe(false)
      return result
    })
    socket.receive(projectWork)
    await connection.disable()
    const sends = socket.send.mock.calls.length
    pending.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(connection.getSnapshot()).toMatchObject({ connected: false, projectManagement: false })
    expect(mocks.createHandle).toHaveBeenCalledTimes(1)
    expect(socket.send.mock.calls).toHaveLength(sends)
  })

  it("revokes project management when manual navigation invalidates the handle", async () => {
    const socket = await authorized()
    connection.setProjectManagement(true)
    const handle = mocks.createHandle.mock.results[0]?.value
    if (!handle) throw new Error("Missing paired document handle.")
    handle.readIdentity = () => null
    connection.validateDocumentScope()
    expect(connection.getSnapshot()).toMatchObject({ connected: false, projectManagement: false })
    expect(socket.close).toHaveBeenCalledTimes(1)
  })
})

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
    expect(dispose).toHaveBeenCalledTimes(1)
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
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1))
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
    expect(dispose).toHaveBeenCalledTimes(1)
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
    expect(dispose).toHaveBeenCalledTimes(1)
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
    expect(mocks.execute).toHaveBeenCalledTimes(1)
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
