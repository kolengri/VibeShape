import {
  commandActorSchema,
  commandActorsEqual,
  documentCommandSchema,
} from "@vibeshape/domain/commands"
import {
  documentIdSchema,
  draftIdSchema,
  revisionSchema,
  timestampSchema,
} from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { automationDraftStateSchema } from "./drafts"
import { serializedQueryBytes } from "./query-byte-budget"

export const DRAFT_RECOVERY_MAX_BYTES = 128 * 1024
const authorityKeys = new Set([
  "actor",
  "authority",
  "bearer",
  "bearertoken",
  "authorization",
  "credential",
  "credentials",
  "token",
  "accesstoken",
  "refreshtoken",
  "session",
  "sessionid",
  "sessiontoken",
  "clientid",
  "clientsecret",
  "apikey",
])
const jsonValueSchema = z.json()
type RecoveryJson = z.infer<typeof jsonValueSchema>
function authorityKey(key: string) {
  return authorityKeys.has(key.toLowerCase().replaceAll("_", "").replaceAll("-", ""))
}
function containsAuthority(value: RecoveryJson): boolean {
  if (Array.isArray(value)) return value.some(containsAuthority)
  return (
    value !== null &&
    typeof value === "object" &&
    Object.entries(value).some(([key, item]) => authorityKey(key) || containsAuthority(item))
  )
}

/** Private trusted-host handoff. Never accepted as tool arguments or returned as public intent. */
export const draftRecoveryJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    originalDraftId: draftIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    privateRevision: revisionSchema,
    originalActor: commandActorSchema,
    origin: z.object({ draftId: draftIdSchema, actor: commandActorSchema }).strict().optional(),
    expiresAt: z.number().int().positive().safe(),
    commands: z.array(documentCommandSchema).min(1).max(64),
  })
  .strict()
  .superRefine((journal, context) => {
    if (
      journal.privateRevision !== journal.baseRevision + journal.commands.length ||
      journal.commands.some(
        (command, index) =>
          command.documentId !== journal.documentId ||
          command.baseRevision !== journal.baseRevision + index ||
          !commandActorsEqual(command.actor, journal.originalActor),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Recovery commands must match their captured document, actor and exact revision sequence.",
      })
  })
  .readonly()
export type DraftRecoveryJournal = z.infer<typeof draftRecoveryJournalSchema>
export const draftRecoveryCaptureSchema = z
  .object({ schemaVersion: z.literal(1), journals: z.array(draftRecoveryJournalSchema).max(4) })
  .strict()
  .refine(
    (value) => serializedQueryBytes(value) <= DRAFT_RECOVERY_MAX_BYTES,
    "The complete recovery journal exceeds 128 KiB.",
  )
export type DraftRecoveryCapture = z.infer<typeof draftRecoveryCaptureSchema>

const intentSchema = z
  .union(
    documentCommandSchema.options.map((schema) =>
      schema.omit({
        actor: true,
        commandId: true,
        documentId: true,
        baseRevision: true,
        issuedAt: true,
      }),
    ),
  )
  .refine(
    (value) => !containsAuthority(z.json().parse(value)),
    "Recovery intent cannot carry actor or credential authority.",
  )
export const recoverableDraftsViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    items: z
      .array(
        z
          .object({
            recoveryId: draftIdSchema,
            originalDraftId: draftIdSchema,
            baseRevision: revisionSchema,
            privateRevision: revisionSchema,
            commandCount: z.number().int().positive().max(64),
            expiresAt: timestampSchema,
            intent: z.array(intentSchema).min(1).max(64),
          })
          .strict(),
      )
      .max(4),
  })
  .strict()
  .refine(
    (value) => serializedQueryBytes(value) <= DRAFT_RECOVERY_MAX_BYTES,
    "The complete recovery view exceeds 128 KiB.",
  )
export const restoreDraftArgumentsSchema = z
  .object({ recoveryId: draftIdSchema, baseRevision: revisionSchema })
  .strict()
export const restoredDraftViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    recoveryId: draftIdSchema,
    attribution: z.object({ type: z.literal("current-actor"), actor: commandActorSchema }).strict(),
    draft: automationDraftStateSchema,
  })
  .strict()

export function recoverySemanticPayload(value: RecoveryJson): RecoveryJson {
  if (Array.isArray(value)) return value.map(recoverySemanticPayload)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !authorityKey(key))
      .map(([key, item]) => [key, recoverySemanticPayload(item)]),
  )
}

export function recoveryResultContextMatches(
  operation: { tool: string; arguments: unknown },
  result: { ok: boolean; value?: unknown },
  documentId: string,
  actor: unknown,
): boolean | null {
  if (operation.tool !== "list_recoverable_drafts" && operation.tool !== "restore_draft")
    return null
  if (!result.ok) return true
  if (operation.tool === "list_recoverable_drafts") {
    const view = recoverableDraftsViewSchema.safeParse(result.value)
    return (
      view.success &&
      view.data.documentId === documentId &&
      view.data.items.every(
        (item) =>
          item.recoveryId === item.originalDraftId &&
          item.baseRevision === view.data.revision &&
          item.privateRevision === item.baseRevision + item.commandCount &&
          item.intent.length === item.commandCount,
      )
    )
  }
  const request = restoreDraftArgumentsSchema.safeParse(operation.arguments)
  const view = restoredDraftViewSchema.safeParse(result.value)
  const caller = commandActorSchema.safeParse(actor)
  return (
    request.success &&
    view.success &&
    caller.success &&
    view.data.recoveryId === request.data.recoveryId &&
    view.data.draft.documentId === documentId &&
    view.data.draft.baseRevision === request.data.baseRevision &&
    view.data.draft.draftId !== view.data.recoveryId &&
    commandActorsEqual(view.data.attribution.actor, caller.data)
  )
}
