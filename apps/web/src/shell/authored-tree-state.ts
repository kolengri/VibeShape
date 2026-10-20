import {
  type ResolvedAuthoredPart,
  resolveAuthoredParts,
} from "@vibeshape/application/authored-parts"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { type HistoryFolder, historyItemKey } from "@vibeshape/domain/history-folders"
import type { PartId } from "@vibeshape/domain/identifiers"
import type { DocumentControllerState } from "../document/document-controller"
import {
  effectivePartVisibility,
  type PartVisibilityOverrides,
} from "../editor-session/part-visibility"
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

const authoredPartsBySource = new WeakMap<
  AuthoredDocumentSnapshot,
  WeakMap<NonNullable<DocumentControllerState["report"]>, readonly ResolvedAuthoredPart[]>
>()

export function currentAuthoredParts(
  controller: DocumentControllerState,
): readonly ResolvedAuthoredPart[] {
  const authority = currentAuthoredSnapshot(controller)
  const report = controller.report
  if (!authority || !report) return []
  let byReport = authoredPartsBySource.get(authority)
  const cached = byReport?.get(report)
  if (cached) return cached
  // Rows share immutable sources even when hover publishes a new controller wrapper. A new
  // authority (including metadata) or report (including Before) must resolve independently.
  const parts: readonly ResolvedAuthoredPart[] =
    resolveAuthoredParts(authority, report) ??
    authority.parts.map((part) => ({
      part,
      body: null,
      status: part.consumedBy ? "consumed" : "unavailable",
    }))
  if (!byReport) {
    byReport = new WeakMap()
    authoredPartsBySource.set(authority, byReport)
  }
  byReport.set(report, parts)
  return parts
}

function authoredHistoryRepairKeys(
  authority: AuthoredDocumentSnapshot | null,
): ReadonlySet<string> {
  return new Set(
    authority?.schemaVersion === 5
      ? authority.repairIntents.map((intent) => `${intent.kind}:${intent.authored.id}`)
      : [],
  )
}

export function selectedAuthoredBody(
  parts: readonly ResolvedAuthoredPart[],
  partId: PartId | null,
  overrides?: PartVisibilityOverrides,
): ModelBodySelection | null {
  const resolved = parts.find(({ part }) => part.id === partId)
  return resolved && effectivePartVisibility(resolved.part, overrides) && resolved.body
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

export function authoredBodyKeys(
  authority: AuthoredDocumentSnapshot,
  hiddenOnly = false,
  overrides?: PartVisibilityOverrides,
) {
  return new Set(
    authority.parts.flatMap((part) =>
      hiddenOnly && effectivePartVisibility(part, overrides)
        ? []
        : part.bodyHistory.map(authoredBodyKey),
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

export function authoredHistoryTreeState(
  controller: DocumentControllerState,
  rows: readonly HistoryViewRow[],
) {
  const authority = currentAuthoredSnapshot(controller)
  return {
    authority,
    folderGroups: groupFolderHistory(rows, authority?.folders ?? []),
    repairIds: authoredHistoryRepairKeys(authority),
    insertionDisabled: controller.status !== "ready" || controller.report?.mode !== "read-write",
  }
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

export function selectedFolderItems(
  authority: AuthoredDocumentSnapshot,
  keys: readonly string[],
  editingId?: string,
): readonly HistoryItemRef[] | null {
  const selected = new Set(keys)
  const items = authority.history.filter((item) => selected.has(historyItemKey(item)))
  const first = items[0]
  const last = items.at(-1)
  if (!first || !last || items.length !== selected.size) return null
  const range = folderRangeItems(authority, historyItemKey(first), historyItemKey(last), editingId)
  return range?.length === items.length ? range : null
}

export function folderItemsWithSelection(
  authority: AuthoredDocumentSnapshot,
  folder: HistoryFolder,
  keys: readonly string[],
): readonly HistoryItemRef[] | null {
  if (!authority.folders.some((candidate) => candidate.id === folder.id)) return null
  const combined = [...new Set([...folder.items.map(historyItemKey), ...keys])]
  if (combined.length === folder.items.length) return null
  return selectedFolderItems(authority, combined, folder.id)
}
