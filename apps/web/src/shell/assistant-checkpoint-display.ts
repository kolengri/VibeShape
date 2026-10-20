import type { DocumentControllerState } from "../document/document-controller"

function sameRevision(
  snapshot: Readonly<{ id: string; revision: number }>,
  documentId: string,
  revision: number,
) {
  return snapshot.id === documentId && snapshot.revision === revision
}

/** Display fences complement the runtime's actor and saved-head validation. */
export function assistantCheckpointForController(controller: DocumentControllerState) {
  const presentation = controller.assistantCheckpointPresentation
  const head = controller.report?.snapshot
  if (
    !presentation ||
    !head ||
    !sameRevision(head, presentation.documentId, presentation.baseRevision)
  )
    return null
  const { snapshot, authority, targetRevision } = presentation.target
  return snapshot.id === presentation.documentId &&
    snapshot.revision === targetRevision &&
    sameRevision(authority, snapshot.id, targetRevision) &&
    presentation.rebuild.documentId === snapshot.id &&
    presentation.rebuild.revision === targetRevision
    ? presentation
    : null
}

/** Reuses retained preview buffers without replacing live authority or saved history. */
export function assistantCheckpointDisplayController(
  controller: DocumentControllerState,
): DocumentControllerState | null {
  const presentation = assistantCheckpointForController(controller)
  const report = controller.report
  if (!presentation || !report) return null
  return {
    ...controller,
    status: "ready",
    saveStatus: "saved",
    authoredSnapshot: presentation.target.authority,
    report: {
      ...report,
      mode: "read-only",
      snapshot: presentation.target.snapshot,
      historyItems: null,
      rebuild: { ok: true, response: presentation.rebuild },
    },
    diagnostic: null,
    projectNavigationError: null,
    history: { canUndo: false, canRedo: false },
    historyInsertion: null,
    assistantCheckpointPresentation: null,
  }
}
