import type { AutomationDraftPreview } from "@vibeshape/automation-api/drafts"
import type { CommandActor, DocumentCommand } from "@vibeshape/domain/commands"

export type DraftReviewDecision = "approved" | "rejected" | "cancelled"

export type DraftReviewInput = Readonly<{
  actor: CommandActor
  preview: AutomationDraftPreview
  commands: readonly DocumentCommand[]
}>

export type DraftReviewPort = Readonly<{
  confirm: (input: DraftReviewInput) => unknown | PromiseLike<unknown>
}>
