import {
  type LocalConnection,
  type LocalWork,
  localConnectResponseSchema,
  localDocumentSchema,
  localPollResponseSchema,
  localStatusSchema,
} from "@vibeshape/automation-api/local-session"
import { localFailure, localToolOutputs } from "@vibeshape/automation-api/local-tools"
import { z } from "zod"
import { createActiveDocumentAutomationSession } from "../document/document-controller"
import { automationReviews } from "./automation-review-controller"
import { localAutomationRequest } from "./local-automation-http"
import { createLocalToolExecutor } from "./local-tool-executor"

type Handle = Extract<ReturnType<typeof createActiveDocumentAutomationSession>, { ok: true }>
type Snapshot = Readonly<{
  available: boolean
  connected: boolean
  autoApply: boolean
  busy: boolean
  client: LocalConnection["client"] | null
  error: boolean
}>
type Pair = {
  credential: LocalConnection
  handle: Handle
  executor: ReturnType<typeof createLocalToolExecutor>
  sequence: number
  active: { work: LocalWork; controller: AbortController; acknowledging: boolean } | null
  queuedWork: LocalWork | null
  timer: ReturnType<typeof setTimeout> | null
}
const resumeKey = "vibeshape-local-ai-resume"
const resumeSchema = z
  .object({
    documentId: localDocumentSchema.shape.id,
    token: localConnectResponseSchema.shape.token,
    expiresAt: localConnectResponseSchema.shape.expiresAt,
    resumeUntil: z.number().int().positive(),
  })
  .strict()
function readResume() {
  try {
    const value = resumeSchema.safeParse(JSON.parse(sessionStorage.getItem(resumeKey) ?? "null"))
    return value.success && Math.min(value.data.expiresAt, value.data.resumeUntil) > Date.now()
      ? value.data
      : null
  } catch {
    return null
  }
}
function clearResume() {
  try {
    sessionStorage.removeItem(resumeKey)
  } catch {
    /* Storage can be unavailable. */
  }
}
const acknowledgement = z.object({ ok: z.literal(true) }).strict()

export function createLocalAutomationConnection() {
  let snapshot: Snapshot = {
    available: false,
    connected: false,
    autoApply: false,
    busy: false,
    client: null,
    error: false,
  }
  let pair: Pair | null = null
  let generation = 0
  let connecting = false
  let restoreTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()
  function publish(next: Snapshot) {
    snapshot = next
    for (const listener of listeners) listener()
  }
  async function revokeCredential(credential: Pick<LocalConnection, "token">) {
    await localAutomationRequest("/revoke", {}, credential.token, true).catch(() => undefined)
  }
  function closeLocal(current: Pair) {
    if (current.timer) clearTimeout(current.timer)
    current.active?.controller.abort()
    current.queuedWork = null
    current.handle.dispose()
    if (pair === current) pair = null
  }
  async function disable() {
    generation += 1
    const saved = readResume()
    clearResume()
    if (restoreTimer) clearTimeout(restoreTimer)
    restoreTimer = null
    const current = pair
    if (current) closeLocal(current)
    if (snapshot.connected)
      publish({ ...snapshot, connected: false, autoApply: false, busy: false })
    if (current) await revokeCredential(current.credential)
    else if (saved) await revokeCredential(saved)
  }
  async function fail(current: Pair) {
    if (pair !== current) return
    await disable()
    publish({ ...snapshot, error: true })
  }
  async function status() {
    if (!document.querySelector('meta[name="vibeshape-local-automation"][content="1"]')) return
    const at = generation
    try {
      const response = await localAutomationRequest("/status", {})
      const value = localStatusSchema.parse(response.data)
      if (!response.ok || generation !== at) return
      publish({ ...snapshot, available: true, client: value.client, error: false })
      if (readResume()) {
        if (!restoreTimer) retryRestore()
      } else clearResume()
    } catch {
      if (generation === at) publish({ ...snapshot, available: false })
    }
  }
  async function dispatch(current: Pair, work: LocalWork) {
    if (pair !== current) return
    if (current.active) {
      await fail(current)
      return
    }
    const controller = new AbortController()
    current.active = { work, controller, acknowledging: false }
    publish({ ...snapshot, busy: true })
    let result: unknown
    try {
      result = await current.executor.execute(work.operation, controller.signal)
      result = localToolOutputs[work.operation.tool].parse(result)
    } catch {
      result = localFailure("automation-failed", "The local automation request failed.", true)
    }
    if (pair !== current || controller.signal.aborted) return
    await sendOperationResult(current, work, result)
  }
  async function sendOperationResult(current: Pair, work: LocalWork, result: unknown) {
    if (current.active) current.active.acknowledging = true
    try {
      const response = await localAutomationRequest(
        "/result",
        {
          protocolVersion: 1,
          requestId: work.requestId,
          tool: work.operation.tool,
          result,
        },
        current.credential.token,
      )
      if (!response.ok || !acknowledgement.safeParse(response.data).success)
        throw new Error("The operation result was not accepted.")
    } catch {
      await fail(current)
    } finally {
      current.active = null
      if (pair === current) {
        const queued = current.queuedWork
        current.queuedWork = null
        if (queued) void dispatch(current, queued)
        else publish({ ...snapshot, busy: false })
      }
    }
  }
  function acceptWork(current: Pair, work: LocalWork) {
    const active = current.active
    if (!active?.acknowledging) {
      void dispatch(current, work)
      return
    }
    // The server may deliver the next request before the prior result ACK reaches this tab.
    if (current.queuedWork || active.work.requestId === work.requestId) {
      void fail(current)
      return
    }
    current.queuedWork = work
  }
  function progress(current: Pair) {
    const active = current.active
    if (!active) return null
    const review = [
      "commit_draft",
      "commit_import_upload",
      "change_metadata",
      "commit_assembly_draft",
      "save_library_definition",
      "update_library_metadata",
      "create_surface_texture",
      "update_surface_texture",
      "remove_surface_texture",
    ].includes(active.work.operation.tool)
      ? automationReviews.getSnapshot()
      : null
    const stage =
      review?.status === "applying"
        ? "applying"
        : review?.status === "ready"
          ? "review"
          : "executing"
    return { requestId: active.work.requestId, stage }
  }
  async function poll(current: Pair) {
    if (pair !== current) return
    try {
      const info = current.handle.readInfo()
      if (!info) {
        await disable()
        return
      }
      current.sequence += 1
      const response = await localAutomationRequest(
        "/poll",
        {
          protocolVersion: 1,
          sequence: current.sequence,
          document: {
            id: info.summary.documentId,
            name: info.summary.data.name,
            revision: info.summary.revision,
          },
          progress: progress(current),
        },
        current.credential.token,
      )
      if (pair !== current) return
      const value = localPollResponseSchema.parse(response.data)
      if (!response.ok || value.cancelledRequestIds.length)
        throw new Error("The session was revoked.")
      if (value.work) acceptWork(current, value.work)
    } catch {
      await fail(current)
    } finally {
      if (pair === current) current.timer = setTimeout(() => void poll(current), 500)
    }
  }
  async function connect(
    created: Handle,
    at: number,
    saved?: NonNullable<ReturnType<typeof readResume>>,
  ) {
    const info = created.readInfo()
    if (!info) throw new Error("The document session is unavailable.")
    const response = await localAutomationRequest(
      saved ? "/resume" : "/connect",
      {
        protocolVersion: 1,
        document: {
          id: info.summary.documentId,
          name: info.summary.data.name,
          revision: info.summary.revision,
        },
      },
      saved?.token,
    )
    const credential = localConnectResponseSchema.parse(response.data)
    if (!response.ok) throw new Error("The local AI bridge rejected pairing.")
    if (generation !== at || !created.readInfo()) {
      await revokeCredential(credential)
      created.dispose()
      return false
    }
    const current: Pair = {
      credential,
      handle: created,
      executor: createLocalToolExecutor(created, credential.actor),
      sequence: 0,
      active: null,
      queuedWork: null,
      timer: null,
    }
    pair = current
    clearResume()
    publish({
      available: true,
      connected: true,
      autoApply: false,
      busy: false,
      client: credential.client,
      error: false,
    })
    void poll(current)
    return true
  }
  async function enable() {
    if (connecting || pair || !snapshot.available || !snapshot.client) return false
    connecting = true
    const at = ++generation
    const created = createActiveDocumentAutomationSession()
    try {
      if (!created.ok) throw new Error("The active document is unavailable.")
      return await connect(created, at)
    } catch {
      if (created.ok) created.dispose()
      if (generation === at) publish({ ...snapshot, connected: false, error: true })
      return false
    } finally {
      connecting = false
    }
  }
  async function restore() {
    if (connecting || pair) return
    const saved = readResume()
    if (!saved) {
      clearResume()
      return
    }
    connecting = true
    const at = generation
    try {
      await resumeDocument(saved, at)
    } catch {
      if (generation === at) {
        clearResume()
        await revokeCredential(saved)
        if (generation === at) publish({ ...snapshot, error: true })
      }
    } finally {
      connecting = false
    }
  }
  function retryRestore() {
    restoreTimer = setTimeout(() => {
      restoreTimer = null
      void restore()
    }, 250)
  }
  async function resumeDocument(saved: NonNullable<ReturnType<typeof readResume>>, at: number) {
    const created = createActiveDocumentAutomationSession()
    if (!created.ok) {
      retryRestore()
      return
    }
    const info = created.readInfo()
    if (!info) {
      created.dispose()
      retryRestore()
      return
    }
    if (info.summary.documentId !== saved.documentId) {
      created.dispose()
      clearResume()
      await revokeCredential(saved)
      return
    }
    try {
      await connect(created, at, saved)
    } catch (error) {
      created.dispose()
      throw error
    }
  }
  const onPageHide = () => {
    generation += 1
    if (restoreTimer) clearTimeout(restoreTimer)
    restoreTimer = null
    const current = pair
    if (!current) return
    const info = current.handle.readInfo()
    try {
      if (!info) throw new Error("The document session ended.")
      sessionStorage.setItem(
        resumeKey,
        JSON.stringify({
          documentId: info.summary.documentId,
          token: current.credential.token,
          expiresAt: current.credential.expiresAt,
          resumeUntil: Date.now() + 60_000,
        }),
      )
    } catch {
      void disable()
      return
    }
    closeLocal(current)
    publish({ ...snapshot, connected: false, autoApply: false, busy: false })
    void localAutomationRequest("/suspend", {}, current.credential.token, true).catch(
      () => undefined,
    )
  }
  const onBeforeUnload = () => {
    // Browsers may abort fetch before pagehide. Suspend while the document handle is live.
    onPageHide()
    // If navigation is cancelled, the current document must regain its reviewed connection.
    if (readResume()) retryRestore()
  }
  const onPageShow = () => {
    void status()
  }
  return {
    enable,
    enableAutoApply() {
      const current = pair
      if (
        !current ||
        current.active ||
        !current.handle.readInfo() ||
        !current.handle.enableAutoApply(current.credential.actor)
      )
        return false
      publish({ ...snapshot, autoApply: true })
      return true
    },
    disable,
    status,
    start() {
      window.addEventListener("beforeunload", onBeforeUnload)
      window.addEventListener("pagehide", onPageHide)
      window.addEventListener("pageshow", onPageShow)
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      window.removeEventListener("beforeunload", onBeforeUnload)
      window.removeEventListener("pagehide", onPageHide)
      window.removeEventListener("pageshow", onPageShow)
      // Loading-to-ready remounts transfer the tab's recovery record to the new owner.
      if (pair) void disable()
      else {
        generation += 1
        if (restoreTimer) clearTimeout(restoreTimer)
        restoreTimer = null
      }
    },
  }
}
