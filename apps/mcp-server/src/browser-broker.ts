import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import {
  automationDraftCommitViewSchema,
  automationDraftDiscardViewSchema,
  automationDraftPreviewSchema,
  automationDraftStateSchema,
} from "@vibeshape/automation-api/drafts"
import {
  createLocalAutomationActor,
  LOCAL_AUTOMATION_PATH,
  localConnectRequestSchema,
  localPollRequestSchema,
  localResultRequestSchema,
  localStatusSchema,
} from "@vibeshape/automation-api/local-session"
import type { LocalOperation, LocalToolResult } from "@vibeshape/automation-api/local-tools"
import {
  isLocalDraftCommand,
  isLocalDraftInspection,
  isLocalInspection,
  type LocalInspectionOperation,
  localExportSchema,
  localFailure,
  localModelInfoSchema,
  localOperationSchema,
  localToolOutputs,
} from "@vibeshape/automation-api/local-tools"
import {
  cadInspectionDetailViewSchema,
  cadInspectionListViewSchema,
  modelBodyMeasurementViewSchema,
  modelBodyTopologyViewSchema,
  modelEdgeViewSchema,
  variableListViewSchema,
} from "@vibeshape/automation-api/queries"
import { z } from "zod"
import { BrowserRequestError, readBrowserJson } from "./browser-request"
import { draftInspectionMatches } from "./draft-inspection-result"

type Stage = "queued" | "executing" | "review" | "applying"
type Progress = (stage: Stage) => void
type Client = { name: string; version: string }
type Pending = {
  id: string
  operation: LocalOperation
  resolve: (result: LocalToolResult) => void
  timer: ReturnType<typeof setTimeout>
  delivered: boolean
  progress?: Progress
  abortCleanup?: () => void
  lastProgress: number
}
type Pair = {
  token: Buffer
  document: { id: string; name: string; revision: number }
  expiresAt: number
  lastPollAt: number
  sequence: number
  client: Client
  pending: Pending | null
}

const JSON_TYPE = "application/json"
const MAX_BODY = 1 * 1024 * 1024
const MAX_EXPORT_BODY = 8 * 1024 * 1024 + 64 * 1024
const TTL = 60 * 60 * 1000
const OPERATION_TTL = 6 * 60 * 1000
const LIVENESS = 15 * 1000

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": JSON_TYPE,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}

function failure(code: string, message: string, retryable = false) {
  return localFailure(code, message, retryable)
}

function tokenMatches(expected: Buffer, supplied: string | null) {
  if (!supplied || !/^Bearer [A-Za-z0-9_-]{43}$/.test(supplied)) return false
  const value = Buffer.from(supplied.slice(7), "base64url")
  return value.length === expected.length && timingSafeEqual(value, expected)
}

function bodyLimit(operation: LocalOperation | null) {
  return operation?.tool === "export_model" ? MAX_EXPORT_BODY : MAX_BODY
}

type StateOperation = Extract<LocalOperation, { arguments: { baseRevision: number } }>
function stateMatches(operation: StateOperation, value: unknown, documentId: string) {
  const state = automationDraftStateSchema.parse(value)
  if (state.documentId !== documentId) return false
  if (operation.tool === "create_draft")
    return state.baseRevision === operation.arguments.baseRevision
  return (
    state.draftId === operation.arguments.draftId &&
    state.revision === operation.arguments.baseRevision + 1
  )
}
function draftResultMatches(
  operation: Extract<LocalOperation, { tool: "preview_draft" | "commit_draft" | "discard_draft" }>,
  value: unknown,
  documentId: string,
) {
  if (operation.tool === "discard_draft")
    return automationDraftDiscardViewSchema.parse(value).draftId === operation.arguments.draftId
  const draft =
    operation.tool === "preview_draft"
      ? automationDraftPreviewSchema.parse(value).draft
      : automationDraftCommitViewSchema.parse(value)
  return draft.draftId === operation.arguments.draftId && draft.documentId === documentId
}
function exportMatches(
  operation: Extract<LocalOperation, { tool: "export_model" }>,
  value: unknown,
  documentId: string,
) {
  const file = localExportSchema.parse(value)
  return (
    file.documentId === documentId &&
    file.revision === operation.arguments.revision &&
    file.format === operation.arguments.format
  )
}
function edgeInspectionMatches(
  operation: Extract<LocalOperation, { tool: "model_edges" }>,
  value: unknown,
  documentId: string,
) {
  const view = modelEdgeViewSchema.parse(value)
  return (
    view.documentId === documentId &&
    view.revision === operation.arguments.revision &&
    view.featureId === operation.arguments.featureId
  )
}
function bodyMeasurementInspectionMatches(
  operation: Extract<LocalInspectionOperation, { tool: "model_body_measurements" }>,
  value: unknown,
  documentId: string,
) {
  const view = modelBodyMeasurementViewSchema.parse(value)
  if (view.documentId !== documentId || view.revision !== operation.arguments.revision) return false
  return view.data.bodies.every(
    (body) =>
      (operation.arguments.featureId === undefined ||
        body.featureId === operation.arguments.featureId) &&
      (operation.arguments.outputRole === undefined ||
        body.outputRole === operation.arguments.outputRole),
  )
}
function bodyTopologyInspectionMatches(
  operation: Extract<LocalInspectionOperation, { tool: "model_body_topology" }>,
  value: unknown,
  documentId: string,
) {
  const view = modelBodyTopologyViewSchema.parse(value)
  const args = operation.arguments
  if (view.documentId !== documentId || view.revision !== args.revision) return false
  if (
    view.featureId !== args.featureId ||
    view.outputRole !== args.outputRole ||
    view.topologyKind !== args.topologyKind
  )
    return false
  const cursor = args.cursor
  if (!cursor) return true
  return (
    [
      "documentId",
      "revision",
      "generation",
      "rebuildId",
      "contentHash",
      "featureId",
      "outputRole",
      "topologyKind",
    ] as const
  ).every((key) => view[key] === cursor[key])
}
function inspectionMatches(
  operation: LocalInspectionOperation,
  value: unknown,
  documentId: string,
) {
  if (operation.tool === "model_edges") return edgeInspectionMatches(operation, value, documentId)
  if (operation.tool === "model_body_topology")
    return bodyTopologyInspectionMatches(operation, value, documentId)
  if (operation.tool === "model_body_measurements")
    return bodyMeasurementInspectionMatches(operation, value, documentId)
  return semanticInspectionMatches(operation, value, documentId)
}
function semanticInspectionMatches(
  operation: Exclude<
    LocalInspectionOperation,
    { tool: "model_edges" | "model_body_topology" | "model_body_measurements" }
  >,
  value: unknown,
  documentId: string,
) {
  if (operation.tool !== "model_entity") {
    const view =
      operation.tool === "model_tree"
        ? cadInspectionListViewSchema.parse(value)
        : variableListViewSchema.parse(value)
    return view.documentId === documentId && view.revision === operation.arguments.revision
  }
  const view = cadInspectionDetailViewSchema.parse(value)
  return (
    view.documentId === documentId &&
    view.revision === operation.arguments.revision &&
    view.data.entityKind === operation.arguments.entity.kind &&
    view.data.record.id === operation.arguments.entity.id
  )
}
function resultMatches(operation: LocalOperation, result: LocalToolResult, documentId: string) {
  if (!result.ok) return true
  if (isLocalDraftCommand(operation)) return stateMatches(operation, result.value, documentId)
  if (isLocalDraftInspection(operation))
    return draftInspectionMatches(operation, result.value, documentId)
  if (isLocalInspection(operation)) return inspectionMatches(operation, result.value, documentId)
  switch (operation.tool) {
    case "model_info":
      return localModelInfoSchema.parse(result.value).summary.documentId === documentId
    case "export_model":
      return exportMatches(operation, result.value, documentId)
    case "create_draft":
      return stateMatches(operation, result.value, documentId)
    default:
      return draftResultMatches(operation, result.value, documentId)
  }
}
function requestRoute(request: Request, origin: string) {
  const url = new URL(request.url)
  if (
    url.origin !== origin ||
    request.headers.get("host") !== new URL(origin).host ||
    request.headers.get("origin") !== origin
  )
    throw new BrowserRequestError(403, "origin-denied", "The request origin is not allowed.")
  if (request.method !== "POST" || request.headers.get("content-type") !== JSON_TYPE)
    throw new BrowserRequestError(
      400,
      "invalid-request",
      "The automation endpoint requires a JSON POST request.",
    )
  if (!url.pathname.startsWith(`${LOCAL_AUTOMATION_PATH}/`) || url.search)
    throw new BrowserRequestError(404, "not-found", "The automation route was not found.")
  return url.pathname.slice(LOCAL_AUTOMATION_PATH.length)
}
function withinRateLimit(times: number[], at: number, window: number, maximum: number) {
  while (times[0] !== undefined && times[0] <= at - window) times.shift()
  if (times.length >= maximum) return false
  times.push(at)
  return true
}
function reportProgress(
  pending: Pending | null,
  progress: { requestId: string; stage: "executing" | "review" | "applying" } | null,
) {
  if (!pending || !progress || pending.id !== progress.requestId) return
  const rank = { executing: 1, review: 2, applying: 3 }[progress.stage]
  if (rank <= pending.lastProgress) return
  pending.lastProgress = rank
  try {
    pending.progress?.(progress.stage)
  } catch {
    /* Observers do not own settlement. */
  }
}

function matchesPending(pending: Pending | null, result: { requestId: string; tool: string }) {
  return (
    pending !== null && pending.id === result.requestId && pending.operation.tool === result.tool
  )
}
export function createBrowserBroker({
  origin,
  now = Date.now,
  onRevoke,
}: {
  origin: string
  now?: () => number
  onRevoke?: () => void
}) {
  const allowedOrigin = new URL(origin).origin
  let client: Client | null = null
  let pair: Pair | null = null
  let disposed = false
  const toolTimes: number[] = []
  const pollTimes: number[] = []
  let livenessTimer: ReturnType<typeof setInterval> | null = null

  function clearPending(record: Pending, result: LocalToolResult) {
    clearTimeout(record.timer)
    record.abortCleanup?.()
    record.resolve(result)
  }

  function revoke() {
    const hadPair = pair !== null
    if (pair?.pending) {
      clearPending(
        pair.pending,
        failure("session-revoked", "The local automation session was revoked."),
      )
      pair.pending = null
    }
    pair = null
    pollTimes.length = 0
    if (hadPair) onRevoke?.()
  }

  function expire() {
    if (pair && (pair.expiresAt <= now() || pair.lastPollAt + LIVENESS <= now())) revoke()
  }

  livenessTimer = setInterval(expire, 1000)
  livenessTimer.unref()

  function auth(request: Request) {
    expire()
    return pair && tokenMatches(pair.token, request.headers.get("authorization")) ? pair : null
  }

  async function routeRequest(request: Request): Promise<Response> {
    if (disposed)
      return response(410, failure("broker-disposed", "The local automation broker is closed."))
    expire()
    const route = requestRoute(request, allowedOrigin)
    if (route === "/status") return statusRoute(request)
    if (route === "/connect") return connectRoute(request)
    if (route === "/revoke") {
      if (!auth(request))
        return response(401, failure("unauthorized", "The local automation token is invalid."))
      revoke()
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      })
    }
    const authorized = auth(request)
    if (!authorized)
      return response(401, failure("unauthorized", "The local automation token is invalid."))
    if (route === "/poll") return pollRoute(request, authorized)
    if (route === "/result") return resultRoute(request, authorized)
    return response(404, failure("not-found", "The automation route was not found."))
  }
  async function statusRoute(request: Request) {
    const body = await readBrowserJson(request, 8 * 1024)
    if (!z.object({}).strict().safeParse(body).success)
      return response(400, failure("invalid-status", "The status request is invalid."))
    return response(
      200,
      localStatusSchema.parse({ protocolVersion: 1, client, paired: Boolean(pair) }),
    )
  }
  async function connectRoute(request: Request) {
    if (!client)
      return response(
        409,
        failure("client-not-initialized", "The local automation client is not initialized."),
      )
    if (pair)
      return response(
        409,
        failure("already-paired", "A local automation session is already paired."),
      )
    const body = await readBrowserJson(request, 64 * 1024)
    const parsed = localConnectRequestSchema.safeParse(body)
    if (!parsed.success)
      return response(400, failure("invalid-connect", "The connect request is invalid."))
    if (disposed || pair || !client)
      return response(
        409,
        failure("already-paired", "A local automation session is already paired."),
      )
    const token = randomBytes(32)
    pair = {
      token,
      document: parsed.data.document,
      expiresAt: now() + TTL,
      lastPollAt: now(),
      sequence: 0,
      client,
      pending: null,
    }
    return response(200, {
      protocolVersion: 1,
      token: token.toString("base64url"),
      actor: createLocalAutomationActor(now(), randomBytes(10)),
      expiresAt: pair.expiresAt,
      client,
    })
  }
  async function pollRoute(request: Request, authorized: Pair) {
    if (!withinRateLimit(pollTimes, now(), 1000, 10))
      return response(429, failure("rate-limited", "Polling is temporarily rate limited.", true))
    const body = await readBrowserJson(request, 128 * 1024)
    const parsed = localPollRequestSchema.safeParse(body)
    if (!parsed.success)
      return response(400, failure("invalid-poll", "The poll request is invalid."))
    if (pair !== authorized)
      return response(401, failure("session-revoked", "The local automation session was revoked."))
    if (parsed.data.sequence !== authorized.sequence + 1)
      return response(409, failure("invalid-sequence", "Poll sequence must increase exactly once."))
    if (parsed.data.document.id !== authorized.document.id)
      return response(409, failure("document-changed", "The paired document changed."))
    authorized.document = parsed.data.document
    authorized.sequence = parsed.data.sequence
    authorized.lastPollAt = now()
    reportProgress(authorized.pending, parsed.data.progress)
    const work =
      authorized.pending && !authorized.pending.delivered
        ? { requestId: authorized.pending.id, operation: authorized.pending.operation }
        : null
    if (authorized.pending) authorized.pending.delivered = true
    return response(200, { protocolVersion: 1, work, cancelledRequestIds: [] })
  }
  async function resultRoute(request: Request, authorized: Pair) {
    const body = await readBrowserJson(request, bodyLimit(authorized.pending?.operation ?? null))
    const parsed = localResultRequestSchema.safeParse(body)
    if (pair !== authorized)
      return response(401, failure("session-revoked", "The local automation session was revoked."))
    if (!parsed.success)
      return response(400, failure("invalid-result", "The result request is invalid."))
    if (!matchesPending(authorized.pending, parsed.data))
      return response(409, failure("unexpected-result", "No matching operation is pending."))
    const output = localToolOutputs[parsed.data.tool].safeParse(parsed.data.result)
    if (!output.success)
      return response(400, failure("invalid-result", "The tool result does not match its schema."))
    if (
      !authorized.pending ||
      !resultMatches(authorized.pending.operation, output.data, authorized.document.id)
    )
      return response(
        400,
        failure(
          "result-context-mismatch",
          "The tool result belongs to another document or request.",
        ),
      )
    const pending = authorized.pending
    authorized.pending = null
    clearPending(pending, output.data)
    return response(200, { ok: true })
  }

  function invoke(
    operation: LocalOperation,
    options: { signal?: AbortSignal; onProgress?: Progress } = {},
  ) {
    expire()
    if (options.signal?.aborted)
      return Promise.resolve(
        failure("session-revoked", "The local automation session was revoked."),
      )
    const parsed = localOperationSchema.safeParse(operation)
    if (!parsed.success)
      return Promise.resolve(failure("invalid-operation", "The local operation is invalid."))
    // Reserve space for the poll envelope inside the browser's 256 KiB response budget.
    if (Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > 192 * 1024)
      return Promise.resolve(failure("operation-too-large", "The local operation exceeds 192 KiB."))
    if (!pair) return Promise.resolve(failure("not-paired", "The browser is not paired."))
    const activePair = pair
    if (activePair.pending)
      return Promise.resolve(failure("busy", "Another local operation is pending.", true))
    if (!withinRateLimit(toolTimes, now(), 60_000, 120))
      return Promise.resolve(
        failure("rate-limited", "The local tool rate limit was reached.", true),
      )
    return new Promise<LocalToolResult>((resolve) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        if (pair?.pending?.id === id) revoke()
      }, OPERATION_TTL)
      if (options.signal?.aborted) {
        clearTimeout(timer)
        resolve(failure("session-revoked", "The local automation session was revoked."))
        return
      }
      const abortListener = () => {
        if (pair?.pending?.id === id) revoke()
      }
      activePair.pending = {
        id,
        operation: parsed.data,
        resolve,
        timer,
        delivered: false,
        lastProgress: 0,
        ...(options.onProgress ? { progress: options.onProgress } : {}),
        ...(options.signal
          ? { abortCleanup: () => options.signal?.removeEventListener("abort", abortListener) }
          : {}),
      }
      options.signal?.addEventListener("abort", abortListener, { once: true })
      try {
        options.onProgress?.("queued")
      } catch {
        /* Observers do not own operation settlement. */
      }
    })
  }

  let inFlightRequests = 0
  async function handle(request: Request) {
    if (inFlightRequests >= 8)
      return response(429, failure("busy", "Too many local requests are active.", true))
    inFlightRequests += 1
    try {
      return await routeRequest(request)
    } catch (error) {
      return error instanceof BrowserRequestError
        ? response(error.status, failure(error.code, error.message))
        : response(400, failure("invalid-request", "The local request could not be processed."))
    } finally {
      inFlightRequests -= 1
    }
  }
  return {
    handle,
    setClient(value: Client | null) {
      if (client && (!value || value.name !== client.name || value.version !== client.version))
        revoke()
      client = value
    },
    invoke,
    revoke,
    isPaired() {
      expire()
      return pair !== null
    },
    dispose() {
      disposed = true
      if (livenessTimer) clearInterval(livenessTimer)
      revoke()
    },
  }
}
