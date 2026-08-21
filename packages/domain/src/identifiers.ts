import { z } from "zod"

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const reverseDnsPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const MAX_UUID_V7_TIMESTAMP = 0xffffffffffff
const UUID_V7_RANDOM_BYTE_COUNT = 10

function createUuidV7Schema<Name extends string>(name: Name) {
  return z.string().regex(uuidV7Pattern, `${name} must be a lowercase UUIDv7.`).brand<Name>()
}

export const commandIdSchema = createUuidV7Schema("CommandId")
export const documentIdSchema = createUuidV7Schema("DocumentId")
export const draftIdSchema = createUuidV7Schema("DraftId")
export const featureIdSchema = createUuidV7Schema("FeatureId")
export const sketchConstraintIdSchema = createUuidV7Schema("SketchConstraintId")
export const sketchEntityIdSchema = createUuidV7Schema("SketchEntityId")
export const sketchExternalReferenceIdSchema = createUuidV7Schema("SketchExternalReferenceId")
export const sketchIdSchema = createUuidV7Schema("SketchId")
export const sessionIdSchema = createUuidV7Schema("SessionId")
export const variableIdSchema = createUuidV7Schema("VariableId")

export const technicalIdentifierSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(reverseDnsPattern, "Technical identifiers must use a lowercase dotted namespace.")

export const moduleIdSchema = technicalIdentifierSchema.brand<"ModuleId">()
export const moduleVersionSchema = z
  .string()
  .regex(semverPattern, "Module versions must be exact semantic versions.")

export const revisionSchema = z.number().int().nonnegative().safe()
export const timestampSchema = z.iso.datetime({ offset: true })

export type CommandId = z.infer<typeof commandIdSchema>
export type DocumentId = z.infer<typeof documentIdSchema>
export type DraftId = z.infer<typeof draftIdSchema>
export type FeatureId = z.infer<typeof featureIdSchema>
export type ModuleId = z.infer<typeof moduleIdSchema>
export type SessionId = z.infer<typeof sessionIdSchema>
export type SketchConstraintId = z.infer<typeof sketchConstraintIdSchema>
export type SketchEntityId = z.infer<typeof sketchEntityIdSchema>
export type SketchExternalReferenceId = z.infer<typeof sketchExternalReferenceIdSchema>
export type SketchId = z.infer<typeof sketchIdSchema>
export type VariableId = z.infer<typeof variableIdSchema>

export function generateUuidV7(input: { timestampMs: number; randomBytes: Uint8Array }) {
  if (
    !Number.isSafeInteger(input.timestampMs) ||
    input.timestampMs < 0 ||
    input.timestampMs > MAX_UUID_V7_TIMESTAMP
  ) {
    throw new RangeError("UUIDv7 timestamp must be a nonnegative 48-bit integer.")
  }
  if (input.randomBytes.length !== UUID_V7_RANDOM_BYTE_COUNT) {
    throw new RangeError("UUIDv7 generation requires exactly 10 random bytes.")
  }

  const bytes = new Uint8Array(16)
  let timestamp = input.timestampMs
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256
    timestamp = Math.floor(timestamp / 256)
  }
  bytes[6] = 0x70 | ((input.randomBytes.at(0) ?? 0) & 0x0f)
  bytes[7] = input.randomBytes.at(1) ?? 0
  bytes[8] = 0x80 | ((input.randomBytes.at(2) ?? 0) & 0x3f)
  bytes.set(input.randomBytes.subarray(3), 9)

  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}
