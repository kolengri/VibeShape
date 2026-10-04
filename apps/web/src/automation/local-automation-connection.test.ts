// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createLocalAutomationConnection } from "./local-automation-connection"

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  createHandle: vi.fn(),
  execute: vi.fn(),
  review: vi.fn(),
}))
vi.mock("./automation-review-controller", () => ({
  automationReviews: { getSnapshot: mocks.review },
}))
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
const optOut = vi.fn()
const enableAutoApply = vi.fn()
beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.review.mockReturnValue(null)
  enableAutoApply.mockReturnValue(true)
  optOut.mockReturnValue(true)
  document.head.innerHTML = '<meta name="vibeshape-local-automation" content="1">'
  mocks.createHandle.mockReturnValue({
    ok: true,
    documentId: id,
    revision: 4,
    dispose,
    enableAutoApply,
    disableAutoApply: optOut,
    readInfo: () => ({ summary: { documentId: id, revision: 4, data: { name: "Bracket" } } }),
  })
  mocks.execute.mockResolvedValue(failedResult)
  mocks.request.mockImplementation(async (path: string) => {
    if (path === "/status") return ok({ protocolVersion: 1, client, paired: false })
    if (path === "/resume") return ok({ ...credential, token: "B".repeat(43) })
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
  it.each([
    ["commit_import_upload", "ready", "review"],
    ["commit_import_upload", "applying", "applying"],
    ["commit_import_upload", "idle", "executing"],
    ["commit_planar_import_upload", "ready", "review"],
    ["commit_planar_import_upload", "applying", "applying"],
    ["commit_planar_import_upload", "idle", "executing"],
  ])("reports %s progress while review is %s", async (tool, status, stage) => {
    await ready()
    const pending = deferred<typeof failedResult>()
    mocks.execute.mockReturnValue(pending.promise)
    mocks.review.mockReturnValue({ status })
    const importing = {
      ...work,
      operation: { tool, arguments: { uploadId: id, uploadVersion: 1 } },
    }
    const original = mocks.request.getMockImplementation()
    let delivered = false
    mocks.request.mockImplementation((path: string, ...args: unknown[]) => {
      if (path === "/poll") {
        const next = delivered ? null : importing
        delivered = true
        return ok({ protocolVersion: 1, work: next, cancelledRequestIds: [] })
      }
      return original?.(path, ...args)
    })
    await connection.enable()
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith(
      "/poll",
      expect.objectContaining({ progress: { requestId: work.requestId, stage } }),
      credential.token,
    )
    pending.resolve(failedResult)
    await vi.advanceTimersByTimeAsync(0)
  })
  it("serializes a next operation delivered before the previous result acknowledgement", async () => {
    await ready()
    await connection.enable()
    const acknowledgement = deferred<ReturnType<typeof ok>>()
    const second = { ...work, requestId: "69a2b4b3-322c-4154-bae6-bfafb86b4256" }
    let pollCount = 0
    let resultCount = 0
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) => {
      if (path === "/poll") {
        pollCount += 1
        return ok({
          protocolVersion: 1,
          work: pollCount === 1 ? work : pollCount === 2 ? second : null,
          cancelledRequestIds: [],
        })
      }
      if (path === "/result") {
        resultCount += 1
        return resultCount === 1 ? acknowledgement.promise : ok({ ok: true })
      }
      return original?.(path, ...args)
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.execute).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, busy: true })
    expect(mocks.execute).toHaveBeenCalledOnce()
    acknowledgement.resolve(ok({ ok: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, busy: false })
    expect(dispose).not.toHaveBeenCalled()
  })
  it("discards a queued operation when the prior result acknowledgement fails", async () => {
    await ready()
    await connection.enable()
    const acknowledgement = deferred<ReturnType<typeof ok>>()
    const second = { ...work, requestId: "69a2b4b3-322c-4154-bae6-bfafb86b4256" }
    let pollCount = 0
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) => {
      if (path === "/poll") {
        pollCount += 1
        return ok({
          protocolVersion: 1,
          work: pollCount === 1 ? work : second,
          cancelledRequestIds: [],
        })
      }
      if (path === "/result") return acknowledgement.promise
      return original?.(path, ...args)
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.execute).toHaveBeenCalledOnce()
    acknowledgement.resolve({ ok: false, status: 401, data: {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(connection.getSnapshot()).toMatchObject({ connected: false, busy: false, error: true })
    expect(dispose).toHaveBeenCalledOnce()
  })
  it("requires explicit pairing and an idle browser opt-in, then resets on disconnect", async () => {
    await ready()
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
    expect(connection.enableAutoApply()).toBe(false)
    expect(enableAutoApply).not.toHaveBeenCalled()
    await connection.enable()
    expect(connection.getSnapshot().autoApply).toBe(false)
    expect(connection.getSnapshot().busy).toBe(false)
    expect(connection.enableAutoApply()).toBe(true)
    expect(enableAutoApply).toHaveBeenCalledWith(credential.actor)
    expect(connection.getSnapshot().autoApply).toBe(true)
    optOut.mockReturnValueOnce(false)
    expect(connection.disableAutoApply()).toBe(false)
    expect(connection.getSnapshot().autoApply).toBe(true)
    expect(connection.disableAutoApply()).toBe(true)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: false })
    expect(dispose).not.toHaveBeenCalled()
    const disabling = connection.disable()
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
    expect(dispose).toHaveBeenCalledOnce()
    await disabling
    await connection.enable()
    expect(connection.getSnapshot().autoApply).toBe(false)
  })

  it("does not broaden a refused grant or grant during an active operation", async () => {
    await ready()
    await connection.enable()
    enableAutoApply.mockReturnValue(false)
    expect(connection.enableAutoApply()).toBe(false)
    expect(connection.getSnapshot().autoApply).toBe(false)
    enableAutoApply.mockReturnValue(true)
    const pending = deferred<typeof failedResult>()
    mocks.execute.mockReturnValue(pending.promise)
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/poll"
        ? ok({ protocolVersion: 1, work, cancelledRequestIds: [] })
        : original?.(path, ...args),
    )
    await vi.advanceTimersByTimeAsync(500)
    enableAutoApply.mockClear()
    expect(connection.getSnapshot().busy).toBe(true)
    expect(connection.enableAutoApply()).toBe(false)
    expect(enableAutoApply).not.toHaveBeenCalled()
    const originalRequest = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/poll" ? emptyPoll : originalRequest?.(path, ...args),
    )
    pending.resolve(failedResult)
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.getSnapshot().busy).toBe(false)
  })

  it("revokes auto-apply when its captured project closes", async () => {
    await ready()
    await connection.enable()
    expect(connection.enableAutoApply()).toBe(true)
    const created = mocks.createHandle.mock.results[0]
    if (!created) throw new Error("The browser handle was not created.")
    created.value.readInfo = () => null
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
    expect(dispose).toHaveBeenCalledOnce()
    expect(connection.enableAutoApply()).toBe(false)
  })
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
    expect(disconnected.busy).toBe(false)
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

describe("local AI reload recovery", () => {
  it("restores the same document after cancelled navigation with auto-apply off", async () => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    window.dispatchEvent(new Event("beforeunload"))
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
    await vi.advanceTimersByTimeAsync(250)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: false })
    expect(mocks.request).toHaveBeenCalledWith(
      "/resume",
      { protocolVersion: 1, document: { id, name: "Bracket", revision: 4 } },
      credential.token,
    )
    expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
  })
  it("does not restore cancelled navigation after explicit Stop AI", async () => {
    await ready()
    await connection.enable()
    window.dispatchEvent(new Event("beforeunload"))
    await connection.disable()
    await vi.advanceTimersByTimeAsync(250)
    expect(connection.getSnapshot().connected).toBe(false)
    expect(mocks.request).not.toHaveBeenCalledWith("/resume", expect.anything(), expect.anything())
    expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
  })
  it("suspends before navigation rejects a poll and pagehide follows", async () => {
    await ready()
    const polling = deferred<ReturnType<typeof ok>>()
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/poll" ? polling.promise : original?.(path, ...args),
    )
    await connection.enable()
    window.dispatchEvent(new Event("beforeunload"))
    polling.reject(new TypeError("The navigation aborted fetching."))
    await Promise.resolve()
    await Promise.resolve()
    window.dispatchEvent(new Event("pagehide"))
    await vi.advanceTimersByTimeAsync(0)
    expect(sessionStorage.getItem("vibeshape-local-ai-resume")).not.toBeNull()
    expect(mocks.request).toHaveBeenCalledWith("/suspend", {}, credential.token, true)
    expect(mocks.request).not.toHaveBeenCalledWith(
      "/revoke",
      expect.anything(),
      credential.token,
      true,
    )
  })
  it("revokes a failed poll when the document remains open", async () => {
    await ready()
    const polling = deferred<ReturnType<typeof ok>>()
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/poll" ? polling.promise : original?.(path, ...args),
    )
    await connection.enable()
    polling.reject(new TypeError("The network failed."))
    await vi.advanceTimersByTimeAsync(1)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, error: true })
    expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, credential.token, true)
    expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
  })
  it("restores the same project in a fresh connection with auto-apply off", async () => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    window.dispatchEvent(new Event("pagehide"))
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
    expect(mocks.request).toHaveBeenCalledWith("/suspend", {}, credential.token, true)
    const previous = connection
    connection = createLocalAutomationConnection()
    await ready()
    await vi.advanceTimersByTimeAsync(250)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: false })
    expect(mocks.request).toHaveBeenCalledWith(
      "/resume",
      {
        protocolVersion: 1,
        document: { id, name: "Bracket", revision: 4 },
      },
      credential.token,
    )
    expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
    previous.dispose()
  })
  it("waits for the document to open before resuming", async () => {
    await ready()
    await connection.enable()
    window.dispatchEvent(new Event("pagehide"))
    const create = mocks.createHandle.getMockImplementation()
    if (!create) throw new Error("The document handle mock is unavailable.")
    mocks.createHandle.mockReturnValue({ ok: false })
    await connection.status()
    await vi.advanceTimersByTimeAsync(250)
    expect(mocks.request).not.toHaveBeenCalledWith("/resume", expect.anything(), expect.anything())
    mocks.createHandle.mockImplementation(create)
    await vi.advanceTimersByTimeAsync(250)
    expect(connection.getSnapshot().connected).toBe(true)
  })
  it("does not grant access to a different project", async () => {
    await ready()
    await connection.enable()
    window.dispatchEvent(new Event("pagehide"))
    mocks.createHandle.mockReturnValue({
      ok: true,
      dispose,
      readInfo: () => ({
        summary: {
          documentId: "0195b5ac-b250-7a2c-8c33-000000000002",
          revision: 0,
          data: { name: "Other" },
        },
      }),
    })
    await connection.status()
    await vi.advanceTimersByTimeAsync(250)
    expect(connection.getSnapshot().connected).toBe(false)
    expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, credential.token, true)
    expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
  })
  it("does not resume after Stop AI or a rejected resume", async () => {
    await ready()
    await connection.enable()
    window.dispatchEvent(new Event("pagehide"))
    await connection.disable()
    await connection.status()
    await vi.advanceTimersByTimeAsync(250)
    expect(connection.getSnapshot().connected).toBe(false)
    expect(mocks.request).not.toHaveBeenCalledWith("/resume", expect.anything(), expect.anything())
    await connection.enable()
    window.dispatchEvent(new Event("pagehide"))
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/resume"
        ? Promise.resolve({ ok: false, status: 401, data: {} })
        : original?.(path, ...args),
    )
    await connection.status()
    await vi.advanceTimersByTimeAsync(250)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, error: true })
    expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
  })
  it("expires the reload allowance and ignores malformed storage", async () => {
    await ready()
    await connection.enable()
    window.dispatchEvent(new Event("pagehide"))
    await vi.advanceTimersByTimeAsync(60_001)
    await connection.status()
    await vi.advanceTimersByTimeAsync(250)
    expect(connection.getSnapshot().connected).toBe(false)
    expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
    sessionStorage.setItem("vibeshape-local-ai-resume", "{invalid")
    await connection.status()
    await vi.advanceTimersByTimeAsync(250)
    expect(connection.getSnapshot().connected).toBe(false)
  })
})

it("transfers reload recovery across the loading-to-ready owner remount", async () => {
  await ready()
  await connection.enable()
  window.dispatchEvent(new Event("pagehide"))
  connection.dispose()
  expect(sessionStorage.getItem("vibeshape-local-ai-resume")).not.toBeNull()
  connection = createLocalAutomationConnection()
  await ready()
  connection.dispose()
  connection = createLocalAutomationConnection()
  await ready()
  await vi.advanceTimersByTimeAsync(250)
  expect(connection.getSnapshot().connected).toBe(true)
})
