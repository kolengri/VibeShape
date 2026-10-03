import type { metadataCommitViewSchema } from "@vibeshape/automation-api/authored-metadata"
import type { QueryDispatcher } from "@vibeshape/automation-api/queries"
import type { CommandActor } from "@vibeshape/domain/commands"
import {
  type AuthoredDocumentSnapshot,
  authoredDocumentSnapshotSchema,
} from "@vibeshape/domain/document-v2"
import { documentV2MetadataCommandSchema } from "@vibeshape/domain/document-v2-command-schemas"
import type { DocumentId } from "@vibeshape/domain/identifiers"
import type { z } from "zod"
import type { DraftReviewPort } from "./draft-review"
import type { DraftGeometryPort } from "./exact-draft-preview"
import type { AutomationHostDiagnosticCode, AutomationHostResult } from "./host"
import {
  metadataProposalFailure as failure,
  metadataProposalClockSchema,
  metadataReviewDecision,
  type PreparedMetadataInput,
  type PreparedMetadataProposal,
  parseMetadataProposalInput,
  prepareMetadataProposal,
  previewMetadataProposal,
  recheckMetadataProposal,
  validateMetadataCommitReceipt,
} from "./metadata-proposal-support"

export type MetadataCommand = z.infer<typeof documentV2MetadataCommandSchema>
export type MetadataCommitView = z.infer<typeof metadataCommitViewSchema>
export type MetadataProposalConfiguration = Readonly<{
  documentId: DocumentId
  actor: CommandActor
  readSnapshot: () => unknown | PromiseLike<unknown>
  hasCommandId: (commandId: string) => Promise<boolean>
  commit: (command: MetadataCommand, expected: AuthoredDocumentSnapshot) => Promise<unknown>
  geometry: DraftGeometryPort
  queries: QueryDispatcher
  review: DraftReviewPort
  createDraftId: () => unknown
  isActive: () => boolean
  now?: () => number
}>

/** One typed proposal retains its exact intent across disposable preview and manual consent. */
export function createMetadataProposalCoordinator(configuration: MetadataProposalConfiguration) {
  const now = configuration.now ?? Date.now
  const seen = new Set<string>()
  let busy = false
  let closed = false
  let persisting = false
  let generation = 0
  let cancellationCode: AutomationHostDiagnosticCode = "draft-review-cancelled"

  function operationGuard(input: PreparedMetadataInput, signal?: Readonly<{ aborted: boolean }>) {
    const captured = generation
    return () => {
      const active =
        !closed && generation === captured && !signal?.aborted && configuration.isActive()
      if (!active)
        return failure(
          generation !== captured ? cancellationCode : "draft-review-cancelled",
          "The metadata session or request was cancelled.",
        )
      const time = metadataProposalClockSchema.safeParse(now())
      if (!time.success) return failure("invalid-host-clock", "The proposal clock is invalid.")
      return time.data >= input.expiresAt
        ? failure("draft-expired", "The metadata proposal expired.")
        : null
    }
  }

  async function reviewAndCommit(
    proposal: PreparedMetadataProposal,
    guard: ReturnType<typeof operationGuard>,
  ): Promise<AutomationHostResult<MetadataCommitView>> {
    const preview = await previewMetadataProposal(configuration, proposal)
    if (!preview.ok) return preview
    const afterPreview = guard()
    if (afterPreview) return afterPreview
    const decision = await configuration.review.confirm(preview.value)
    const reviewed = guard() ?? metadataReviewDecision(decision)
    if (reviewed) return reviewed
    const changed = await recheckMetadataProposal(configuration, proposal)
    if (changed) return changed
    const beforeWrite = guard()
    if (beforeWrite) return beforeWrite
    // Once persistence starts, its actual result owns settlement even if the transport closes.
    persisting = true
    const committed = await configuration.commit(
      documentV2MetadataCommandSchema.parse(proposal.command),
      authoredDocumentSnapshotSchema.parse(proposal.snapshot),
    )
    return validateMetadataCommitReceipt(committed, proposal.value)
  }

  async function run(
    input: PreparedMetadataInput,
    guard: ReturnType<typeof operationGuard>,
  ): Promise<AutomationHostResult<MetadataCommitView>> {
    try {
      const proposal = await prepareMetadataProposal(configuration, input)
      if (!proposal.ok) return proposal
      const interrupted = guard()
      if (interrupted) return interrupted
      seen.add(input.command.commandId)
      return await reviewAndCommit(proposal.value, guard)
    } catch {
      const interrupted = persisting ? null : guard()
      if (interrupted) return interrupted
      return failure(
        persisting ? "document-commit-failed" : "automation-operation-failed",
        persisting
          ? "The metadata save could not be confirmed; inspect the saved project before retrying."
          : "The metadata proposal could not be completed.",
        true,
      )
    } finally {
      busy = false
      persisting = false
    }
  }

  async function change(
    actorInput: unknown,
    input: unknown,
    signal?: Readonly<{ aborted: boolean }>,
  ): Promise<AutomationHostResult<MetadataCommitView>> {
    if (busy)
      return failure("automation-operation-failed", "Another metadata proposal is pending.", true)
    const operation = parseMetadataProposalInput(configuration, actorInput, input, now())
    if (!operation.ok) return operation
    const guard = operationGuard(operation.value, signal)
    const interrupted = guard()
    if (interrupted) return interrupted
    if (seen.has(operation.value.command.commandId))
      return failure("duplicate-command-id", "The command identifier was already proposed.")
    if (seen.size >= 4096)
      return failure("draft-limit-reached", "Reconnect to start a new bounded metadata session.")
    busy = true
    return run(operation.value, guard)
  }
  return {
    change,
    cancel(reason: AutomationHostDiagnosticCode = "draft-review-cancelled") {
      cancellationCode = reason
      generation += 1
    },
    dispose() {
      closed = true
      cancellationCode = "draft-review-cancelled"
      generation += 1
    },
    isPersisting: () => persisting,
  }
}
