import { z } from "zod"

export const SLICER_BRIDGE_PROTOCOL_VERSION = 1 as const
export const SLICER_BRIDGE_PORT = 43_113
export const SLICER_BRIDGE_HOST = "127.0.0.1" as const
export const SLICER_BRIDGE_ORIGIN = `http://${SLICER_BRIDGE_HOST}:${SLICER_BRIDGE_PORT}` as const
export const SLICER_BRIDGE_HANDOFF_PATH = "/v1/handoffs" as const
export const SLICER_BRIDGE_HEALTH_PATH = "/v1/health" as const
export const SLICER_BRIDGE_SERVICE_ID = "org.vibeshape.slicer-bridge" as const
export const MAX_SLICER_HANDOFF_BYTES = 128 * 1024 * 1024

export const slicerIdSchema = z.enum([
  "orca-slicer",
  "bambu-studio",
  "prusa-slicer",
  "snapmaker-orca",
  "ultimaker-cura",
])

export type SlicerId = z.infer<typeof slicerIdSchema>

export const slicerBridgeTokenSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Bridge tokens must use base64url characters.")

export const slicerBridgeOriginSchema = z
  .url()
  .regex(
    /^https?:\/\/[^/?#@]+$/,
    "The paired application origin must be an exact HTTP or HTTPS origin.",
  )

export const slicerHandoffFilenameSchema = z
  .string()
  .trim()
  .min(5)
  .max(128)
  .regex(/^[^/\\]+\.3mf$/i, "Use a portable .3mf filename.")
  .refine(
    (filename) =>
      [...filename].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint >= 32 && codePoint !== 127
      }),
    "Use a portable .3mf filename.",
  )

export const slicerHandoffRequestMetadataSchema = z
  .object({
    protocolVersion: z.literal(SLICER_BRIDGE_PROTOCOL_VERSION),
    requestId: z.uuid(),
    slicerId: slicerIdSchema,
    filename: slicerHandoffFilenameSchema,
  })
  .strict()

export const slicerBridgeDiagnosticCodeSchema = z.enum([
  "invalid-request",
  "unauthorized",
  "rate-limited",
  "handoff-busy",
  "slicer-not-installed",
  "file-write-failed",
  "launch-failed",
  "internal-error",
])

const slicerBridgeDiagnosticSchema = z
  .object({
    code: slicerBridgeDiagnosticCodeSchema,
    message: z.string().trim().min(1).max(1_024),
    retryable: z.boolean(),
  })
  .strict()

export const slicerHandoffResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      protocolVersion: z.literal(SLICER_BRIDGE_PROTOCOL_VERSION),
      ok: z.literal(true),
      requestId: z.uuid(),
      slicerId: slicerIdSchema,
      filename: slicerHandoffFilenameSchema,
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(SLICER_BRIDGE_PROTOCOL_VERSION),
      ok: z.literal(false),
      diagnostic: slicerBridgeDiagnosticSchema,
    })
    .strict(),
])

export const slicerBridgeHealthResponseSchema = z
  .object({
    protocolVersion: z.literal(SLICER_BRIDGE_PROTOCOL_VERSION),
    service: z.literal(SLICER_BRIDGE_SERVICE_ID),
    status: z.literal("ready"),
  })
  .strict()

export type SlicerHandoffResponse = z.infer<typeof slicerHandoffResponseSchema>
export type SlicerHandoffRequestMetadata = z.infer<typeof slicerHandoffRequestMetadataSchema>
export type SlicerBridgeDiagnosticCode = z.infer<typeof slicerBridgeDiagnosticCodeSchema>
