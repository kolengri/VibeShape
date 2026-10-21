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
import type { DraftReviewInput, DraftReviewPort } from "./draft-review"
import type { DraftGeometryPort } from "./exact-draft-preview"
import type { AutomationHostDiagnosticCode, AutomationHostResult } from "./host"
import {
  metadataProposalFailure as failure,
  metadataProposalClockSchema,
  metadataReviewDecision,
  type PreparedMetadataInput,
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

export function createMetadataProposalCoordinator(configuration: MetadataProposalConfiguration) {
  return createReviewedAuthoredProposalCoordinator<MetadataCommand, MetadataCommitView>(
    configuration,
    {
      parse: (actor, input, time) => parseMetadataProposalInput(configuration, actor, input, time),
      prepare: (input) => prepareMetadataProposal(configuration, input),
      preview: (proposal) => previewMetadataProposal(configuration, proposal),
      recheck: (proposal) => recheckMetadataProposal(configuration, proposal),
      commit: (proposal) =>
        configuration.commit(
          documentV2MetadataCommandSchema.parse(proposal.command),
          authoredDocumentSnapshotSchema.parse(proposal.snapshot),
        ),
      validateReceipt: validateMetadataCommitReceipt,
    },
  )
}

export type ReviewedAuthoredProposalInput<Command> = Readonly<{
  command: Command
  draftId: PreparedMetadataInput["draftId"]
  expiresAt: number
}>
export type ReviewedAuthoredProposal<Command, Value> = ReviewedAuthoredProposalInput<Command> &
  Readonly<{
    base: AuthoredDocumentSnapshot
    snapshot: AuthoredDocumentSnapshot
    value: Value
  }>

/** Shared settlement lifecycle; adapters retain their own semantic command and receipt contracts. */
export function createReviewedAuthoredProposalCoordinator<
  Command extends Readonly<{ commandId: string }>,
  Value,
>(
  configuration: Pick<MetadataProposalConfiguration, "now" | "isActive" | "review">,
  ports: Readonly<{
    parse: (
      actor: unknown,
      input: unknown,
      time: number,
    ) => AutomationHostResult<ReviewedAuthoredProposalInput<Command>>
    prepare: (
      input: ReviewedAuthoredProposalInput<Command>,
    ) => Promise<AutomationHostResult<ReviewedAuthoredProposal<Command, Value>>>
    preview: (
      proposal: ReviewedAuthoredProposal<Command, Value>,
    ) => Promise<AutomationHostResult<DraftReviewInput>>
    recheck: (
      proposal: ReviewedAuthoredProposal<Command, Value>,
    ) => Promise<Extract<AutomationHostResult<never>, { ok: false }> | null>
    commit: (proposal: ReviewedAuthoredProposal<Command, Value>) => Promise<unknown>
    validateReceipt: (committed: unknown, expected: Value) => AutomationHostResult<Value>
  }>,
) {
  const now = configuration.now ?? Date.now
  const seen = new Set<string>()
  let busy = false
  let closed = false
  let persisting = false
  let generation = 0
  let cancellationCode: AutomationHostDiagnosticCode = "draft-review-cancelled"

  function operationGuard(
    input: ReviewedAuthoredProposalInput<Command>,
    signal?: Readonly<{ aborted: boolean }>,
  ) {
    const captured = generation
    return () => {
      const active =
        !closed && generation === captured && !signal?.aborted && configuration.isActive()
      if (!active)
        return failure(
          generation !== captured ? cancellationCode : "draft-review-cancelled",
          "The authored proposal session or request was cancelled.",
        )
      const time = metadataProposalClockSchema.safeParse(now())
      if (!time.success) return failure("invalid-host-clock", "The proposal clock is invalid.")
      return time.data >= input.expiresAt
        ? failure("draft-expired", "The authored proposal expired.")
        : null
    }
  }

  async function reviewAndCommit(
    proposal: ReviewedAuthoredProposal<Command, Value>,
    guard: ReturnType<typeof operationGuard>,
  ): Promise<AutomationHostResult<Value>> {
    const preview = await ports.preview(proposal)
    if (!preview.ok) return preview
    const afterPreview = guard()
    if (afterPreview) return afterPreview
    const decision = await configuration.review.confirm(preview.value)
    const reviewed = guard() ?? metadataReviewDecision(decision)
    if (reviewed) return reviewed
    const changed = await ports.recheck(proposal)
    if (changed) return changed
    const beforeWrite = guard()
    if (beforeWrite) return beforeWrite
    // Once persistence starts, its actual result owns settlement even if the transport closes.
    persisting = true
    const committed = await ports.commit(proposal)
    return ports.validateReceipt(committed, proposal.value)
  }

  async function run(
    input: ReviewedAuthoredProposalInput<Command>,
    guard: ReturnType<typeof operationGuard>,
  ): Promise<AutomationHostResult<Value>> {
    try {
      const proposal = await ports.prepare(input)
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
          ? "The save could not be confirmed; inspect the saved project before retrying."
          : "The authored proposal could not be completed.",
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
  ): Promise<AutomationHostResult<Value>> {
    if (busy)
      return failure("automation-operation-failed", "Another authored proposal is pending.", true)
    const operation = ports.parse(actorInput, input, now())
    if (!operation.ok) return operation
    const guard = operationGuard(operation.value, signal)
    const interrupted = guard()
    if (interrupted) return interrupted
    if (seen.has(operation.value.command.commandId))
      return failure("duplicate-command-id", "The command identifier was already proposed.")
    if (seen.size >= 4096)
      return failure("draft-limit-reached", "Reconnect to start a new bounded proposal session.")
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
