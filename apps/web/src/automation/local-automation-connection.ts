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
import { LocalAutomationTransportError, localAutomationRequest } from "./local-automation-http"
import { createLocalToolExecutor } from "./local-tool-executor"
import { createProjectToolPort } from "./project-tool-port"

type Handle = Extract<ReturnType<typeof createActiveDocumentAutomationSession>, { ok: true }>
type Identity = ReturnType<Handle["readIdentity"]>
type Snapshot = Readonly<{
  available: boolean
  connected: boolean
  recovering: boolean
  autoApply: boolean
  projectManagement: boolean
  busy: boolean
  client: LocalConnection["client"] | null
  error: boolean
}>
type Pair = {
  credential: LocalConnection
  handle: Handle
  executor: ReturnType<typeof createLocalToolExecutor> | null
  sequence: number
  active: {
    work: LocalWork
    controller: AbortController
    acknowledging: boolean
    sourceIdentity: Identity
  } | null
  polling: Promise<void> | null
  queuedWork: LocalWork | null
  timer: ReturnType<typeof setTimeout> | null
}
const preferenceKey = "vibeshape-local-ai-preferences"
const preferenceSchema = z
  .object({
    client: localConnectResponseSchema.shape.client,
    autoApply: z.boolean(),
  })
  .strict()
function readPreference() {
  try {
    const value = preferenceSchema.safeParse(
      JSON.parse(window.localStorage.getItem(preferenceKey) ?? "null"),
    )
    return value.success ? value.data : null
  } catch {
    return null
  }
}
function writePreference(client: LocalConnection["client"], autoApply: boolean) {
  try {
    window.localStorage.setItem(preferenceKey, JSON.stringify({ client, autoApply }))
    return true
  } catch {
    return false
  }
}
function clearPreference() {
  try {
    window.localStorage.removeItem(preferenceKey)
  } catch {
    /* Storage can be unavailable. */
  }
}
function sameClient(left: LocalConnection["client"], right: LocalConnection["client"] | null) {
  return left.name === right?.name && left.version === right?.version
}
const resumeKey = "vibeshape-local-ai-resume"
const resumeSchema = z
  .object({
    documentId: localDocumentSchema.shape.id,
    token: localConnectResponseSchema.shape.token,
    expiresAt: localConnectResponseSchema.shape.expiresAt,
    resumeUntil: z.number().int().positive().optional(),
    client: localConnectResponseSchema.shape.client.optional(),
    autoApply: z.boolean().default(false),
  })
  .strict()
function readResume() {
  try {
    const value = resumeSchema.safeParse(JSON.parse(sessionStorage.getItem(resumeKey) ?? "null"))
    return value.success &&
      Math.min(value.data.expiresAt, value.data.resumeUntil ?? value.data.expiresAt) > Date.now()
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
class LocalAutomationSessionLostError extends Error {}
function requireSessionCredential(response: { status: number }) {
  if (response.status === 401 || response.status === 410)
    throw new LocalAutomationSessionLostError("The local session credential is no longer valid.")
}
const acknowledgement = z.object({ ok: z.literal(true) }).strict()

export function createLocalAutomationConnection() {
  let snapshot: Snapshot = {
    available: false,
    connected: false,
    recovering: false,
    autoApply: false,
    projectManagement: false,
    busy: false,
    client: null,
    error: false,
  }
  let pair: Pair | null = null
  let generation = 0
  let revokedThroughGeneration = -1
  let automaticConnectionBlocked = false
  let connecting = false
  let disposed = false
  let restoreTimer: ReturnType<typeof setTimeout> | null = null
  let statusTimer: ReturnType<typeof setTimeout> | null = null
  let statusRequest: Promise<void> | null = null
  const listeners = new Set<() => void>()
  function publish(next: Snapshot) {
    snapshot = next
    for (const listener of listeners) listener()
  }
  function retainedIdentity(current: Pair) {
    return isProjectChange(current)
      ? (current.active?.sourceIdentity ?? null)
      : current.handle.readIdentity()
  }
  function saveResume(current: Pair, info: Identity = retainedIdentity(current)) {
    if (!info) return false
    try {
      sessionStorage.setItem(
        resumeKey,
        JSON.stringify({
          documentId: info.id,
          token: current.credential.token,
          expiresAt: current.credential.expiresAt,
          client: current.credential.client,
          autoApply: snapshot.autoApply,
        }),
      )
      return true
    } catch {
      return false
    }
  }
  function retryableResponse(response: { status: number; data: unknown }) {
    return (
      response.status >= 500 ||
      response.status === 408 ||
      response.status === 429 ||
      (response.status === 409 &&
        z
          .object({ diagnostic: z.object({ code: z.literal("session-suspended") }) })
          .safeParse(response.data).success)
    )
  }
  async function recover(current: Pair) {
    if (pair !== current) return
    if (!saveResume(current)) {
      await fail(current)
      return
    }
    generation += 1
    closeLocal(current)
    publish({
      ...snapshot,
      connected: false,
      recovering: true,
      autoApply: false,
      projectManagement: false,
      busy: false,
      error: true,
    })
    retryRestore()
  }
  async function revokeCredential(credential: Pick<LocalConnection, "token">) {
    try {
      const response = await localAutomationRequest("/revoke", {}, credential.token, true)
      return response.status === 204 || response.status === 401 || response.status === 410
    } catch {
      return false
    }
  }
  function closeLocal(current: Pair) {
    if (current.timer) clearTimeout(current.timer)
    current.active?.controller.abort()
    current.queuedWork = null
    current.handle.dispose()
    if (pair === current) pair = null
  }
  async function disconnect() {
    generation += 1
    revokedThroughGeneration = generation
    const saved = readResume()
    clearResume()
    if (restoreTimer) clearTimeout(restoreTimer)
    restoreTimer = null
    const current = pair
    if (current) closeLocal(current)
    if (snapshot.connected || snapshot.recovering)
      publish({
        ...snapshot,
        connected: false,
        recovering: false,
        autoApply: false,
        projectManagement: false,
        busy: false,
      })
    const credential = current?.credential ?? saved
    if (credential && !(await revokeCredential(credential))) publish({ ...snapshot, error: true })
  }
  async function disable() {
    automaticConnectionBlocked = true
    clearPreference()
    await disconnect()
  }
  async function fail(current: Pair) {
    if (pair !== current) return
    automaticConnectionBlocked = true
    await disconnect()
    publish({ ...snapshot, error: true })
  }
  function isProjectChange(current: Pair) {
    const tool = current.active?.work.operation.tool
    return tool === "create_project" || tool === "open_project"
  }
  function validateDocumentScope() {
    const current = pair
    if (!current || (snapshot.projectManagement && isProjectChange(current))) return
    if (!current.handle.readIdentity()) void disconnect()
  }
  function createExecutor(current: Pair) {
    return createLocalToolExecutor(
      current.handle,
      current.credential.actor,
      createProjectToolPort({
        actor: current.credential.actor,
        isAllowed: () =>
          pair === current &&
          snapshot.connected &&
          snapshot.projectManagement &&
          current.active?.controller.signal.aborted !== true,
        readIdentity: () => current.handle.readIdentity(),
        replaceSession: () => {
          if (
            pair !== current ||
            !snapshot.projectManagement ||
            !current.active ||
            current.active.controller.signal.aborted
          )
            return false
          const created = createActiveDocumentAutomationSession()
          if (!created.ok) return false
          current.handle.dispose()
          current.handle = created
          current.executor = createExecutor(current)
          const autoApply = snapshot.autoApply && created.enableAutoApply(current.credential.actor)
          publish({ ...snapshot, autoApply })
          saveResume(current)
          return true
        },
      }),
    )
  }
  async function readStatus() {
    if (disposed || !document.querySelector('meta[name="vibeshape-local-automation"][content="1"]'))
      return
    const at = generation
    try {
      const response = await localAutomationRequest("/status", {})
      const value = localStatusSchema.parse(response.data)
      if (!response.ok || generation !== at) return
      publishBridgeStatus(value)
    } catch {
      if (generation === at)
        publish({ ...snapshot, available: false, recovering: readResume() !== null })
      if (readResume()) retryRestore()
    }
  }
  async function status() {
    if (statusRequest) return statusRequest
    const request = readStatus()
    statusRequest = request
    try {
      await request
    } finally {
      if (statusRequest === request) statusRequest = null
    }
  }
  function scheduleStatus() {
    if (
      disposed ||
      statusTimer ||
      !document.querySelector('meta[name="vibeshape-local-automation"][content="1"]')
    )
      return
    statusTimer = setTimeout(async () => {
      statusTimer = null
      if (!pair && !connecting) await status()
      scheduleStatus()
    }, 1000)
  }
  function publishBridgeStatus(value: z.infer<typeof localStatusSchema>) {
    const saved = readResume()
    publish({
      ...snapshot,
      available: true,
      client: value.client,
      recovering: !pair && saved !== null,
      error: false,
    })
    if (saved) retryRestore()
    else {
      clearResume()
      const preference = readPreference()
      if (!automaticConnectionBlocked && preference && sameClient(preference.client, value.client))
        void enable(preference.client)
    }
  }
  async function dispatch(current: Pair, work: LocalWork) {
    if (pair !== current) return
    if (current.active || !current.executor) {
      await fail(current)
      return
    }
    const controller = new AbortController()
    current.active = {
      work,
      controller,
      acknowledging: false,
      sourceIdentity: current.handle.readIdentity(),
    }
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
  async function acknowledgeOperationResult(current: Pair, work: LocalWork, result: unknown) {
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
    if (retryableResponse(response))
      throw new LocalAutomationTransportError(
        "The result acknowledgement is temporarily unavailable.",
      )
    if (!response.ok || !acknowledgement.safeParse(response.data).success)
      throw new Error("The operation result was not accepted.")
  }
  function finishOperation(current: Pair) {
    current.active = null
    if (pair !== current) return
    const queued = current.queuedWork
    current.queuedWork = null
    if (queued) void dispatch(current, queued)
    else {
      publish({ ...snapshot, busy: false })
      validateDocumentScope()
    }
  }
  async function sendOperationResult(current: Pair, work: LocalWork, result: unknown) {
    try {
      if (!(await prepareOperationResult(current))) return
      await acknowledgeOperationResult(current, work, result)
      if (pair === current && isProjectChange(current))
        saveResume(current, current.handle.readIdentity())
    } catch (error) {
      if (error instanceof LocalAutomationTransportError) await recover(current)
      else await fail(current)
    } finally {
      finishOperation(current)
    }
  }
  async function prepareOperationResult(current: Pair) {
    const active = current.active
    if (!active) return false
    active.acknowledging = true
    // Drain source heartbeats before a successful result authorizes the target identity.
    if (isProjectChange(current)) await current.polling
    return pair === current && !active.controller.signal.aborted
  }
  function acceptWork(current: Pair, work: LocalWork) {
    const active = current.active
    if (active?.work.requestId === work.requestId) return
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
      "commit_planar_import_upload",
      "change_metadata",
      "commit_assembly_draft",
      "undo_model",
      "redo_model",
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
  async function renew(current: Pair) {
    if (current.credential.expiresAt - Date.now() >= 5 * 60_000) return
    const renewed = await localAutomationRequest("/renew", {}, current.credential.token)
    if (pair !== current) return
    requireSessionCredential(renewed)
    if (retryableResponse(renewed))
      throw new LocalAutomationTransportError("Session renewal is temporarily unavailable.")
    if (!renewed.ok) throw new Error("The local AI session expired.")
    const credential = localConnectResponseSchema.parse(renewed.data)
    if (
      credential.token !== current.credential.token ||
      credential.actor.sessionId !== current.credential.actor.sessionId
    )
      throw new Error("The local session identity changed.")
    current.credential = credential
    saveResume(current)
  }
  async function deliverPoll(current: Pair, info: NonNullable<ReturnType<Handle["readIdentity"]>>) {
    const sequence = current.sequence + 1
    const response = await localAutomationRequest(
      "/poll",
      {
        protocolVersion: 1,
        sequence,
        document: {
          id: info.id,
          name: info.name,
          revision: info.revision,
        },
        progress: progress(current),
      },
      current.credential.token,
    )
    if (pair !== current) return
    requireSessionCredential(response)
    if (retryableResponse(response))
      throw new LocalAutomationTransportError("The browser poll is temporarily unavailable.")
    const value = localPollResponseSchema.parse(response.data)
    current.sequence = sequence
    if (!response.ok || value.cancelledRequestIds.length)
      throw new Error("The session was revoked.")
    if (value.work) acceptWork(current, value.work)
  }
  async function handlePollFailure(current: Pair, error: unknown) {
    if (pair !== current) return
    if (error instanceof LocalAutomationTransportError) await recover(current)
    else if (error instanceof LocalAutomationSessionLostError) await disconnect()
    else await fail(current)
  }
  async function pollSession(current: Pair) {
    try {
      if (isProjectChange(current) && current.active?.acknowledging) return
      const info = retainedIdentity(current)
      if (!info) {
        await disconnect()
        return
      }
      await renew(current)
      if (pair !== current) return
      await deliverPoll(current, info)
    } catch (error) {
      await handlePollFailure(current, error)
    }
  }
  async function poll(current: Pair) {
    if (pair !== current || current.polling) return
    const polling = pollSession(current)
    current.polling = polling
    try {
      await polling
    } finally {
      if (current.polling === polling) current.polling = null
      if (pair === current) current.timer = setTimeout(() => void poll(current), 500)
    }
  }
  function publishConnection(current: Pair, restoreAutoApply: boolean) {
    const autoApply = restoreAutoApply && current.handle.enableAutoApply(current.credential.actor)
    publish({
      available: true,
      connected: true,
      recovering: false,
      autoApply,
      projectManagement: false,
      busy: false,
      client: current.credential.client,
      error: false,
    })
  }
  function connectionStillCurrent(created: Handle, at: number) {
    return generation === at && !disposed && created.readIdentity() !== null
  }
  async function requestConnection(
    info: NonNullable<Identity>,
    saved: ReturnType<typeof readResume> | undefined,
    expectedClient: LocalConnection["client"] | undefined,
  ) {
    const response = await localAutomationRequest(
      saved ? "/resume" : "/connect",
      {
        protocolVersion: 1,
        document: {
          id: info.id,
          name: info.name,
          revision: info.revision,
        },
      },
      saved?.token,
    )
    if (retryableResponse(response))
      throw new LocalAutomationTransportError("The local bridge is temporarily unavailable.")
    if (saved) requireSessionCredential(response)
    if (!response.ok) throw new Error("The local AI bridge rejected pairing.")
    const credential = localConnectResponseSchema.parse(response.data)
    if (expectedClient && !sameClient(expectedClient, credential.client)) {
      await revokeCredential(credential)
      throw new Error("The approved local MCP client changed.")
    }
    return credential
  }
  async function connect(
    created: Handle,
    at: number,
    saved?: NonNullable<ReturnType<typeof readResume>>,
    expectedClient?: LocalConnection["client"],
  ) {
    const info = created.readIdentity()
    if (!info) throw new Error("The document session is unavailable.")
    const credential = await requestConnection(info, saved, expectedClient)
    if (!connectionStillCurrent(created, at)) {
      return discardLateConnection(created, at, credential)
    }
    const current: Pair = {
      credential,
      handle: created,
      executor: null,
      sequence: 0,
      active: null,
      polling: null,
      queuedWork: null,
      timer: null,
    }
    pair = current
    current.executor = createExecutor(current)
    const preference = readPreference()
    publishConnection(
      current,
      preference && sameClient(preference.client, credential.client)
        ? preference.autoApply
        : saved?.autoApply === true,
    )
    if (!writePreference(credential.client, snapshot.autoApply))
      publish({ ...snapshot, error: true })
    saveResume(current)
    void poll(current)
    return true
  }
  async function discardLateConnection(created: Handle, at: number, credential: LocalConnection) {
    // Owner disposal/navigation yields to recovery; an explicit Stop still cancels late grants.
    if (at <= revokedThroughGeneration || (!disposed && generation === at)) {
      const revoked = await revokeCredential(credential)
      if (!revoked && !disposed && generation === revokedThroughGeneration)
        publish({ ...snapshot, error: true })
    }
    created.dispose()
    return false
  }
  function canEnable() {
    return !disposed && !connecting && !pair && snapshot.available && snapshot.client !== null
  }
  async function enable(expectedClient?: LocalConnection["client"]) {
    if (!canEnable()) return false
    automaticConnectionBlocked = false
    connecting = true
    const at = ++generation
    const created = createActiveDocumentAutomationSession()
    try {
      if (!created.ok) throw new Error("The active document is unavailable.")
      return await connect(created, at, undefined, expectedClient)
    } catch {
      if (created.ok) created.dispose()
      if (generation === at) publish({ ...snapshot, connected: false, error: true })
      return false
    } finally {
      connecting = false
    }
  }
  async function validateRecoveryClient(saved: NonNullable<ReturnType<typeof readResume>>) {
    const response = await localAutomationRequest("/status", {})
    if (retryableResponse(response))
      throw new LocalAutomationTransportError("The local bridge is temporarily unavailable.")
    const status = localStatusSchema.parse(response.data)
    if (!status.client) throw new LocalAutomationTransportError("The local MCP client is starting.")
    if (saved.client && !sameClient(saved.client, status.client))
      throw new Error("The approved local MCP client changed.")
  }
  async function recoveryFailure(
    error: unknown,
    saved: NonNullable<ReturnType<typeof readResume>>,
    at: number,
  ) {
    if (generation === at && error instanceof LocalAutomationTransportError) {
      retryRestore()
    } else if (generation === at) {
      automaticConnectionBlocked = !(error instanceof LocalAutomationSessionLostError)
      clearResume()
      await revokeCredential(saved)
      if (generation === at) publish({ ...snapshot, recovering: false, error: true })
    }
  }
  async function restore() {
    if (disposed || connecting || pair) return
    const saved = readResume()
    if (!saved) {
      clearResume()
      if (snapshot.recovering) publish({ ...snapshot, recovering: false })
      return
    }
    connecting = true
    const at = generation
    try {
      await validateRecoveryClient(saved)
      await resumeDocument(saved, at)
    } catch (error) {
      await recoveryFailure(error, saved, at)
    } finally {
      connecting = false
    }
  }
  function retryRestore() {
    if (disposed || restoreTimer || !readResume()) return
    restoreTimer = setTimeout(() => {
      restoreTimer = null
      void restore()
    }, 1000)
  }
  async function resumeDocument(saved: NonNullable<ReturnType<typeof readResume>>, at: number) {
    const created = createActiveDocumentAutomationSession()
    if (!created.ok) {
      retryRestore()
      return
    }
    const info = created.readIdentity()
    if (!info) {
      created.dispose()
      retryRestore()
      return
    }
    if (info.id !== saved.documentId) {
      created.dispose()
      await disconnect()
      return
    }
    try {
      await connect(created, at, saved, saved.client)
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
    if (!saveResume(current)) {
      void disable()
      return
    }
    closeLocal(current)
    publish({
      ...snapshot,
      connected: false,
      recovering: true,
      autoApply: false,
      projectManagement: false,
      busy: false,
    })
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
    enable: () => enable(),
    validateDocumentScope,
    isProjectActionPending: () =>
      pair !== null && snapshot.projectManagement && isProjectChange(pair),
    setProjectManagement(enabled: boolean) {
      const current = pair
      if (
        !current ||
        !snapshot.connected ||
        current.active ||
        automationReviews.getSnapshot() ||
        !current.handle.readIdentity()
      )
        return false
      publish({ ...snapshot, projectManagement: enabled })
      return true
    },
    enableAutoApply() {
      const current = pair
      if (
        !current ||
        current.active ||
        !current.handle.readIdentity() ||
        !current.handle.enableAutoApply(current.credential.actor)
      )
        return false
      if (!writePreference(current.credential.client, true)) {
        if (!current.handle.disableAutoApply()) void disable()
        return false
      }
      publish({ ...snapshot, autoApply: true })
      if (!saveResume(current)) void disable()
      return true
    },
    disableAutoApply() {
      const current = pair
      if (
        !current ||
        snapshot.busy ||
        automationReviews.getSnapshot() ||
        !current.handle.disableAutoApply()
      )
        return false
      publish({ ...snapshot, autoApply: false })
      if (!writePreference(current.credential.client, false) || !saveResume(current)) void disable()
      return true
    },
    disable,
    status,
    start() {
      // React StrictMode restarts the same connection after effect cleanup.
      disposed = false
      window.addEventListener("beforeunload", onBeforeUnload)
      window.addEventListener("pagehide", onPageHide)
      window.addEventListener("pageshow", onPageShow)
      scheduleStatus()
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      if (disposed) return
      onPageHide()
      disposed = true
      if (statusTimer) clearTimeout(statusTimer)
      statusTimer = null
      statusRequest = null
      window.removeEventListener("beforeunload", onBeforeUnload)
      window.removeEventListener("pagehide", onPageHide)
      window.removeEventListener("pageshow", onPageShow)
      generation += 1
      if (restoreTimer) clearTimeout(restoreTimer)
      restoreTimer = null
    },
  }
}
