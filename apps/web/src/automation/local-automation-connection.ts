import {
  type LocalConnection,
  type LocalWork,
  localConnectResponseSchema,
  localDocumentSchema,
  localPollResponseSchema,
  localStatusSchema,
} from "@vibeshape/automation-api/local-session"
import {
  localFailure,
  localFailureSchema,
  localToolOutputs,
} from "@vibeshape/automation-api/local-tools"
import type { CommandActor } from "@vibeshape/domain/commands"
import { z } from "zod"
import { createActiveDocumentAutomationSession as createVisibleDocumentAutomationSession } from "../document/document-controller"
import { automationReviews } from "./automation-review-controller"
import { createDraftRecoveryOwner } from "./draft-recovery-owner"
import {
  LocalAutomationTransportError,
  localAutomationRequest as visibleAutomationRequest,
} from "./local-automation-http"
import { createLocalToolExecutor } from "./local-tool-executor"
import { createProjectToolPort } from "./project-tool-port"

type Handle = Extract<ReturnType<typeof createVisibleDocumentAutomationSession>, { ok: true }>
type DocumentFailure = Extract<
  ReturnType<typeof createVisibleDocumentAutomationSession>,
  { ok: false }
>
type Identity = ReturnType<Handle["readIdentity"]>
type Snapshot = Readonly<{
  available: boolean
  connected: boolean
  recovering: boolean
  autoApply: boolean
  projectManagement: boolean
  projectBound?: boolean
  busy: boolean
  client: LocalConnection["client"] | null
  error: boolean
  recoveryAttempt?: number
  recoveryFailed?: boolean
  recoveryBlocked?: boolean
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
const projectUnavailableSchema = localFailureSchema.extend({
  diagnostic: localFailureSchema.shape.diagnostic.extend({
    code: z.literal("project-session-unavailable"),
    retryable: z.literal(true),
  }),
})
const preferenceSchema = z
  .object({
    client: localConnectResponseSchema.shape.client,
    autoApply: z.boolean(),
  })
  .strict()
function savedReadPreference(key = preferenceKey) {
  try {
    const value = preferenceSchema.safeParse(JSON.parse(window.localStorage.getItem(key) ?? "null"))
    return value.success ? value.data : null
  } catch {
    return null
  }
}
function savedWritePreference(
  client: LocalConnection["client"],
  autoApply: boolean,
  key = preferenceKey,
) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ client, autoApply }))
    return true
  } catch {
    return false
  }
}
function savedClearPreference(key = preferenceKey) {
  try {
    window.localStorage.removeItem(key)
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
function savedReadResume(key = resumeKey) {
  try {
    const value = resumeSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null"))
    return value.success &&
      Math.min(value.data.expiresAt, value.data.resumeUntil ?? value.data.expiresAt) > Date.now()
      ? value.data
      : null
  } catch {
    return null
  }
}
function savedClearResume(key = resumeKey) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* Storage can be unavailable. */
  }
}
class LocalAutomationSessionLostError extends Error {}
class LocalAutomationDocumentError extends Error {
  constructor(readonly diagnostic: DocumentFailure["diagnostic"]) {
    super(diagnostic.message)
  }
}
function requireSessionCredential(response: { status: number }) {
  if (response.status === 401 || response.status === 410)
    throw new LocalAutomationSessionLostError("The local session credential is no longer valid.")
}
const acknowledgement = z.object({ ok: z.literal(true) }).strict()

export function createLocalAutomationConnection(
  options: {
    projectId?: string
    accessPolicy?: "manual" | "native-project"
    createDocumentSession?: typeof createVisibleDocumentAutomationSession
    reviews?: typeof automationReviews
  } = {},
) {
  const reviews = options.reviews ?? automationReviews
  const recoveryOwner = createDraftRecoveryOwner()
  const nativeProjectAccess = options.accessPolicy === "native-project" && !!options.projectId
  const createActiveDocumentAutomationSession = () => {
    const create = options.createDocumentSession ?? createVisibleDocumentAutomationSession
    return nativeProjectAccess ? create({ approvalPolicy: "connected-assistant" }) : create()
  }
  const scopedPreferenceKey = options.projectId
    ? `${preferenceKey}:${options.projectId}`
    : preferenceKey
  const scopedResumeKey = options.projectId ? `${resumeKey}:${options.projectId}` : resumeKey
  const disabledKey = `${scopedPreferenceKey}:disabled`
  function savedConnectionBlocked() {
    if (!nativeProjectAccess) return false
    try {
      const reserved = window.localStorage.getItem(disabledKey)
      if (reserved !== null && reserved !== "0") return true
      const preference = window.localStorage.getItem(scopedPreferenceKey)
      if (preference === null) return reserved !== null
      return !preferenceSchema.safeParse(JSON.parse(preference)).success
    } catch {
      return true
    }
  }
  function reserveNativeAccessState() {
    if (!nativeProjectAccess) return true
    try {
      // Keep a sentinel before granting access: Stop can remove approval even at full quota.
      if (window.localStorage.getItem(disabledKey) !== "0")
        window.localStorage.setItem(disabledKey, "0")
      return true
    } catch {
      automaticConnectionBlocked = true
      nativeRecoveryFailure(new Error("Native access preferences are unavailable."))
      return false
    }
  }
  const readPreference = () => savedReadPreference(scopedPreferenceKey)
  function preferredAutoApply(client: LocalConnection["client"], fallback = false) {
    if (nativeProjectAccess) return true
    const preference = readPreference()
    return preference && sameClient(preference.client, client) ? preference.autoApply : fallback
  }
  const writePreference = (client: LocalConnection["client"], autoApply: boolean) =>
    savedWritePreference(client, autoApply, scopedPreferenceKey)
  const clearPreference = () => savedClearPreference(scopedPreferenceKey)
  const readResume = () => savedReadResume(scopedResumeKey)
  const clearResume = () => savedClearResume(scopedResumeKey)
  const localAutomationRequest: typeof visibleAutomationRequest = options.projectId
    ? (path, body, token, keepalive) =>
        visibleAutomationRequest(path, body, token, keepalive, options.projectId)
    : visibleAutomationRequest

  let snapshot: Snapshot = {
    available: false,
    connected: false,
    recovering: false,
    autoApply: false,
    projectManagement: false,
    ...(options.projectId ? { projectBound: true } : {}),
    busy: false,
    client: null,
    error: false,
  }
  let pair: Pair | null = null
  let generation = 0
  let revokedThroughGeneration = -1
  let automaticConnectionBlocked = savedConnectionBlocked()
  let nativeStopped = automaticConnectionBlocked
  let connecting = false
  let disposed = false
  let restoreTimer: ReturnType<typeof setTimeout> | null = null
  let statusTimer: ReturnType<typeof setTimeout> | null = null
  let statusRequest: Promise<void> | null = null
  let nativeRecoveryAttempt = 0
  let nativeRecoveryFailed = false
  let nativeRecoveryRetryable = false
  let nativeRecoveryPending = false
  const listeners = new Set<() => void>()
  function publish(next: Snapshot) {
    snapshot = nativeProjectAccess
      ? {
          ...next,
          recoveryAttempt: nativeRecoveryAttempt,
          recoveryFailed: nativeRecoveryFailed,
          recoveryBlocked: nativeStopped,
        }
      : next
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
        scopedResumeKey,
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
      // The renderer may restore before the ACP host registers this project's attachment.
      (nativeProjectAccess &&
        response.status === 404 &&
        projectUnavailableSchema.safeParse(response.data).success) ||
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
    if (nativeProjectAccess) nativeRecoveryPending = true
    closeLocal(current, true)
    publish({
      ...snapshot,
      connected: false,
      recovering: true,
      autoApply: false,
      projectManagement: false,
      busy: false,
      error: true,
    })
    if (nativeProjectAccess)
      nativeRecoveryFailure(
        new LocalAutomationTransportError("The native session was interrupted."),
      )
    else retryRestore()
  }
  async function revokeCredential(credential: Pick<LocalConnection, "token">) {
    try {
      const response = await localAutomationRequest("/revoke", {}, credential.token, true)
      return response.status === 204 || response.status === 401 || response.status === 410
    } catch {
      return false
    }
  }
  function closeLocal(current: Pair, retainIntent = false) {
    if (current.timer) clearTimeout(current.timer)
    current.active?.controller.abort()
    current.queuedWork = null
    if (retainIntent && !isProjectChange(current)) {
      current.handle.cancel?.("request-cancelled")
      recoveryOwner.retain(current.handle, current.credential)
    } else recoveryOwner.clear()
    current.handle.dispose()
    if (pair === current) pair = null
  }
  async function disconnect(preserveRecovery = false) {
    recoveryOwner.clear()
    generation += 1
    revokedThroughGeneration = generation
    const saved = readResume()
    clearResume()
    if (restoreTimer) clearTimeout(restoreTimer)
    restoreTimer = null
    nativeRecoveryPending = preserveRecovery
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
    nativeStopped = nativeProjectAccess
    automaticConnectionBlocked = true
    if (reserveNativeAccessState()) clearPreference()
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
    const capturedHandle = current.handle
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
          recoveryOwner.clear()
          current.handle.dispose()
          current.handle = created
          current.executor = createExecutor(current)
          const autoApply = snapshot.autoApply && created.enableAutoApply(current.credential.actor)
          publish({ ...snapshot, autoApply })
          saveResume(current)
          return true
        },
      }),
      recoveryOwner.bind(
        capturedHandle,
        () => current.credential,
        () => pair === current && current.handle === capturedHandle && snapshot.connected,
      ),
    )
  }
  async function readStatus() {
    if (disposed || !document.querySelector('meta[name="vibeshape-local-automation"][content="1"]'))
      return
    const at = generation
    try {
      // Credential-free discovery may finish during navigation; its generation still expires.
      const response = await localAutomationRequest("/status", {}, undefined, true)
      const value = localStatusSchema.parse(response.data)
      if (!response.ok || generation !== at) return
      publishBridgeStatus(value)
    } catch {
      statusUnavailable(at)
    }
  }
  function statusUnavailable(at: number) {
    if (generation === at)
      publish({
        ...snapshot,
        available: false,
        recovering: !nativeRecoveryFailed && (readResume() !== null || nativeRecoveryPending),
      })
    if (readResume()) retryRestore()
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
    const saved = nativeProjectAccess && automaticConnectionBlocked ? null : readResume()
    publish({
      ...snapshot,
      available: true,
      client: value.client,
      recovering: !pair && (saved !== null || nativeRecoveryPending) && !nativeRecoveryFailed,
      error: nativeRecoveryFailed || (nativeRecoveryPending && snapshot.error),
    })
    if (saved) retryRestore()
    else {
      clearResume()
      connectDiscoveredClient(value.client)
    }
  }
  function connectDiscoveredClient(client: LocalConnection["client"] | null) {
    if (automaticConnectionBlocked || !client) return
    if (nativeProjectAccess) {
      if (nativeRecoveryPending || nativeRecoveryFailed) return
      void enable(client)
      return
    }
    const preference = readPreference()
    if (preference && sameClient(preference.client, client)) void enable(client)
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
    requireSessionCredential(response)
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
      await handleSessionFailure(current, error)
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
      "request_lightweighting",
      "request_quick_lightweighting",
      "change_metadata",
      "move_history_item",
      "commit_assembly_draft",
      "undo_model",
      "redo_model",
      "save_library_definition",
      "update_library_metadata",
      "create_surface_texture",
      "update_surface_texture",
      "remove_surface_texture",
    ].includes(active.work.operation.tool)
      ? reviews.getSnapshot()
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
    nativeHeartbeatAccepted()
    if (value.work) acceptWork(current, value.work)
  }
  async function handleSessionFailure(current: Pair, error: unknown) {
    if (pair !== current) return
    if (error instanceof LocalAutomationTransportError) await recover(current)
    else if (error instanceof LocalAutomationSessionLostError) await recoverLostCredential()
    else await fail(current)
  }
  async function recoverLostCredential() {
    const at = generation + 1
    await disconnect(nativeProjectAccess)
    if (nativeProjectAccess && connectionAttemptCurrent(at))
      nativeRecoveryFailure(new LocalAutomationTransportError("The native credential expired."))
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
      await handleSessionFailure(current, error)
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
    if (restoreTimer) clearTimeout(restoreTimer)
    restoreTimer = null
    const autoApply = restoreAutoApply && current.handle.enableAutoApply(current.credential.actor)
    publish({
      ...snapshot,
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
  function nativeHeartbeatAccepted() {
    if (!nativeProjectAccess || !nativeRecoveryPending) return
    nativeRecoveryAttempt = 0
    nativeRecoveryFailed = false
    nativeRecoveryPending = false
    publish({ ...snapshot, error: false })
  }
  function connectionAttemptCurrent(at: number) {
    if (generation !== at || disposed) return false
    return !nativeProjectAccess || !automaticConnectionBlocked
  }
  function connectionStillCurrent(created: Handle, at: number) {
    return connectionAttemptCurrent(at) && created.readIdentity() !== null
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
    if (!prepareConnectionGrant(at, expectedClient ?? saved?.client ?? snapshot.client)) {
      created.dispose()
      return false
    }
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
    acceptConnection(current, saved, info)
    return true
  }
  function acceptConnection(
    current: Pair,
    saved: NonNullable<ReturnType<typeof readResume>> | undefined,
    info: NonNullable<Identity>,
  ) {
    const { credential } = current
    pair = current
    recoveryOwner.authorize(saved?.token, credential, info)
    current.executor = createExecutor(current)
    publishConnection(current, preferredAutoApply(credential.client, saved?.autoApply === true))
    if (!writePreference(credential.client, snapshot.autoApply))
      publish({ ...snapshot, error: true })
    saveResume(current)
    void poll(current)
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
  function prepareConnectionGrant(at: number, client: LocalConnection["client"] | null) {
    if (!connectionAttemptCurrent(at)) return false
    if (!nativeProjectAccess) return true
    if (!client || !reserveNativeAccessState()) return false
    if (writePreference(client, preferredAutoApply(client))) return true
    automaticConnectionBlocked = true
    nativeRecoveryFailure(new Error("Native access preferences could not be saved."))
    return false
  }
  async function enable(expectedClient?: LocalConnection["client"]) {
    if (!canEnable()) return false
    automaticConnectionBlocked = false
    connecting = true
    const at = ++generation
    const created = createActiveDocumentAutomationSession()
    try {
      if (!created.ok) throw new LocalAutomationDocumentError(created.diagnostic)
      return await connect(created, at, undefined, expectedClient)
    } catch (error) {
      if (created.ok) created.dispose()
      if (generation === at) {
        publish({ ...snapshot, connected: false, error: true })
        if (nativeProjectAccess) nativeRecoveryFailure(error)
      }
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
    if (generation !== at) return
    if (error instanceof LocalAutomationTransportError) {
      if (nativeProjectAccess) nativeRecoveryFailure(error)
      else retryRestore()
      return
    }
    automaticConnectionBlocked = !(error instanceof LocalAutomationSessionLostError)
    recoveryOwner.clear()
    clearResume()
    await revokeCredential(saved)
    if (generation === at) finishRejectedRecovery(error)
  }
  function finishRejectedRecovery(error: unknown) {
    if (nativeProjectAccess && error instanceof LocalAutomationSessionLostError) {
      nativeRecoveryFailure(new LocalAutomationTransportError("The native credential expired."))
      return
    }
    if (nativeProjectAccess) {
      nativeRecoveryFailed = true
      nativeRecoveryRetryable = false
      nativeRecoveryPending = false
    }
    publish({ ...snapshot, recovering: false, error: true })
  }
  async function restore() {
    if (connecting || pair || !connectionAttemptCurrent(generation)) return
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
      if (!connectionAttemptCurrent(at)) return
      await resumeDocument(saved, at)
    } catch (error) {
      await recoveryFailure(error, saved, at)
    } finally {
      connecting = false
    }
  }
  function retryRestore() {
    if (
      disposed ||
      restoreTimer ||
      pair ||
      (nativeProjectAccess && (nativeRecoveryFailed || automaticConnectionBlocked)) ||
      (!readResume() && !nativeRecoveryPending)
    )
      return
    restoreTimer = setTimeout(() => {
      restoreTimer = null
      if (connecting) {
        retryRestore()
        return
      }
      if (nativeProjectAccess) {
        nativeRecoveryAttempt += 1
        publish({ ...snapshot, recovering: true, error: false })
      }
      if (readResume()) void restore()
      else if (nativeProjectAccess && snapshot.client && snapshot.available)
        void enable(snapshot.client)
      else if (nativeProjectAccess)
        nativeRecoveryFailure(
          new LocalAutomationTransportError("The native client is unavailable."),
        )
    }, recoveryDelay())
  }
  function recoveryDelay() {
    return nativeProjectAccess ? Math.min(1000 * 2 ** nativeRecoveryAttempt, 8000) : 1000
  }
  function nativeRecoveryFailure(error: unknown) {
    nativeRecoveryPending = true
    const retryable =
      error instanceof LocalAutomationTransportError ||
      (error instanceof LocalAutomationDocumentError &&
        error.diagnostic.code === "document-write-unavailable" &&
        error.diagnostic.retryable)
    nativeRecoveryRetryable = retryable
    if (!retryable || nativeRecoveryAttempt >= 5) {
      nativeRecoveryFailed = true
      nativeRecoveryPending = false
      if (restoreTimer) clearTimeout(restoreTimer)
      restoreTimer = null
      publish({ ...snapshot, recovering: false, error: true })
      return
    }
    publish({ ...snapshot, recovering: true, error: false })
    retryRestore()
  }
  async function resumeDocument(saved: NonNullable<ReturnType<typeof readResume>>, at: number) {
    const created = createActiveDocumentAutomationSession()
    if (!created.ok) {
      if (nativeProjectAccess)
        nativeRecoveryFailure(new LocalAutomationTransportError("The document is unavailable."))
      else retryRestore()
      return
    }
    const info = created.readIdentity()
    if (!info) {
      created.dispose()
      if (nativeProjectAccess)
        nativeRecoveryFailure(new LocalAutomationTransportError("The document is unavailable."))
      else retryRestore()
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
  function canRestartNativeRecovery() {
    return nativeProjectAccess && nativeRecoveryFailed && !disposed && !connecting && !pair
  }
  return {
    disconnect: () => disconnect(),
    async retryRecovery(options?: { automatic?: boolean }) {
      if (!canRestartNativeRecovery()) return false
      if (options?.automatic && (!nativeRecoveryRetryable || automaticConnectionBlocked))
        return false
      automaticConnectionBlocked = savedConnectionBlocked()
      if (automaticConnectionBlocked) return false
      nativeStopped = false
      nativeRecoveryAttempt = 0
      nativeRecoveryFailed = false
      nativeRecoveryPending = true
      publish({ ...snapshot, recovering: true, error: false })
      retryRestore()
      return true
    },
    currentActor(): CommandActor | null {
      const current = pair
      const identity = current?.handle.readIdentity()
      if (
        !current ||
        !snapshot.connected ||
        !identity ||
        (options.projectId && identity.id !== options.projectId)
      )
        return null
      return { ...current.credential.actor }
    },
    enable: () => {
      if (!canEnable()) return Promise.resolve(false)
      nativeStopped = false
      nativeRecoveryAttempt = 0
      nativeRecoveryFailed = false
      nativeRecoveryPending = false
      return enable()
    },
    validateDocumentScope,
    isProjectActionPending: () =>
      pair !== null && snapshot.projectManagement && isProjectChange(pair),
    setProjectManagement(enabled: boolean) {
      if (options.projectId) return false
      const current = pair
      if (
        !current ||
        !snapshot.connected ||
        current.active ||
        reviews.getSnapshot() ||
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
      if (nativeProjectAccess) return false
      const current = pair
      if (!current || snapshot.busy || reviews.getSnapshot() || !current.handle.disableAutoApply())
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
      recoveryOwner.clear()
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
