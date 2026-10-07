import { historyItemKey } from "@vibeshape/domain/history-folders"
import type { DocumentControllerState } from "./document-controller"

export function historyCreationAfter(controller: DocumentControllerState) {
  return controller.historyInsertion
    ? controller.historyInsertion.historyAfter
    : (controller.report?.historyItems?.at(-1) ?? null)
}

/** Rebase a presentation cursor after a committed mutation, never across project replacement. */
export function reconcileHistoryInsertion(
  previous: DocumentControllerState,
  next: DocumentControllerState,
  advance = false,
) {
  const cursor = next.historyInsertion
  const snapshot = next.report?.snapshot
  if (!cursor || !snapshot) return cursor ?? null
  if (cursor.documentId !== snapshot.id) return null
  const items = next.report?.historyItems ?? []
  const oldKeys = advance
    ? new Set((previous.report?.historyItems ?? []).map(historyItemKey))
    : null
  const inserted = oldKeys ? items.filter((item) => !oldKeys.has(historyItemKey(item))) : []
  const anchor = inserted.at(-1) ?? cursor.historyAfter
  if (anchor && !items.some((item) => historyItemKey(item) === historyItemKey(anchor))) return null
  return { ...cursor, baseRevision: snapshot.revision, historyAfter: anchor }
}
