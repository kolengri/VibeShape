import {
  type HistoryMoveCommitView,
  historyMoveArgumentsSchema,
  historyMoveCommitViewSchema,
} from "@vibeshape/automation-api/history-move-tools"
import { localFailureSchema } from "@vibeshape/automation-api/local-tools"
import { applyVersionedDocumentCommand } from "@vibeshape/domain"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type AuthoredDocumentSnapshot,
  authoredDocumentSnapshotSchema,
  projectAuthoredDocumentSnapshotToV1,
} from "@vibeshape/domain/document-v2"
import { applyDocumentV2ModelEvent } from "@vibeshape/domain/document-v2-commands"
import { applyDocumentV3ModelEvent } from "@vibeshape/domain/document-v3-commands"
import { applyDocumentV4ModelEvent } from "@vibeshape/domain/document-v4-commands"
import { applyDocumentV5ModelEvent } from "@vibeshape/domain/document-v5-commands"
import {
  type MoveHistoryItemCommand,
  moveHistoryItemCommandSchema,
} from "@vibeshape/domain/history-document-commands"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import {
  createReviewedAuthoredProposalCoordinator,
  type MetadataProposalConfiguration,
} from "./metadata-proposal"
import {
  metadataProposalFailure as failure,
  metadataProposalClockSchema,
  pairedAuthoredProposalActor,
  previewAuthoredProposal,
  recheckMetadataProposal,
} from "./metadata-proposal-support"

export type HistoryMoveProposalConfiguration = Omit<MetadataProposalConfiguration, "commit"> & {
  commit: (command: MoveHistoryItemCommand, expected: AuthoredDocumentSnapshot) => Promise<unknown>
}

/** The exact full authored target is shared by review and the ordinary semantic save's grant. */
export function prepareAuthoredHistoryMove(
  base: AuthoredDocumentSnapshot,
  command: MoveHistoryItemCommand,
) {
  const moved = applyVersionedDocumentCommand(projectAuthoredDocumentSnapshotToV1(base), command)
  if (!moved.ok) return moved
  switch (base.schemaVersion) {
    case 5:
      return applyDocumentV5ModelEvent(base, moved.event, [])
    case 4:
      return applyDocumentV4ModelEvent(base, moved.event, [])
    case 3:
      return applyDocumentV3ModelEvent(base, moved.event, [])
    case 2:
      return applyDocumentV2ModelEvent(base, moved.event, [])
  }
}

export function createHistoryMoveProposalCoordinator(
  configuration: HistoryMoveProposalConfiguration,
) {
  return createReviewedAuthoredProposalCoordinator<MoveHistoryItemCommand, HistoryMoveCommitView>(
    configuration,
    {
      parse(actorInput, input, time) {
        const actor = pairedAuthoredProposalActor(configuration.actor, actorInput)
        if (!actor.ok) return actor
        const request = historyMoveArgumentsSchema.safeParse(input)
        if (!request.success || request.data.documentId !== configuration.documentId)
          return failure("invalid-draft-request", "The paired history move request is invalid.")
        const at = metadataProposalClockSchema.safeParse(time)
        if (!at.success) return failure("invalid-host-clock", "The proposal clock is invalid.")
        const draftId = draftIdSchema.safeParse(configuration.createDraftId())
        if (!draftId.success)
          return failure("invalid-generated-draft-id", "The proposal identifier is invalid.")
        return {
          ok: true,
          value: {
            draftId: draftId.data,
            expiresAt: at.data + 300_000,
            command: moveHistoryItemCommandSchema.parse({
              kind: "org.vibeshape.history.move-item",
              schemaVersion: 1,
              documentId: request.data.documentId,
              baseRevision: request.data.baseRevision,
              commandId: request.data.commandId,
              actor: actor.value,
              issuedAt: new Date(at.data).toISOString(),
              payload: { item: request.data.item, historyAfter: request.data.historyAfter },
            }),
          },
        }
      },
      async prepare(input) {
        const before = authoredDocumentSnapshotSchema.safeParse(await configuration.readSnapshot())
        if (!before.success || before.data.id !== configuration.documentId)
          return failure(
            "invalid-document-snapshot",
            "The paired authored document is unavailable.",
          )
        if (before.data.revision !== input.command.baseRevision)
          return failure(
            "stale-revision",
            "The history move base revision is no longer current.",
            true,
          )
        if (await configuration.hasCommandId(input.command.commandId))
          return failure(
            "duplicate-command-id",
            "The command identifier already exists in the journal.",
          )
        const prepared = prepareAuthoredHistoryMove(before.data, input.command)
        if (!prepared.ok) return { ok: false, diagnostic: { ...prepared.diagnostic, issues: [] } }
        const value = historyMoveCommitViewSchema.parse({
          documentId: input.command.documentId,
          baseRevision: input.command.baseRevision,
          commandId: input.command.commandId,
          revision: prepared.snapshot.revision,
          ...input.command.payload,
        })
        return {
          ok: true,
          value: { ...input, base: before.data, snapshot: prepared.snapshot, value },
        }
      },
      async preview(proposal) {
        const preview = await previewAuthoredProposal(configuration, proposal)
        if (!preview.ok) return preview
        const label = (item: MoveHistoryItemCommand["payload"]["item"]) =>
          (item.kind === "feature" ? proposal.base.features : proposal.base.sketches).find(
            (entry) => entry.id === item.id,
          )?.label ?? item.id
        const command = moveHistoryItemCommandSchema.parse(proposal.command)
        const { item, historyAfter } = command.payload
        return {
          ok: true,
          value: {
            ...preview.value,
            historyMove: {
              command,
              target: authoredDocumentSnapshotSchema.parse(proposal.snapshot),
              itemLabel: label(item),
              historyAfterLabel: historyAfter ? label(historyAfter) : null,
            },
          },
        }
      },
      recheck: (proposal) => recheckMetadataProposal(configuration, proposal),
      commit: (proposal) =>
        configuration.commit(
          moveHistoryItemCommandSchema.parse(proposal.command),
          authoredDocumentSnapshotSchema.parse(proposal.snapshot),
        ),
      validateReceipt(committed, expected) {
        const rejected = localFailureSchema.safeParse(committed)
        if (rejected.success) {
          const code = rejected.data.diagnostic.code
          return failure(
            code === "stale-revision" ||
              code === "duplicate-command-id" ||
              code === "document-write-unavailable" ||
              code === "draft-commit-intent-mismatch"
              ? code
              : "document-commit-failed",
            rejected.data.diagnostic.message,
            rejected.data.diagnostic.retryable,
          )
        }
        const validated = historyMoveCommitViewSchema.safeParse(committed)
        if (!validated.success || canonicalJson(validated.data) !== canonicalJson(expected))
          return failure(
            "invalid-commit-port-result",
            "The history move save result could not be confirmed.",
          )
        return { ok: true, value: validated.data }
      },
    },
  )
}
