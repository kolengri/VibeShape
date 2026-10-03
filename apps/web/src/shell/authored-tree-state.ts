import {
  type ResolvedAuthoredPart,
  resolveAuthoredParts,
} from "@vibeshape/application/authored-parts"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { type HistoryFolder, historyItemKey } from "@vibeshape/domain/history-folders"
import type { PartId } from "@vibeshape/domain/identifiers"
import type { DocumentControllerState } from "../document/document-controller"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import type { HistoryViewRow } from "./model-tree-history"

export function currentAuthoredSnapshot(
  controller: DocumentControllerState,
): AuthoredDocumentSnapshot | null {
  const snapshot = controller.authoredSnapshot
  const report = controller.report
  return snapshot &&
    snapshot.schemaVersion !== 1 &&
    report &&
    snapshot.id === report.snapshot.id &&
    snapshot.revision === report.snapshot.revision
    ? snapshot
    : null
}

export function currentAuthoredParts(
  controller: DocumentControllerState,
): readonly ResolvedAuthoredPart[] {
  const authority = currentAuthoredSnapshot(controller)
  if (!authority || !controller.report) return []
  return (
    resolveAuthoredParts(authority, controller.report) ??
    authority.parts.map((part) => ({
      part,
      body: null,
      status: part.consumedBy ? "consumed" : "unavailable",
    }))
  )
}

export function selectedAuthoredBody(
  parts: readonly ResolvedAuthoredPart[],
  partId: PartId | null,
): ModelBodySelection | null {
  const resolved = parts.find(({ part }) => part.id === partId)
  return resolved?.part.visible && resolved.body
    ? {
        featureId: resolved.body.featureId,
        ...(resolved.body.outputRole === undefined ? {} : { outputRole: resolved.body.outputRole }),
      }
    : null
}

export function authoredBodyKey(body: {
  featureId: string
  outputRole?: string | undefined
}): string {
  return `${body.featureId}:${body.outputRole ?? "result"}`
}

export function authoredBodyKeys(authority: AuthoredDocumentSnapshot, hiddenOnly = false) {
  return new Set(
    authority.parts.flatMap((part) =>
      hiddenOnly && part.visible ? [] : part.bodyHistory.map(authoredBodyKey),
    ),
  )
}

export type FolderHistoryGroup = Readonly<{
  folder: HistoryFolder | null
  rows: readonly Readonly<{ row: HistoryViewRow; index: number }>[]
}>
export function groupFolderHistory(
  rows: readonly HistoryViewRow[],
  folders: readonly HistoryFolder[],
): readonly FolderHistoryGroup[] {
  const byItem = new Map(
    folders.flatMap((folder) =>
      folder.items.map((item) => [historyItemKey(item), folder] as const),
    ),
  )
  const groups: { folder: HistoryFolder | null; rows: { row: HistoryViewRow; index: number }[] }[] =
    []
  rows.forEach((row, index) => {
    const folder = byItem.get(historyItemKey(row.ref)) ?? null
    const previous = groups.at(-1)
    if (folder && previous?.folder?.id === folder.id) previous.rows.push({ row, index })
    else groups.push({ folder, rows: [{ row, index }] })
  })
  return groups
}

export function folderRangeItems(
  authority: AuthoredDocumentSnapshot,
  first: string,
  last: string,
  editingId?: string,
): readonly HistoryItemRef[] | null {
  const start = authority.history.findIndex((item) => historyItemKey(item) === first)
  const end = authority.history.findIndex((item) => historyItemKey(item) === last)
  if (start < 0 || end < start) return null
  const items = authority.history.slice(start, end + 1)
  const occupied = new Set(
    authority.folders
      .filter((folder) => folder.id !== editingId)
      .flatMap((folder) => folder.items.map(historyItemKey)),
  )
  return items.some((item) => occupied.has(historyItemKey(item))) ? null : items
}
