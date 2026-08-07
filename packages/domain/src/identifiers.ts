import { z } from "zod"

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const reverseDnsPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function createUuidV7Schema<Name extends string>(name: Name) {
  return z.string().regex(uuidV7Pattern, `${name} must be a lowercase UUIDv7.`).brand<Name>()
}

export const commandIdSchema = createUuidV7Schema("CommandId")
export const documentIdSchema = createUuidV7Schema("DocumentId")
export const draftIdSchema = createUuidV7Schema("DraftId")
export const sessionIdSchema = createUuidV7Schema("SessionId")

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
export type ModuleId = z.infer<typeof moduleIdSchema>
export type SessionId = z.infer<typeof sessionIdSchema>
