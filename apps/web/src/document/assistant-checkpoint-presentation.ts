import type { DocumentHistoryPreview } from "@vibeshape/application/persistent-document-session"
import type { AssemblyInspection, DocumentWorkerTerminalResponse } from "@vibeshape/protocol"

export type AssistantCheckpointPresentation = Readonly<{
  kind: "assistant-checkpoint"
  documentId: string
  baseRevision: number
  target: DocumentHistoryPreview
  rebuild: Extract<DocumentWorkerTerminalResponse, { type: "documentRebuilt" }>
  assembly: AssemblyInspection | null
}>
