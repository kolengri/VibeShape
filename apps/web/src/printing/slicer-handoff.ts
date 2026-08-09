import {
  SLICER_BRIDGE_HANDOFF_PATH,
  SLICER_BRIDGE_ORIGIN,
  SLICER_BRIDGE_PROTOCOL_VERSION,
  type SlicerBridgeDiagnosticCode,
  type SlicerId,
  slicerBridgeTokenSchema,
  slicerHandoffFilenameSchema,
  slicerHandoffResponseSchema,
  slicerIdSchema,
} from "@vibeshape/slicer-handoff/protocol"

export const PREFERRED_SLICER_STORAGE_KEY = "org.vibeshape.preferred-slicer.v1"
export const SLICER_BRIDGE_TOKEN_STORAGE_KEY = "org.vibeshape.slicer-bridge-token.v1"
export const DEFAULT_SLICER_ID: SlicerId = "orca-slicer"

export const slicerTargets = [
  { id: "orca-slicer", name: "OrcaSlicer" },
  { id: "bambu-studio", name: "Bambu Studio" },
  { id: "prusa-slicer", name: "PrusaSlicer" },
  { id: "snapmaker-orca", name: "Snapmaker Orca" },
  { id: "ultimaker-cura", name: "UltiMaker Cura" },
] as const satisfies readonly Readonly<{ id: SlicerId; name: string }>[]

type StorageReader = Pick<Storage, "getItem">
type StorageWriter = Pick<Storage, "setItem">
type StorageRemover = Pick<Storage, "removeItem">

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readPreferredSlicer(storage: StorageReader | null = browserStorage()): SlicerId {
  if (!storage) return DEFAULT_SLICER_ID
  try {
    const parsed = slicerIdSchema.safeParse(storage.getItem(PREFERRED_SLICER_STORAGE_KEY))
    return parsed.success ? parsed.data : DEFAULT_SLICER_ID
  } catch {
    return DEFAULT_SLICER_ID
  }
}

export function savePreferredSlicer(
  slicerId: SlicerId,
  storage: StorageWriter | null = browserStorage(),
) {
  if (!storage) return false
  try {
    storage.setItem(PREFERRED_SLICER_STORAGE_KEY, slicerId)
    return true
  } catch {
    return false
  }
}

export function readSlicerBridgeToken(storage: StorageReader | null = browserStorage()) {
  if (!storage) return null
  try {
    const parsed = slicerBridgeTokenSchema.safeParse(
      storage.getItem(SLICER_BRIDGE_TOKEN_STORAGE_KEY),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveSlicerBridgeToken(
  token: string,
  storage: StorageWriter | null = browserStorage(),
) {
  const parsed = slicerBridgeTokenSchema.safeParse(token.trim())
  if (!storage || !parsed.success) return false
  try {
    storage.setItem(SLICER_BRIDGE_TOKEN_STORAGE_KEY, parsed.data)
    return true
  } catch {
    return false
  }
}

export function removeSlicerBridgeToken(storage: StorageRemover | null = browserStorage()) {
  if (!storage) return false
  try {
    storage.removeItem(SLICER_BRIDGE_TOKEN_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export type SlicerHandoffClientResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "not-configured" | "unavailable" | "invalid-response" }>
  | Readonly<{
      ok: false
      reason: "rejected"
      diagnostic: Readonly<{
        code: SlicerBridgeDiagnosticCode
        message: string
        retryable: boolean
      }>
    }>

export async function handoffThreeMfToSlicer(input: {
  file: Uint8Array
  filename: string
  slicerId: SlicerId
  token?: string | null
  fetch?: typeof globalThis.fetch
  createRequestId?: () => `${string}-${string}-${string}-${string}-${string}`
  timeoutMs?: number
}): Promise<SlicerHandoffClientResult> {
  const token = slicerBridgeTokenSchema.safeParse(input.token)
  if (!token.success) return { ok: false, reason: "not-configured" }
  const filename = slicerHandoffFilenameSchema.safeParse(input.filename)
  if (!filename.success) return { ok: false, reason: "invalid-response" }

  const requestId = (input.createRequestId ?? (() => crypto.randomUUID()))()
  const query = new URLSearchParams({
    protocolVersion: String(SLICER_BRIDGE_PROTOCOL_VERSION),
    requestId,
    slicerId: input.slicerId,
    filename: filename.data,
  })
  const abortController = new AbortController()
  const timeout = window.setTimeout(() => abortController.abort(), input.timeoutMs ?? 5_000)

  try {
    const response = await (input.fetch ?? globalThis.fetch)(
      `${SLICER_BRIDGE_ORIGIN}${SLICER_BRIDGE_HANDOFF_PATH}?${query}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.data}`,
          "Content-Type": "model/3mf",
        },
        body: Uint8Array.from(input.file).buffer,
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        referrerPolicy: "no-referrer",
        signal: abortController.signal,
      },
    )
    const payload: unknown = await response.json().catch(() => null)
    const parsed = slicerHandoffResponseSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: "invalid-response" }
    if (!parsed.data.ok) {
      return { ok: false, reason: "rejected", diagnostic: parsed.data.diagnostic }
    }
    if (
      !response.ok ||
      parsed.data.requestId !== requestId ||
      parsed.data.slicerId !== input.slicerId ||
      parsed.data.filename !== filename.data
    ) {
      return { ok: false, reason: "invalid-response" }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: "unavailable" }
  } finally {
    window.clearTimeout(timeout)
  }
}
