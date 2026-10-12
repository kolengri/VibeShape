import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"

import type { createProjectToolPort } from "./project-tool-port"

const mocks = (() => ({
  request: vi.fn(),
  createHandle: vi.fn(),
  execute: vi.fn(),
  review: vi.fn(),
  createExecutor: vi.fn(),
  projectPort: vi.fn(),
}))()
mock.module("./automation-review-controller", () => ({
  automationReviews: { getSnapshot: mocks.review },
}))
const originalModule1 = { ...(await import("./local-automation-http")) }
mock.module("./local-automation-http", () => ({
  ...originalModule1,
  localAutomationRequest: mocks.request,
}))
mock.module("../document/document-controller", () => ({
  createActiveDocumentAutomationSession: mocks.createHandle,
}))
mock.module("./local-tool-executor", () => ({
  createLocalToolExecutor: mocks.createExecutor,
}))
mock.module("./project-tool-port", () => ({
  createProjectToolPort: mocks.projectPort,
}))

const { act, cleanup, render } = await import("@testing-library/react")
const { createElement, StrictMode, useEffect } = await import("react")
const { createTestBrowserStorage } = await import("../test-support/browser-storage")
const { createLocalAutomationConnection } = await import("./local-automation-connection")
const { LocalAutomationTransportError } = await import("./local-automation-http")
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
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.review.mockReturnValue(null)
  mocks.createExecutor.mockReturnValue({ execute: mocks.execute })
  mocks.projectPort.mockReturnValue({ execute: vi.fn() })
  enableAutoApply.mockReturnValue(true)
  optOut.mockReturnValue(true)
  document.head.innerHTML = '<meta name="vibeshape-local-automation" content="1">'
  mocks.createHandle.mockImplementation(() => ({
    ok: true,
    documentId: id,
    revision: 4,
    dispose,
    enableAutoApply,
    disableAutoApply: optOut,
    readIdentity: () => ({ id, revision: 4, name: "Bracket" }),
    readInfo: vi.fn(),
  }))
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
  cleanup()
  connection.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function ready() {
  connection.start()
  await connection.status()
}
function projectOptions() {
  return mocks.projectPort.mock.calls.at(-1)?.[0] as Parameters<typeof createProjectToolPort>[0]
}
function deliverProjectChange(projectId: string = "0195b5ac-b250-7a2c-8c33-000000000002") {
  const original = mocks.request.getMockImplementation()
  let delivered = false
  mocks.request.mockImplementation((path: string, ...args: unknown[]) => {
    if (path === "/poll") {
      const next = delivered
        ? null
        : {
            ...work,
            operation: {
              tool: "open_project",
              arguments: { projectId, expectedProjectId: id, expectedRevision: 4 },
            },
          }
      delivered = true
      return ok({ protocolVersion: 1, work: next, cancelledRequestIds: [] })
    }
    return original?.(path, ...args)
  })
}
describe("unpaired local client discovery", () => {
  it("keeps a status read alive across navigation and ignores its expired generation", async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    mocks.request.mockReturnValueOnce(pending.promise)
    connection.start()
    const request = connection.status()
    expect(mocks.request).toHaveBeenCalledWith("/status", {}, undefined, true)
    window.dispatchEvent(new Event("beforeunload"))
    window.dispatchEvent(new Event("pagehide"))
    pending.resolve(ok({ protocolVersion: 1, client, paired: false }))
    await request
    expect(connection.getSnapshot()).toMatchObject({
      available: false,
      client: null,
      connected: false,
    })
    expect(mocks.createHandle).not.toHaveBeenCalled()
  })

  it("discovers a client that starts after the editor without granting access", async () => {
    mocks.request.mockResolvedValueOnce(ok({ protocolVersion: 1, client: null, paired: false }))
    await ready()
    expect(connection.getSnapshot()).toMatchObject({ available: true, client: null })
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot()).toMatchObject({ client, connected: false })
    expect(mocks.createHandle).not.toHaveBeenCalled()
    mocks.request.mockResolvedValueOnce(ok({ protocolVersion: 1, client: null, paired: false }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot().client).toBeNull()
  })

  it("coalesces slow status reads and stops discovery on disposal", async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    mocks.request.mockReturnValueOnce(pending.promise)
    connection.start()
    const initial = connection.status()
    const repeated = connection.status()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    pending.resolve(ok({ protocolVersion: 1, client, paired: false }))
    await Promise.all([initial, repeated])
    connection.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it("does not add status requests to an already paired session", async () => {
    await ready()
    await connection.enable()
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.request.mock.calls.filter(([path]) => path === "/status")).toHaveLength(1)
    expect(connection.getSnapshot().connected).toBe(true)
  })
})

describe("local AI project management consent", () => {
  it("requires an idle explicit grant and clears it across recovery and Stop", async () => {
    await ready()
    expect(connection.setProjectManagement(true)).toBe(false)
    await connection.enable()
    expect(connection.getSnapshot().projectManagement).toBe(false)
    expect(projectOptions().isAllowed()).toBe(false)
    expect(connection.setProjectManagement(true)).toBe(true)
    expect(projectOptions().isAllowed()).toBe(true)
    mocks.review.mockReturnValue({ status: "ready" })
    expect(connection.setProjectManagement(false)).toBe(false)
    mocks.review.mockReturnValue(null)
    window.dispatchEvent(new Event("pagehide"))
    expect(connection.getSnapshot().projectManagement).toBe(false)
    expect(
      JSON.parse(sessionStorage.getItem("vibeshape-local-ai-resume") ?? "{}"),
    ).not.toHaveProperty("projectManagement")
    await connection.status()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, projectManagement: false })
    expect(connection.setProjectManagement(true)).toBe(true)
    await connection.disable()
    expect(connection.getSnapshot()).toMatchObject({ connected: false, projectManagement: false })
  })

  it("replaces the document handle and pauses heartbeat only while the switch result is acknowledging", async () => {
    await ready()
    await connection.enable()
    connection.setProjectManagement(true)
    connection.enableAutoApply()
    const old = mocks.createHandle.mock.results[0]?.value
    const oldIdentity = vi.fn(old.readIdentity)
    old.readIdentity = oldIdentity
    const nextId = "0195b5ac-b250-7a2c-8c33-000000000002"
    const next = {
      ...old,
      documentId: nextId,
      dispose: vi.fn(),
      readIdentity: () => ({ id: nextId, name: "Assembly", revision: 1 }),
    }
    mocks.createHandle.mockReturnValue(next)
    const options = projectOptions()
    mocks.execute.mockImplementation(async () => {
      oldIdentity.mockReturnValue(null)
      connection.validateDocumentScope()
      expect(connection.getSnapshot().connected).toBe(true)
      expect(options.replaceSession()).toBe(true)
      return { ok: true, value: { projectId: nextId, name: "Assembly", revision: 1 } }
    })
    const accepted = deferred<ReturnType<typeof ok>>()
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/result" ? accepted.promise : original?.(path, ...args),
    )
    deliverProjectChange(nextId)
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      busy: true,
      autoApply: true,
      projectManagement: true,
    })
    expect(connection.setProjectManagement(false)).toBe(false)
    expect(connection.isProjectActionPending()).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(mocks.createExecutor).toHaveBeenLastCalledWith(next, credential.actor, expect.anything())
    const pollCount = mocks.request.mock.calls.filter(([path]) => path === "/poll").length
    await vi.advanceTimersByTimeAsync(2000)
    expect(mocks.request.mock.calls.filter(([path]) => path === "/poll")).toHaveLength(pollCount)
    expect(JSON.parse(sessionStorage.getItem("vibeshape-local-ai-resume") ?? "{}").documentId).toBe(
      id,
    )
    accepted.resolve(ok({ ok: true }))
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, busy: false })
    expect(connection.isProjectActionPending()).toBe(false)
    expect(mocks.request).toHaveBeenLastCalledWith(
      "/poll",
      expect.objectContaining({ document: { id: nextId, name: "Assembly", revision: 1 } }),
      credential.token,
    )
    expect(JSON.parse(sessionStorage.getItem("vibeshape-local-ai-resume") ?? "{}").documentId).toBe(
      nextId,
    )
    expect(mocks.request.mock.calls.filter(([path]) => path === "/connect")).toHaveLength(1)
    expect(next.dispose).not.toHaveBeenCalled()
  })

  it("keeps source progress heartbeats alive through a project transition longer than the broker liveness window", async () => {
    await ready()
    await connection.enable()
    connection.setProjectManagement(true)
    const old = mocks.createHandle.mock.results[0]?.value
    const nextId = "0195b5ac-b250-7a2c-8c33-000000000002"
    const next = {
      ...old,
      documentId: nextId,
      dispose: vi.fn(),
      readIdentity: () => ({ id: nextId, name: "Assembly", revision: 1 }),
    }
    mocks.createHandle.mockReturnValue(next)
    const options = projectOptions()
    const opening = deferred<void>()
    mocks.execute.mockImplementation(async () => {
      old.readIdentity = () => null
      await opening.promise
      expect(options.replaceSession()).toBe(true)
      return { ok: true, value: { projectId: nextId, name: "Assembly", revision: 1 } }
    })
    deliverProjectChange(nextId)
    await vi.advanceTimersByTimeAsync(500)
    const heartbeatCount = mocks.request.mock.calls.filter(([path]) => path === "/poll").length
    await vi.advanceTimersByTimeAsync(20_000)
    const heartbeats = mocks.request.mock.calls
      .filter(([path]) => path === "/poll")
      .slice(heartbeatCount)
    expect(heartbeats).toHaveLength(40)
    for (const [, input] of heartbeats) {
      expect(input).toMatchObject({
        document: { id, name: "Bracket", revision: 4 },
        progress: { requestId: work.requestId, stage: "executing" },
      })
    }
    expect(connection.getSnapshot()).toMatchObject({ connected: true, busy: true })
    expect(mocks.request.mock.calls.filter(([path]) => path === "/result")).toHaveLength(0)
    opening.resolve()
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, busy: false })
    expect(mocks.request).toHaveBeenLastCalledWith(
      "/poll",
      expect.objectContaining({ document: { id: nextId, name: "Assembly", revision: 1 } }),
      credential.token,
    )
  })

  it("drains an in-flight source heartbeat before posting the project result and target identity", async () => {
    await ready()
    await connection.enable()
    connection.setProjectManagement(true)
    const old = mocks.createHandle.mock.results[0]?.value
    const nextId = "0195b5ac-b250-7a2c-8c33-000000000002"
    const next = {
      ...old,
      documentId: nextId,
      dispose: vi.fn(),
      readIdentity: () => ({ id: nextId, name: "Assembly", revision: 1 }),
    }
    mocks.createHandle.mockReturnValue(next)
    const options = projectOptions()
    const opening = deferred<void>()
    mocks.execute.mockImplementation(async () => {
      old.readIdentity = () => null
      await opening.promise
      expect(options.replaceSession()).toBe(true)
      return { ok: true, value: { projectId: nextId, name: "Assembly", revision: 1 } }
    })
    deliverProjectChange(nextId)
    await vi.advanceTimersByTimeAsync(500)
    const heartbeat = deferred<ReturnType<typeof ok>>()
    const accepted = deferred<ReturnType<typeof ok>>()
    const original = mocks.request.getMockImplementation()
    const ordering: string[] = []
    mocks.request.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path === "/poll") {
        const input = args[0] as { document: { id: string } }
        if (input.document.id === id) {
          ordering.push("source-heartbeat-start")
          const response = await heartbeat.promise
          ordering.push("source-heartbeat-end")
          return response
        }
        ordering.push("target-heartbeat")
      }
      if (path === "/result") {
        ordering.push("project-result")
        return accepted.promise
      }
      return original?.(path, ...args)
    })
    await vi.advanceTimersByTimeAsync(500)
    opening.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(ordering).toEqual(["source-heartbeat-start"])
    expect(connection.getSnapshot()).toMatchObject({ connected: true, busy: true })
    heartbeat.resolve(emptyPoll)
    await vi.advanceTimersByTimeAsync(0)
    expect(ordering).toEqual(["source-heartbeat-start", "source-heartbeat-end", "project-result"])
    await vi.advanceTimersByTimeAsync(2000)
    expect(ordering).toHaveLength(3)
    expect(JSON.parse(sessionStorage.getItem("vibeshape-local-ai-resume") ?? "{}").documentId).toBe(
      id,
    )
    accepted.resolve(ok({ ok: true }))
    await vi.advanceTimersByTimeAsync(500)
    expect(ordering).toEqual([
      "source-heartbeat-start",
      "source-heartbeat-end",
      "project-result",
      "target-heartbeat",
    ])
    expect(JSON.parse(sessionStorage.getItem("vibeshape-local-ai-resume") ?? "{}").documentId).toBe(
      nextId,
    )
  })

  it("does not post a late project result when Stop interrupts the source-heartbeat drain", async () => {
    await ready()
    await connection.enable()
    connection.setProjectManagement(true)
    const opening = deferred<void>()
    mocks.execute.mockImplementation(async () => {
      await opening.promise
      return { ok: true, value: { projectId: id, name: "Bracket", revision: 4 } }
    })
    deliverProjectChange(id)
    await vi.advanceTimersByTimeAsync(500)
    const heartbeat = deferred<ReturnType<typeof ok>>()
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/poll" ? heartbeat.promise : original?.(path, ...args),
    )
    await vi.advanceTimersByTimeAsync(500)
    opening.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await connection.disable()
    heartbeat.resolve(emptyPoll)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.request.mock.calls.filter(([path]) => path === "/result")).toHaveLength(0)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, projectManagement: false })
  })

  it("retains source recovery identity when renewal completes after the project handle changes", async () => {
    await ready()
    const expiring = { ...credential, expiresAt: Date.now() + 60_000 }
    const initial = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/connect" || path === "/renew" ? ok(expiring) : initial?.(path, ...args),
    )
    await connection.enable()
    connection.setProjectManagement(true)
    const old = mocks.createHandle.mock.results[0]?.value
    const nextId = "0195b5ac-b250-7a2c-8c33-000000000002"
    mocks.createHandle.mockReturnValue({
      ...old,
      documentId: nextId,
      dispose: vi.fn(),
      readIdentity: () => ({ id: nextId, name: "Assembly", revision: 1 }),
    })
    const options = projectOptions()
    const opening = deferred<void>()
    mocks.execute.mockImplementation(async () => {
      old.readIdentity = () => null
      await opening.promise
      expect(options.replaceSession()).toBe(true)
      return { ok: true, value: { projectId: nextId, name: "Assembly", revision: 1 } }
    })
    deliverProjectChange(nextId)
    await vi.advanceTimersByTimeAsync(500)
    const renewal = deferred<ReturnType<typeof ok>>()
    const accepted = deferred<ReturnType<typeof ok>>()
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) => {
      if (path === "/renew") return renewal.promise
      if (path === "/result") return accepted.promise
      return original?.(path, ...args)
    })
    await vi.advanceTimersByTimeAsync(500)
    opening.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.request.mock.calls.filter(([path]) => path === "/result")).toHaveLength(0)
    renewal.resolve(ok(credential))
    await vi.advanceTimersByTimeAsync(0)
    expect(JSON.parse(sessionStorage.getItem("vibeshape-local-ai-resume") ?? "{}")).toMatchObject({
      documentId: id,
      expiresAt: credential.expiresAt,
    })
    expect(mocks.request.mock.calls.filter(([path]) => path === "/result")).toHaveLength(1)
    accepted.resolve(ok({ ok: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(JSON.parse(sessionStorage.getItem("vibeshape-local-ai-resume") ?? "{}").documentId).toBe(
      nextId,
    )
  })

  it("preserves auto-apply for a same-project open without replacing the handle", async () => {
    await ready()
    await connection.enable()
    connection.setProjectManagement(true)
    connection.enableAutoApply()
    mocks.execute.mockResolvedValue({
      ok: true,
      value: { projectId: id, name: "Bracket", revision: 4 },
    })
    deliverProjectChange(id)
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      busy: false,
      autoApply: true,
    })
    expect(mocks.createHandle).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
  })

  it("refreshes a reopened source handle after rollback with the remembered auto-apply mode", async () => {
    await ready()
    await connection.enable()
    connection.setProjectManagement(true)
    connection.enableAutoApply()
    const old = mocks.createHandle.mock.results[0]?.value
    const replacement = { ...old, dispose: vi.fn() }
    const options = projectOptions()
    mocks.createHandle.mockReturnValue(replacement)
    mocks.execute.mockImplementation(async () => {
      old.readIdentity = () => null
      expect(options.replaceSession()).toBe(true)
      return failedResult
    })
    deliverProjectChange()
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      busy: false,
      autoApply: true,
      projectManagement: true,
    })
    expect(mocks.createExecutor).toHaveBeenLastCalledWith(
      replacement,
      credential.actor,
      expect.anything(),
    )
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(replacement.dispose).not.toHaveBeenCalled()
  })

  it("does not reacquire a handle or submit a result after Stop interrupts a project switch", async () => {
    await ready()
    await connection.enable()
    connection.setProjectManagement(true)
    const pending = deferred<void>()
    const options = projectOptions()
    mocks.execute.mockImplementation(async () => {
      await pending.promise
      expect(options.isAllowed()).toBe(false)
      expect(options.replaceSession()).toBe(false)
      return failedResult
    })
    deliverProjectChange()
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.isProjectActionPending()).toBe(true)
    await connection.disable()
    pending.resolve()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, projectManagement: false })
    expect(mocks.createHandle).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls.filter(([path]) => path === "/result")).toHaveLength(0)
  })

  it("clears the project grant and revokes pairing after manual project navigation", async () => {
    await ready()
    await connection.enable()
    connection.setProjectManagement(true)
    const handle = mocks.createHandle.mock.results[0]?.value
    if (!handle) throw new Error("Missing paired document handle.")
    handle.readIdentity = () => null
    connection.validateDocumentScope()
    expect(connection.getSnapshot()).toMatchObject({ connected: false, projectManagement: false })
    expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, credential.token, true)
  })
})
describe("browser-owned local AI connection lifecycle", () => {
  it("discovers the bridge after React StrictMode replays the owner effect", async () => {
    function Owner() {
      useEffect(() => {
        connection.start()
        void connection.status()
        return connection.dispose
      }, [])
      return null
    }
    await act(async () => {
      render(createElement(StrictMode, null, createElement(Owner)))
    })
    expect(mocks.request.mock.calls.filter(([path]) => path === "/status")).toHaveLength(2)
    expect(connection.getSnapshot()).toMatchObject({ available: true, connected: false, client })
    expect(await connection.enable()).toBe(true)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: false })
  })

  it("ignores a prior owner's late status after restarting the connection", async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    mocks.request.mockReturnValueOnce(pending.promise)
    connection.start()
    const previousStatus = connection.status()
    connection.dispose()
    connection.start()
    await connection.status()
    pending.resolve(ok({ protocolVersion: 1, client: null, paired: false }))
    await previousStatus
    expect(connection.getSnapshot()).toMatchObject({ available: true, connected: false, client })
  })

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
    expect(mocks.execute).toHaveBeenCalledTimes(1)
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
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, busy: true })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
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
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    acknowledgement.resolve({ ok: false, status: 401, data: {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, busy: false, error: true })
    expect(dispose).toHaveBeenCalledTimes(1)
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
    expect(dispose).toHaveBeenCalledTimes(1)
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
    created.value.readIdentity = () => null
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
    expect(dispose).toHaveBeenCalledTimes(1)
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
    expect(listener).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
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
    expect(dispose).toHaveBeenCalledTimes(1)
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
    expect(dispose).toHaveBeenCalledTimes(1)
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
  it("does not let a disposed owner's late resume revoke the replacement owner's grant", async () => {
    await ready()
    await connection.enable()
    window.dispatchEvent(new Event("pagehide"))
    const late = deferred<ReturnType<typeof ok>>()
    const original = mocks.request.getMockImplementation()
    let resumes = 0
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/resume" && ++resumes === 1 ? late.promise : original?.(path, ...args),
    )
    await connection.status()
    await vi.advanceTimersByTimeAsync(1000)
    const previous = connection
    previous.dispose()
    connection = createLocalAutomationConnection()
    await ready()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot().connected).toBe(true)
    late.resolve(ok({ ...credential, token: "B".repeat(43) }))
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.getSnapshot().connected).toBe(true)
    expect(mocks.request).not.toHaveBeenCalledWith("/revoke", {}, "B".repeat(43), true)
  })
  it.each([204, 503])(
    "handles late grant revocation status %i after explicit Stop AI",
    async (status) => {
      await ready()
      await connection.enable()
      window.dispatchEvent(new Event("pagehide"))
      const late = deferred<ReturnType<typeof ok>>()
      const original = mocks.request.getMockImplementation()
      mocks.request.mockImplementation((path: string, ...args: unknown[]) => {
        if (path === "/resume") return late.promise
        if (path === "/revoke" && args[1] === "B".repeat(43))
          return { ok: status === 204, status, data: null }
        return original?.(path, ...args)
      })
      await connection.status()
      await vi.advanceTimersByTimeAsync(1000)
      await connection.disable()
      late.resolve(ok({ ...credential, token: "B".repeat(43) }))
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.getSnapshot().connected).toBe(false)
      expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, "B".repeat(43), true)
      expect(connection.getSnapshot().error).toBe(status !== 204)
    },
  )
  it("clears an older automatic grant if persisting a manual opt-out fails", async () => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    const write = vi
      .spyOn(Object.getPrototypeOf(sessionStorage), "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage quota exceeded.", "QuotaExceededError")
      })
    try {
      expect(connection.disableAutoApply()).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
      expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
      expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, credential.token, true)
    } finally {
      write.mockRestore()
    }
    connection.dispose()
    connection = createLocalAutomationConnection()
    await ready()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
  })
  it("restores the same document after cancelled navigation with the reviewed auto-apply grant", async () => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    window.dispatchEvent(new Event("beforeunload"))
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: true })
    expect(mocks.request).toHaveBeenCalledWith(
      "/resume",
      { protocolVersion: 1, document: { id, name: "Bracket", revision: 4 } },
      credential.token,
    )
    expect(JSON.parse(sessionStorage.getItem("vibeshape-local-ai-resume") ?? "null")).toMatchObject(
      { token: "B".repeat(43), autoApply: true },
    )
    expect(enableAutoApply).toHaveBeenCalledWith(credential.actor)
  })
  it("does not restore cancelled navigation after explicit Stop AI", async () => {
    await ready()
    await connection.enable()
    window.dispatchEvent(new Event("beforeunload"))
    await connection.disable()
    await vi.advanceTimersByTimeAsync(1000)
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
  it("recovers a transport failure without revoking the reviewed session", async () => {
    await ready()
    const polling = deferred<ReturnType<typeof ok>>()
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/poll" ? polling.promise : original?.(path, ...args),
    )
    await connection.enable()
    polling.reject(new LocalAutomationTransportError("The network failed."))
    await vi.advanceTimersByTimeAsync(1)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, error: true })
    expect(mocks.request).not.toHaveBeenCalledWith("/revoke", {}, credential.token, true)
    mocks.request.mockImplementation((...args) => original?.(...args))
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, error: false })
    expect(mocks.request).not.toHaveBeenCalledWith("/connect", expect.anything(), expect.anything())
  })
  it("restores the same project in a fresh connection with the reviewed auto-apply grant", async () => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    window.dispatchEvent(new Event("pagehide"))
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
    expect(mocks.request).toHaveBeenCalledWith("/suspend", {}, credential.token, true)
    const previous = connection
    connection = createLocalAutomationConnection()
    await ready()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: true })
    expect(mocks.request).toHaveBeenCalledWith(
      "/resume",
      {
        protocolVersion: 1,
        document: { id, name: "Bracket", revision: 4 },
      },
      credential.token,
    )
    expect(JSON.parse(sessionStorage.getItem("vibeshape-local-ai-resume") ?? "null")).toMatchObject(
      { autoApply: true, token: "B".repeat(43) },
    )
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
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.request).not.toHaveBeenCalledWith("/resume", expect.anything(), expect.anything())
    mocks.createHandle.mockImplementation(create)
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot().connected).toBe(true)
  })
  it("reconnects a different project with fresh authority and the remembered mode", async () => {
    await ready()
    await connection.enable()
    window.dispatchEvent(new Event("pagehide"))
    mocks.createHandle.mockReturnValue({
      ok: true,
      dispose,
      readIdentity: () => ({
        id: "0195b5ac-b250-7a2c-8c33-000000000002",
        revision: 0,
        name: "Other",
      }),
    })
    await connection.status()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot().connected).toBe(false)
    expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, credential.token, true)
    expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
    await connection.status()
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: false })
    expect(mocks.request).toHaveBeenLastCalledWith("/poll", expect.anything(), credential.token)
  })
  it("does not resume after Stop AI or a rejected resume", async () => {
    await ready()
    await connection.enable()
    window.dispatchEvent(new Event("pagehide"))
    await connection.disable()
    await connection.status()
    await vi.advanceTimersByTimeAsync(1000)
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
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot()).toMatchObject({ connected: false, error: true })
    expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
  })
  it("replaces an expired or malformed reload credential using the remembered preference", async () => {
    await ready()
    await connection.enable()
    window.dispatchEvent(new Event("pagehide"))
    vi.setSystemTime(Date.now() + 3_600_001)
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/connect"
        ? ok({ ...credential, expiresAt: Date.now() + 3_600_000 })
        : original?.(path, ...args),
    )
    await connection.status()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.getSnapshot().connected).toBe(true)
    expect(mocks.request).toHaveBeenCalledWith("/connect", expect.anything(), undefined)
    connection.dispose()
    connection = createLocalAutomationConnection()
    sessionStorage.setItem("vibeshape-local-ai-resume", "{invalid")
    await ready()
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.getSnapshot().connected).toBe(true)
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
  await vi.advanceTimersByTimeAsync(1000)
  expect(connection.getSnapshot().connected).toBe(true)
})

it("uses lightweight identity for heartbeat without projecting model measurements", async () => {
  await ready()
  await connection.enable()
  await vi.advanceTimersByTimeAsync(5000)
  const handle = mocks.createHandle.mock.results[0]?.value
  expect(handle.readInfo).not.toHaveBeenCalled()
  expect(mocks.request.mock.calls.filter(([path]) => path === "/poll").length).toBeGreaterThan(5)
})
it("retains recovery through a temporary bridge outage and clears it on changed client", async () => {
  await ready()
  await connection.enable()
  connection.enableAutoApply()
  window.dispatchEvent(new Event("pagehide"))
  const original = mocks.request.getMockImplementation()
  let offline = true
  mocks.request.mockImplementation((path: string, ...args: unknown[]) => {
    if (path === "/status" && offline) throw new LocalAutomationTransportError("Offline")
    return original?.(path, ...args)
  })
  window.dispatchEvent(new Event("pageshow"))
  await vi.advanceTimersByTimeAsync(3000)
  expect(connection.getSnapshot().connected).toBe(false)
  expect(sessionStorage.getItem("vibeshape-local-ai-resume")).not.toBeNull()
  offline = false
  await vi.advanceTimersByTimeAsync(1000)
  expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: true })
  window.dispatchEvent(new Event("pagehide"))
  mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
    path === "/status"
      ? ok({ protocolVersion: 1, client: { name: "Other client", version: "1" }, paired: false })
      : original?.(path, ...args),
  )
  window.dispatchEvent(new Event("pageshow"))
  await vi.advanceTimersByTimeAsync(1000)
  expect(connection.getSnapshot().connected).toBe(false)
  expect(sessionStorage.getItem("vibeshape-local-ai-resume")).toBeNull()
})

describe("remembered local MCP preferences", () => {
  async function restartBrowserSession() {
    connection.dispose()
    sessionStorage.clear()
    connection = createLocalAutomationConnection()
    await ready()
    await vi.advanceTimersByTimeAsync(0)
  }
  it("reconnects with auto-apply after browser session storage is lost", async () => {
    await ready()
    await connection.enable()
    expect(connection.enableAutoApply()).toBe(true)
    await restartBrowserSession()
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      autoApply: true,
      projectManagement: false,
    })
    expect(
      JSON.parse(window.localStorage.getItem("vibeshape-local-ai-preferences") ?? "null"),
    ).toEqual({ client, autoApply: true })
    expect(mocks.request).not.toHaveBeenCalledWith("/resume", expect.anything(), expect.anything())
  })
  it("remembers a return to manual approval across fresh sessions", async () => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    expect(connection.disableAutoApply()).toBe(true)
    enableAutoApply.mockClear()
    await restartBrowserSession()
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: false })
    expect(enableAutoApply).not.toHaveBeenCalled()
  })
  it("does not reconnect after Stop AI even when auto-apply was enabled", async () => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    await connection.disable()
    mocks.request.mockClear()
    await restartBrowserSession()
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
    expect(window.localStorage.getItem("vibeshape-local-ai-preferences")).toBeNull()
    expect(mocks.request).not.toHaveBeenCalledWith("/connect", expect.anything(), expect.anything())
  })
  it("waits for the remembered client and does not approve a different one", async () => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/status"
        ? ok({ protocolVersion: 1, client: { name: "Other", version: "1" }, paired: false })
        : original?.(path, ...args),
    )
    await restartBrowserSession()
    expect(connection.getSnapshot()).toMatchObject({ connected: false, autoApply: false })
    mocks.request.mockImplementation((...args) => original?.(...args))
    await connection.status()
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.getSnapshot()).toMatchObject({ connected: true, autoApply: true })
  })
  it("rejects a client replacement between discovery and automatic pairing", async () => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/connect"
        ? ok({ ...credential, client: { name: "Other", version: "1" } })
        : original?.(path, ...args),
    )
    await restartBrowserSession()
    expect(connection.getSnapshot()).toMatchObject({
      connected: false,
      autoApply: false,
      error: true,
    })
    expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, credential.token, true)
  })
  it("does not recreate preferences when Stop AI races automatic pairing", async () => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    const pending = deferred<ReturnType<typeof ok>>()
    const original = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/connect" ? pending.promise : original?.(path, ...args),
    )
    await restartBrowserSession()
    await connection.disable()
    pending.resolve(ok(credential))
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.getSnapshot().connected).toBe(false)
    expect(window.localStorage.getItem("vibeshape-local-ai-preferences")).toBeNull()
    expect(mocks.request).toHaveBeenCalledWith("/revoke", {}, credential.token, true)
  })
  it("ignores malformed preferences and refuses auto-apply when storage is unavailable", async () => {
    window.localStorage.setItem("vibeshape-local-ai-preferences", "{invalid")
    await ready()
    expect(connection.getSnapshot().connected).toBe(false)
    await connection.enable()
    const storage = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable")
    })
    try {
      expect(connection.enableAutoApply()).toBe(false)
      expect(connection.getSnapshot().autoApply).toBe(false)
      expect(optOut).toHaveBeenCalled()
    } finally {
      storage.mockRestore()
    }
  })
})

it.each(["/poll", "/resume", "/renew"])(
  "reconnects the remembered client after %s loses its credential",
  async (route) => {
    await ready()
    await connection.enable()
    connection.enableAutoApply()
    if (route === "/resume") window.dispatchEvent(new Event("pagehide"))
    if (route === "/renew") vi.setSystemTime(credential.expiresAt - 60_000)
    const original = mocks.request.getMockImplementation()
    let lost = true
    mocks.request.mockImplementation((path: string, ...args: unknown[]) => {
      if (path === route && lost) {
        lost = false
        return { ok: false, status: 401, data: { diagnostic: { code: "unauthorized" } } }
      }
      if (path === "/connect")
        return ok({ ...credential, token: "C".repeat(43), expiresAt: Date.now() + 3_600_000 })
      return original?.(path, ...args)
    })
    await connection.status()
    await vi.advanceTimersByTimeAsync(1000)
    await connection.status()
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      autoApply: true,
      error: false,
    })
    expect(mocks.request).toHaveBeenCalledWith("/connect", expect.anything(), undefined)
    expect(JSON.parse(sessionStorage.getItem("vibeshape-local-ai-resume") ?? "null").token).toBe(
      "C".repeat(43),
    )
    expect(mocks.execute).not.toHaveBeenCalled()
  },
)
