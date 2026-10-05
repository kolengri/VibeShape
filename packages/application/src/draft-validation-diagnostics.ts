import type { DocumentCommand, DocumentEvent } from "@vibeshape/domain/commands"
import type { SessionPortDiagnostic } from "./persistent-document-session"

const commandKinds = {
  "org.vibeshape.document.created": "org.vibeshape.document.create",
  "org.vibeshape.document.renamed": "org.vibeshape.document.rename",
  "org.vibeshape.document.display-units-changed": "org.vibeshape.document.set-display-units",
  "org.vibeshape.variable.added": "org.vibeshape.variable.add",
  "org.vibeshape.variable.expression-changed": "org.vibeshape.variable.set-expression",
  "org.vibeshape.variable.renamed": "org.vibeshape.variable.rename",
  "org.vibeshape.variable.removed": "org.vibeshape.variable.remove",
  "org.vibeshape.variable.table-replaced": "org.vibeshape.variable.replace-table",
  "org.vibeshape.sketch.added": "org.vibeshape.sketch.add",
  "org.vibeshape.sketch.updated": "org.vibeshape.sketch.update",
  "org.vibeshape.sketch.removed": "org.vibeshape.sketch.remove",
  "org.vibeshape.feature.added": "org.vibeshape.feature.add",
  "org.vibeshape.feature.updated": "org.vibeshape.feature.update",
  "org.vibeshape.feature.removed": "org.vibeshape.feature.remove",
  "org.vibeshape.feature.removed-preserving-model-reference-intent":
    "org.vibeshape.feature.remove-preserving-model-reference-intent",
  "org.vibeshape.feature.suppression-changed": "org.vibeshape.feature.set-suppressed",
} satisfies Record<DocumentEvent["type"], DocumentCommand["kind"]>

type DiagnosticCause = SessionPortDiagnostic & {
  issues?: readonly Readonly<{ path: string; message: string }>[]
}

export function draftDiagnosticCause(source: DiagnosticCause): string {
  const issue = source.issues?.[0]
  return (issue ? `${source.message} ${issue.path}: ${issue.message}` : source.message).slice(
    0,
    512,
  )
}

export function draftCommandFailure(
  index: number,
  command: DocumentCommand | DocumentEvent | null,
  source: DiagnosticCause,
): SessionPortDiagnostic {
  const identity = command
    ? ` (${command.commandId}, ${"kind" in command ? command.kind : commandKinds[command.type]})`
    : ""
  return {
    code: source.code,
    message:
      `Draft command ${index + 1}${identity} failed: ${source.code}: ${draftDiagnosticCause(source)}`.slice(
        0,
        512,
      ),
    retryable: source.retryable,
  }
}
