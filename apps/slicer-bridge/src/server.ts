import { timingSafeEqual } from "node:crypto"
import {
  MAX_SLICER_HANDOFF_BYTES,
  SLICER_BRIDGE_HANDOFF_PATH,
  SLICER_BRIDGE_HEALTH_PATH,
  SLICER_BRIDGE_HOST,
  SLICER_BRIDGE_PORT,
  SLICER_BRIDGE_PROTOCOL_VERSION,
  SLICER_BRIDGE_SERVICE_ID,
  type SlicerBridgeDiagnosticCode,
  type SlicerHandoffRequestMetadata,
  type SlicerHandoffResponse,
  slicerHandoffRequestMetadataSchema,
  slicerHandoffResponseSchema,
} from "@vibeshape/slicer-handoff/protocol"
import { isError } from "is-what"
import type { BridgeConfiguration } from "./config"
import type { HandoffFileStore } from "./handoff-files"
import { launchSlicerFile, SlicerNotInstalledError } from "./launcher"

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_ATTEMPTS = 10
const DEDUPLICATION_WINDOW_MS = 5 * 60_000

type LaunchSlicer = typeof launchSlicerFile

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin, Access-Control-Request-Private-Network",
  } as const
}

function jsonResponse(payload: unknown, status: number, origin: string) {
  return Response.json(payload, {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(origin) },
  })
}

function failure(
  code: SlicerBridgeDiagnosticCode,
  message: string,
  retryable: boolean,
  status: number,
  origin: string,
) {
  return jsonResponse(
    slicerHandoffResponseSchema.parse({
      protocolVersion: SLICER_BRIDGE_PROTOCOL_VERSION,
      ok: false,
      diagnostic: { code, message, retryable },
    }),
    status,
    origin,
  )
}

function tokenMatches(request: Request, expected: string) {
  const authorization = request.headers.get("authorization")
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7) : ""
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return (
    providedBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(providedBytes, expectedBytes)
  )
}

function hasThreeMfMagic(bytes: Uint8Array) {
  return bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4
}

function createRateLimiter() {
  const attempts: number[] = []
  return (now: number) => {
    while (attempts.length > 0 && (attempts[0] as number) <= now - RATE_LIMIT_WINDOW_MS) {
      attempts.shift()
    }
    if (attempts.length >= RATE_LIMIT_ATTEMPTS) return false
    attempts.push(now)
    return true
  }
}

function boundedMessage(error: unknown, fallback: string) {
  return isError(error) && error.message.trim().length > 0
    ? error.message.slice(0, 1_024)
    : fallback
}

function authorizedRequest(
  request: Request,
  configuration: BridgeConfiguration,
): Readonly<{ origin: string; url: URL }> | null {
  const url = new URL(request.url)
  const origin = request.headers.get("origin")
  if (
    url.hostname !== SLICER_BRIDGE_HOST ||
    url.port !== String(SLICER_BRIDGE_PORT) ||
    origin !== configuration.origin
  ) {
    return null
  }
  return { origin, url }
}

function routedOperationResponse(request: Request, url: URL, origin: string) {
  const recognizedPath =
    url.pathname === SLICER_BRIDGE_HEALTH_PATH || url.pathname === SLICER_BRIDGE_HANDOFF_PATH
  if (request.method === "OPTIONS" && recognizedPath) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (request.method === "GET" && url.pathname === SLICER_BRIDGE_HEALTH_PATH) {
    return jsonResponse(
      {
        protocolVersion: SLICER_BRIDGE_PROTOCOL_VERSION,
        service: SLICER_BRIDGE_SERVICE_ID,
        status: "ready",
      },
      200,
      origin,
    )
  }
  if (request.method !== "POST" || url.pathname !== SLICER_BRIDGE_HANDOFF_PATH) {
    return failure("invalid-request", "Unknown slicer bridge operation.", false, 404, origin)
  }
  return null
}

type ValidatedHandoffRequest =
  | Readonly<{ ok: true; metadata: SlicerHandoffRequestMetadata }>
  | Readonly<{ ok: false; response: Response }>

function validateHandoffRequest(input: {
  configuration: BridgeConfiguration
  origin: string
  request: Request
  url: URL
}): ValidatedHandoffRequest {
  if (!tokenMatches(input.request, input.configuration.token)) {
    return {
      ok: false,
      response: failure(
        "unauthorized",
        "The slicer bridge credential is invalid.",
        false,
        401,
        input.origin,
      ),
    }
  }
  const metadata = slicerHandoffRequestMetadataSchema.safeParse({
    protocolVersion: Number(input.url.searchParams.get("protocolVersion")),
    requestId: input.url.searchParams.get("requestId"),
    slicerId: input.url.searchParams.get("slicerId"),
    filename: input.url.searchParams.get("filename"),
  })
  if (!metadata.success) {
    return {
      ok: false,
      response: failure(
        "invalid-request",
        "The handoff metadata is invalid.",
        false,
        400,
        input.origin,
      ),
    }
  }
  const contentLengthHeader = input.request.headers.get("content-length")
  const contentLength = contentLengthHeader === null ? 0 : Number(contentLengthHeader)
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > MAX_SLICER_HANDOFF_BYTES
  ) {
    return {
      ok: false,
      response: failure(
        "invalid-request",
        "The 3MF handoff has an invalid or excessive size.",
        false,
        contentLength > MAX_SLICER_HANDOFF_BYTES ? 413 : 400,
        input.origin,
      ),
    }
  }
  if (!input.request.headers.get("content-type")?.toLowerCase().startsWith("model/3mf")) {
    return {
      ok: false,
      response: failure(
        "invalid-request",
        "The handoff must contain a 3MF file.",
        false,
        415,
        input.origin,
      ),
    }
  }
  return { ok: true, metadata: metadata.data }
}

type HandoffOutcome = Readonly<{
  response: Response
  completed: SlicerHandoffResponse | null
}>

async function performHandoff(input: {
  fileStore: HandoffFileStore
  launch: LaunchSlicer
  metadata: SlicerHandoffRequestMetadata
  origin: string
  request: Request
}): Promise<HandoffOutcome> {
  const bytes = new Uint8Array(await input.request.arrayBuffer())
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_SLICER_HANDOFF_BYTES ||
    !hasThreeMfMagic(bytes)
  ) {
    return {
      response: failure(
        "invalid-request",
        "The handoff is not a bounded 3MF archive.",
        false,
        400,
        input.origin,
      ),
      completed: null,
    }
  }

  let persisted: Awaited<ReturnType<HandoffFileStore["persist"]>>
  try {
    persisted = await input.fileStore.persist(input.metadata.filename, bytes)
  } catch {
    return {
      response: failure(
        "file-write-failed",
        "The local 3MF file could not be written.",
        true,
        500,
        input.origin,
      ),
      completed: null,
    }
  }
  persisted.scheduleCleanup()

  try {
    await input.launch({ slicerId: input.metadata.slicerId, filePath: persisted.path })
  } catch (error) {
    const notInstalled = error instanceof SlicerNotInstalledError
    return {
      response: failure(
        notInstalled ? "slicer-not-installed" : "launch-failed",
        notInstalled ? error.message : boundedMessage(error, "The slicer could not be launched."),
        !notInstalled,
        notInstalled ? 404 : 502,
        input.origin,
      ),
      completed: null,
    }
  }

  const completed = slicerHandoffResponseSchema.parse({
    protocolVersion: SLICER_BRIDGE_PROTOCOL_VERSION,
    ok: true,
    requestId: input.metadata.requestId,
    slicerId: input.metadata.slicerId,
    filename: input.metadata.filename,
  })
  return { response: jsonResponse(completed, 200, input.origin), completed }
}

function rememberCompletedHandoff(
  completed: Map<string, { completedAt: number; response: SlicerHandoffResponse }>,
  response: SlicerHandoffResponse | null,
  currentTime: number,
) {
  if (!response?.ok) return
  completed.set(response.requestId, { completedAt: currentTime, response })
  for (const [requestId, result] of completed) {
    if (result.completedAt <= currentTime - DEDUPLICATION_WINDOW_MS) completed.delete(requestId)
  }
  while (completed.size > 100) {
    const oldestRequestId = completed.keys().next().value
    if (!oldestRequestId) return
    completed.delete(oldestRequestId)
  }
}

function admissionResponse(input: {
  allowAttempt: (now: number) => boolean
  completed: Map<string, { completedAt: number; response: SlicerHandoffResponse }>
  currentTime: number
  handoffActive: boolean
  metadata: SlicerHandoffRequestMetadata
  origin: string
}) {
  const previous = input.completed.get(input.metadata.requestId)
  if (previous && previous.completedAt > input.currentTime - DEDUPLICATION_WINDOW_MS) {
    return jsonResponse(previous.response, 200, input.origin)
  }
  if (!input.allowAttempt(input.currentTime)) {
    return failure("rate-limited", "Too many slicer handoff requests.", true, 429, input.origin)
  }
  if (input.handoffActive) {
    return failure(
      "handoff-busy",
      "Another slicer handoff is still running.",
      true,
      409,
      input.origin,
    )
  }
  return null
}

export function createSlicerBridgeHandler(input: {
  configuration: BridgeConfiguration
  fileStore: HandoffFileStore
  launch?: LaunchSlicer
  now?: () => number
}) {
  const allowAttempt = createRateLimiter()
  const completed = new Map<string, { completedAt: number; response: SlicerHandoffResponse }>()
  const now = input.now ?? Date.now
  let handoffActive = false

  return async (request: Request) => {
    const authorized = authorizedRequest(request, input.configuration)
    if (!authorized) {
      return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } })
    }
    const routed = routedOperationResponse(request, authorized.url, authorized.origin)
    if (routed) return routed
    const validated = validateHandoffRequest({
      configuration: input.configuration,
      origin: authorized.origin,
      request,
      url: authorized.url,
    })
    if (!validated.ok) return validated.response
    const admitted = admissionResponse({
      allowAttempt,
      completed,
      currentTime: now(),
      handoffActive,
      metadata: validated.metadata,
      origin: authorized.origin,
    })
    if (admitted) return admitted

    handoffActive = true
    try {
      const outcome = await performHandoff({
        fileStore: input.fileStore,
        launch: input.launch ?? launchSlicerFile,
        metadata: validated.metadata,
        origin: authorized.origin,
        request,
      })
      rememberCompletedHandoff(completed, outcome.completed, now())
      return outcome.response
    } catch {
      return failure(
        "internal-error",
        "The slicer bridge failed unexpectedly.",
        true,
        500,
        authorized.origin,
      )
    } finally {
      handoffActive = false
    }
  }
}
