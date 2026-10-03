import type { AutomationDraftPreview } from "@vibeshape/automation-api/drafts"
import type { CommandActor, DocumentCommand } from "@vibeshape/domain/commands"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import type { DocumentV2MetadataChange } from "@vibeshape/domain/document-v2-command-schemas"

export type DraftReviewDecision = "approved" | "rejected" | "cancelled"

export type DraftReviewInput = Readonly<{
  actor: CommandActor
  preview: AutomationDraftPreview
  commands: readonly DocumentCommand[]
  metadata?: Readonly<{
    change: DocumentV2MetadataChange
    targetName: string | null
    range: Readonly<{
      first: HistoryItemRef
      last: HistoryItemRef
      count: number
      firstLabel: string
      lastLabel: string
    }> | null
  }>
}>

export type DraftReviewPort = Readonly<{
  confirm: (input: DraftReviewInput) => unknown | PromiseLike<unknown>
}>
