import {
  type LocalConnection,
  type LocalWork,
  localConnectResponseSchema,
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
  client: LocalConnection["client"] | null
  error: boolean
}>
type Pair = {
  credential: LocalConnection
  handle: Handle
  executor: ReturnType<typeof createLocalToolExecutor>
  sequence: number
  active: { work: LocalWork; controller: AbortController } | null
  timer: ReturnType<typeof setTimeout> | null
}
const acknowledgement = z.object({ ok: z.literal(true) }).strict()

export function createLocalAutomationConnection() {
  let snapshot: Snapshot = { available: false, connected: false, client: null, error: false }
  let pair: Pair | null = null
  let generation = 0
  let enabling = false
  const listeners = new Set<() => void>()
  function publish(next: Snapshot) {
    snapshot = next
    for (const listener of listeners) listener()
  }
  async function revokeCredential(credential: LocalConnection) {
    await localAutomationRequest("/revoke", {}, credential.token, true).catch(() => undefined)
  }
  function closeLocal(current: Pair) {
    if (current.timer) clearTimeout(current.timer)
    current.active?.controller.abort()
    current.handle.dispose()
    if (pair === current) pair = null
  }
  async function disable() {
    generation += 1
    const current = pair
    if (current) closeLocal(current)
    if (snapshot.connected) publish({ ...snapshot, connected: false })
    if (current) await revokeCredential(current.credential)
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
    current.active = { work, controller }
    let result: unknown
    try {
      result = await current.executor.execute(work.operation, controller.signal)
      result = localToolOutputs[work.operation.tool].parse(result)
    } catch {
      result = localFailure("automation-failed", "The local automation request failed.", true)
    }
    if (pair !== current || controller.signal.aborted) return
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
    }
  }
  function progress(current: Pair) {
    const active = current.active
    if (!active) return null
    const review =
      active.work.operation.tool === "commit_draft" ? automationReviews.getSnapshot() : null
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
      if (value.work) void dispatch(current, value.work)
    } catch {
      await fail(current)
    } finally {
      if (pair === current) current.timer = setTimeout(() => void poll(current), 500)
    }
  }
  async function connect(created: Handle, at: number) {
    const info = created.readInfo()
    if (!info) throw new Error("The document session is unavailable.")
    const response = await localAutomationRequest("/connect", {
      protocolVersion: 1,
      document: {
        id: info.summary.documentId,
        name: info.summary.data.name,
        revision: info.summary.revision,
      },
    })
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
      timer: null,
    }
    pair = current
    publish({ available: true, connected: true, client: credential.client, error: false })
    void poll(current)
    return true
  }
  async function enable() {
    if (enabling || pair || !snapshot.available || !snapshot.client) return false
    enabling = true
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
      enabling = false
    }
  }
  const onPageHide = () => void disable()
  return {
    enable,
    disable,
    status,
    start() {
      window.addEventListener("pagehide", onPageHide)
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      window.removeEventListener("pagehide", onPageHide)
      void disable()
    },
  }
}
