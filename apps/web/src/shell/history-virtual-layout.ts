import type { VirtualItem } from "@tanstack/react-virtual"
import type { HistoryFolder } from "@vibeshape/domain/history-folders"
import type { FolderHistoryGroup } from "./authored-tree-state"
import type { HistoryTimelineSegment } from "./history-timeline-cursor"
import { type HistoryViewRow, historyRefKey } from "./model-tree-history"

export type HistoryTrackUnit = Readonly<{
  key: string
  group: number
  row?: Readonly<{ row: HistoryViewRow; index: number }>
}>
export type HistoryTrackGroup = Readonly<{
  folder: HistoryFolder | null
  start: number
  end: number
  rows: FolderHistoryGroup["rows"]
}>

export function historyTrackLayout(
  groups: readonly FolderHistoryGroup[],
  collapsed: ReadonlySet<string>,
) {
  const units: HistoryTrackUnit[] = []
  const layout: HistoryTrackGroup[] = []
  groups.forEach((group, groupIndex) => {
    const start = units.length
    if (group.folder) units.push({ key: `folder:${group.folder.id}`, group: groupIndex })
    if (!group.folder || !collapsed.has(group.folder.id)) {
      for (const row of group.rows)
        units.push({ key: historyRefKey(row.row.ref), group: groupIndex, row })
    }
    layout.push({ ...group, start, end: units.length - 1 })
  })
  return { units, layout }
}

function collapsedSegment(group: HistoryTrackGroup, item: VirtualItem | undefined) {
  const first = group.rows[0]
  const last = group.rows.at(-1)
  return first && last && item
    ? { first: first.index, last: last.index, left: item.start, right: item.end }
    : null
}

export function historyTrackSegments(
  groups: readonly HistoryTrackGroup[],
  units: readonly HistoryTrackUnit[],
  measurements: readonly VirtualItem[],
  collapsed: ReadonlySet<string>,
): HistoryTimelineSegment[] {
  const segments: HistoryTimelineSegment[] = []
  for (const group of groups) {
    if (group.folder && collapsed.has(group.folder.id)) {
      const segment = collapsedSegment(group, measurements[group.start])
      if (segment) segments.push(segment)
      continue
    }
    for (let index = group.start; index <= group.end; index++) {
      const row = units[index]?.row
      const item = measurements[index]
      if (row && item)
        segments.push({ first: row.index, last: row.index, left: item.start, right: item.end })
    }
  }
  return segments
}
