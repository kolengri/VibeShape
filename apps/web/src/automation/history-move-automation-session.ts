import {
  createHistoryMoveProposalCoordinator,
  type HistoryMoveProposalConfiguration,
} from "@vibeshape/automation-host/history-move-proposal"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { commandActorsEqual } from "@vibeshape/domain/commands"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import type { MoveHistoryItemCommand } from "@vibeshape/domain/history-document-commands"
import type { SourceAssetMaterialization } from "@vibeshape/protocol"
import { automationReviews } from "./automation-review-controller"
import type { AutomationReviewState } from "./automation-review-state"
import { createReviewedAuthoredAutomationSession } from "./metadata-automation-session"

export type HistoryMoveAutomationSessionConfiguration = Omit<
  HistoryMoveProposalConfiguration,
  "actor" | "geometry" | "review"
> & {
  materializeSourceAssets?: (document: unknown) => Promise<readonly SourceAssetMaterialization[]>
}

export function createHistoryMoveAutomationSession(
  configuration: HistoryMoveAutomationSessionConfiguration,
  reviews = automationReviews,
) {
  return createReviewedAuthoredAutomationSession(
    {
      ...configuration,
      createCoordinator: (ports) =>
        createHistoryMoveProposalCoordinator({ ...configuration, ...ports }),
    },
    reviews,
  )
}

/** The controller consumes only the exact visible, applying grant for this authored target. */
export function historyMoveReviewedInputMatches(
  review: AutomationReviewState | null,
  command: MoveHistoryItemCommand,
  expected: AuthoredDocumentSnapshot,
  now = Date.now(),
) {
  if (review?.status !== "applying" || "kind" in review.input) return false
  const { historyMove, preview, actor } = review.input
  if (!historyMove) return false
  return (
    Number.isFinite(now) &&
    now < Date.parse(preview.draft.expiresAt) &&
    commandActorsEqual(actor, command.actor) &&
    preview.draft.documentId === command.documentId &&
    preview.draft.baseRevision === command.baseRevision &&
    preview.draft.revision === expected.revision &&
    preview.draft.commandCount === 1 &&
    preview.geometry.status === "valid" &&
    expected.id === command.documentId &&
    expected.revision === command.baseRevision + 1 &&
    canonicalJson(historyMove.command) === canonicalJson(command) &&
    canonicalJson(historyMove.target) === canonicalJson(expected)
  )
}
