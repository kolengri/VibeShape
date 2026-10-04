import {
  type HistoryCommitView,
  type HistoryOperation,
  historyCommitViewSchema,
  historyOperationSchema,
  historyStateViewSchema,
} from "@vibeshape/automation-api/history-tools"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { documentAuthoritySnapshotSchema } from "@vibeshape/domain/document-v2"
import {
  commandIdSchema,
  type DocumentId,
  documentIdSchema,
  draftIdSchema,
  revisionSchema,
  timestampSchema,
} from "@vibeshape/domain/identifiers"
import { modelMeasurementEvidenceSchema } from "@vibeshape/domain/model-measurements"
import { z } from "zod"
import type { AutomationHostDiagnosticCode } from "./host"

export const HISTORY_REVIEW_TTL_MS = 5 * 60_000
export const historyRequestSchema = z
  .object({
    direction: z.enum(["undo", "redo"]),
    commandId: commandIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()
export const historyTargetSchema = z
  .object({
    targetRevision: revisionSchema,
    snapshot: documentSnapshotSchema,
    authority: documentAuthoritySnapshotSchema,
  })
  .strict()
  .refine(
    ({ snapshot, authority, targetRevision }) =>
      snapshot.id === authority.id &&
      snapshot.revision === targetRevision &&
      authority.revision === targetRevision,
  )
const evidenceSchema = z
  .object({
    valid: z.boolean(),
    measurements: modelMeasurementEvidenceSchema,
    assembly: z
      .object({
        occurrenceCount: z.number().int().nonnegative().safe(),
        degreesOfFreedom: z.number().int().nonnegative().safe(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type HistoryTarget = z.infer<typeof historyTargetSchema>
export type HistoryRequest = z.infer<typeof historyRequestSchema>
export type HistoryPreviewEvidence = z.infer<typeof evidenceSchema>
const historyReviewInputSchema = z
  .object({
    kind: z.literal("history"),
    actor: commandActorSchema,
    documentName: z.string(),
    draft: z
      .object({
        draftId: draftIdSchema,
        documentId: documentIdSchema,
        baseRevision: revisionSchema,
        commandId: commandIdSchema,
        direction: z.enum(["undo", "redo"]),
        targetRevision: revisionSchema,
        expiresAt: timestampSchema,
      })
      .strict(),
    request: historyRequestSchema,
    preview: evidenceSchema,
    featureCount: z.number().int().nonnegative().safe(),
    partCount: z.number().int().nonnegative().safe(),
  })
  .strict()
export type HistoryReviewInput = z.infer<typeof historyReviewInputSchema>
export type HistoryCommitInput = Readonly<{ review: HistoryReviewInput; target: HistoryTarget }>
export type HistorySessionConfiguration = Readonly<{
  documentId: DocumentId
  isActive: () => boolean
  readSnapshot: () => unknown
  availability: () => { canUndo: boolean; canRedo: boolean }
  readTarget: (direction: "undo" | "redo") => unknown
  hasCommandId: (commandId: string) => Promise<boolean>
  createId: () => unknown
  now?: () => number
  preview: (target: HistoryTarget, baseRevision: number) => Promise<HistoryPreviewEvidence>
  review: (input: HistoryReviewInput) => Promise<"approved" | "rejected" | "cancelled">
  commit: (input: HistoryCommitInput) => Promise<unknown>
}>

/** History targets stay private; consent authorizes one captured ordinary restore request. */
export function createHistoryAutomationSession(configuration: HistorySessionConfiguration) {
  const now = configuration.now ?? Date.now
  let closed = false
  let busy = false
  let persisting = false
  let generation = 0
  let cancellation: AutomationHostDiagnosticCode = "draft-review-cancelled"
  let owner: CommandActor | null = null
  const seen = new Set<string>()
  const unavailable = () => localFailure("session-revoked", "The history session is unavailable.")

  function current(base: number) {
    if (closed || !configuration.isActive()) return unavailable()
    const snapshot = documentSnapshotSchema.safeParse(configuration.readSnapshot())
    if (!snapshot.success || snapshot.data.id !== configuration.documentId) return unavailable()
    if (snapshot.data.revision !== base)
      return localFailure("stale-revision", "Read the current history state before retrying.", true)
    return { ok: true as const, value: snapshot.data }
  }
  function captureTarget(direction: "undo" | "redo", base: number) {
    const target = historyTargetSchema.safeParse(configuration.readTarget(direction))
    return target.success &&
      target.data.snapshot.id === configuration.documentId &&
      target.data.targetRevision <= base
      ? target.data
      : null
  }
  async function commandIdentityBlock(commandId: string) {
    if (seen.has(commandId) || (await configuration.hasCommandId(commandId)))
      return localFailure("duplicate-command-id", "The command identifier was already used.")
    return seen.size >= 4096
      ? localFailure("draft-limit-reached", "Reconnect to start a new bounded history session.")
      : null
  }
  async function navigate(
    actor: CommandActor,
    operation: Exclude<HistoryOperation, { tool: "model_history_state" }>,
    signal?: Readonly<{ aborted: boolean }>,
  ) {
    const { baseRevision, commandId } = operation.arguments
    const clock = z
      .number()
      .int()
      .nonnegative()
      .max(8_640_000_000_000_000 - HISTORY_REVIEW_TTL_MS)
      .safeParse(now())
    const draftId = draftIdSchema.safeParse(configuration.createId())
    if (!clock.success || !draftId.success)
      return localFailure("invalid-host-configuration", "History review metadata is invalid.")
    const direction = operation.tool === "undo_model" ? "undo" : "redo"
    const expiresAt = clock.data + HISTORY_REVIEW_TTL_MS
    const capturedGeneration = generation
    const guard = () => {
      if (capturedGeneration !== generation || signal?.aborted)
        return localFailure(cancellation, "The history proposal was cancelled.")
      if (now() >= expiresAt) return localFailure("draft-expired", "The history proposal expired.")
      const state = current(baseRevision)
      return state.ok ? null : state
    }
    const before = guard()
    if (before) return before
    const commandBlock = await commandIdentityBlock(commandId)
    if (commandBlock) return commandBlock
    const afterRead = guard()
    if (afterRead) return afterRead

    const target = captureTarget(direction, baseRevision)
    if (!target)
      return localFailure("history-unavailable", "There is no saved change in this direction.")
    seen.add(commandId)
    const request = historyRequestSchema.parse({
      direction,
      commandId,
      documentId: configuration.documentId,
      baseRevision,
      issuedAt: new Date(clock.data).toISOString(),
      actor,
    })
    const approved = await reviewTarget(request, draftId.data, expiresAt, target, guard)
    if (!approved.ok) return approved
    return publishReviewed(approved.value, guard)
  }

  async function reviewTarget(
    request: HistoryRequest,
    draftId: z.infer<typeof draftIdSchema>,
    expiresAt: number,
    target: HistoryTarget,
    guard: () => ReturnType<typeof localFailure> | null,
  ) {
    const { baseRevision, commandId, direction, actor } = request
    const preview = evidenceSchema.parse(
      await configuration.preview(
        historyTargetSchema.parse(JSON.parse(canonicalJson(target))),
        baseRevision,
      ),
    )
    if (
      preview.measurements.documentId !== configuration.documentId ||
      preview.measurements.revision !== target.targetRevision
    )
      return localFailure(
        "invalid-preview-result",
        "History preview does not describe the captured target.",
      )
    const afterPreview = guard()
    if (afterPreview) return afterPreview
    const review: HistoryReviewInput = {
      kind: "history",
      actor: commandActorSchema.parse(actor),
      documentName: target.snapshot.name,
      draft: {
        draftId,
        documentId: configuration.documentId,
        baseRevision,
        commandId,
        direction,
        targetRevision: target.targetRevision,
        expiresAt: new Date(expiresAt).toISOString(),
      },
      request,
      preview,
      featureCount: target.snapshot.features.length,
      partCount: target.authority.schemaVersion === 1 ? 0 : target.authority.parts.length,
    }
    const decision = await configuration.review(
      historyReviewInputSchema.parse(JSON.parse(canonicalJson(review))),
    )
    const afterReview = guard()
    if (afterReview) return afterReview
    if (decision !== "approved")
      return localFailure(
        decision === "rejected" ? "draft-review-rejected" : "draft-review-cancelled",
        "The history proposal was not approved.",
      )
    return { ok: true as const, value: { review, target } }
  }

  async function publishReviewed(
    input: HistoryCommitInput,
    guard: () => ReturnType<typeof localFailure> | null,
  ) {
    const { request } = input.review
    const { direction, baseRevision, commandId } = request
    const { target, review } = input
    const freshTarget = captureTarget(direction, baseRevision)
    if (!freshTarget || canonicalJson(freshTarget) !== canonicalJson(target))
      return localFailure(
        "stale-history-target",
        "The saved history target changed; review it again.",
        true,
      )
    if (await configuration.hasCommandId(commandId))
      return localFailure("duplicate-command-id", "The command identifier was already used.")
    const beforeWrite = guard()
    if (beforeWrite) return beforeWrite
    // The ordinary publication owns settlement after this point, including transport cancellation.
    persisting = true
    const receipt = z
      .union([
        z.object({ ok: z.literal(true), value: historyCommitViewSchema }).strict(),
        z
          .object({
            ok: z.literal(false),
            diagnostic: z
              .object({ code: z.string(), message: z.string(), retryable: z.boolean() })
              .strict(),
          })
          .strict(),
      ])
      .safeParse(await configuration.commit({ review, target }))
    if (!receipt.success)
      return localFailure(
        "invalid-commit-port-result",
        "The history save could not be confirmed; inspect the project before retrying.",
        true,
      )
    if (!receipt.data.ok) return receipt.data
    const expected: HistoryCommitView = {
      commandId,
      baseRevision,
      documentId: configuration.documentId,
      revision: baseRevision + 1,
      direction,
      targetRevision: target.targetRevision,
    }
    return canonicalJson(receipt.data.value) === canonicalJson(expected)
      ? receipt.data
      : localFailure(
          "invalid-commit-port-result",
          "The history receipt does not match the approved request.",
          true,
        )
  }
  function authenticate(actorInput: unknown, input: unknown) {
    const operation = historyOperationSchema.safeParse(input)
    const actor = commandActorSchema.safeParse(actorInput)
    if (!operation.success)
      return localFailure("invalid-input", "The history operation is invalid.")
    if (operation.data.arguments.documentId !== configuration.documentId)
      return localFailure("document-mismatch", "The history request targets another document.")
    if (!actor.success || actor.data.type !== "mcp")
      return localFailure("invalid-automation-actor", "History requires a paired MCP actor.")
    if (owner && !commandActorsEqual(owner, actor.data))
      return localFailure("draft-owner-mismatch", "The history session belongs to another actor.")
    owner ??= actor.data
    return { ok: true as const, value: { actor: actor.data, operation: operation.data } }
  }
  function readAvailability(revision: number) {
    const state = current(revision)
    if (!state.ok) return state
    return {
      ok: true as const,
      value: historyStateViewSchema.parse({
        documentId: configuration.documentId,
        revision: state.value.revision,
        ...configuration.availability(),
      }),
    }
  }
  return {
    async execute(actorInput: unknown, input: unknown, signal?: Readonly<{ aborted: boolean }>) {
      const authenticated = authenticate(actorInput, input)
      if (!authenticated.ok) return authenticated
      const { actor, operation } = authenticated.value
      if (signal?.aborted)
        return localFailure("request-cancelled", "The history operation was cancelled.")
      if (operation.tool === "model_history_state")
        return readAvailability(operation.arguments.revision)
      if (busy) return localFailure("busy", "Another history proposal is pending.", true)
      busy = true
      try {
        return await navigate(actor, operation, signal)
      } catch {
        return localFailure(
          persisting ? "document-commit-failed" : "history-preview-failed",
          persisting
            ? "The history save could not be confirmed; inspect the project before retrying."
            : "The private history preview could not be completed.",
          true,
        )
      } finally {
        busy = false
        persisting = false
      }
    },
    cancel(reason: AutomationHostDiagnosticCode = "draft-review-cancelled") {
      cancellation = reason
      generation += 1
    },
    dispose() {
      closed = true
      generation += 1
    },
    isPersisting: () => persisting,
  }
}
