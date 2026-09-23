import type { HistoryViewRow } from "./model-tree-history"
import { historyRefKey } from "./model-tree-history"

export type HistoryMove = Readonly<{
  item: HistoryViewRow["ref"]
  historyAfter: HistoryViewRow["ref"] | null
  rows: readonly HistoryViewRow[]
}>

function historyIndexByKey(rows: readonly HistoryViewRow[]) {
  const indexByKey = new Map<string, number>()
  for (const [index, row] of rows.entries()) {
    const key = historyRefKey(row.ref)
    if (indexByKey.has(key)) return null
    indexByKey.set(key, index)
  }
  return indexByKey
}

function historyMoveBounds(
  rows: readonly HistoryViewRow[],
  indexByKey: ReadonlyMap<string, number>,
  sourceIndex: number,
) {
  let earliest = 0
  let latest = rows.length - 1
  for (const [index, row] of rows.entries()) {
    for (const dependency of row.dependencies) {
      const dependencyIndex = indexByKey.get(historyRefKey(dependency))
      if (dependencyIndex === undefined || dependencyIndex >= index) return null
      if (index === sourceIndex) earliest = Math.max(earliest, dependencyIndex + 1)
      if (dependencyIndex === sourceIndex) latest = Math.min(latest, index - 1)
    }
  }
  return { earliest, latest }
}

export function historyMovePositions(
  rows: readonly HistoryViewRow[],
  sourceKey: string,
  graphComplete: boolean,
): readonly number[] {
  if (!graphComplete) return []
  const indexByKey = historyIndexByKey(rows)
  if (!indexByKey) return []
  const sourceIndex = indexByKey.get(sourceKey)
  if (sourceIndex === undefined) return []
  const bounds = historyMoveBounds(rows, indexByKey, sourceIndex)
  if (!bounds) return []

  const positions: number[] = []
  for (let index = bounds.earliest; index <= bounds.latest; index += 1) {
    if (index !== sourceIndex) positions.push(index)
  }
  return positions
}

/** Build a dependency-safe preview without mutating document state. */
export function proposeHistoryMove(
  rows: readonly HistoryViewRow[],
  sourceKey: string,
  targetKey: string,
  graphComplete: boolean,
): HistoryMove | null {
  if (!graphComplete || sourceKey === targetKey) return null
  const sourceIndex = rows.findIndex((row) => historyRefKey(row.ref) === sourceKey)
  const targetIndex = rows.findIndex((row) => historyRefKey(row.ref) === targetKey)
  if (sourceIndex < 0 || targetIndex < 0) return null

  return proposeHistoryMoveToIndex(rows, sourceKey, targetIndex, graphComplete)
}

export function proposeHistoryMoveToIndex(
  rows: readonly HistoryViewRow[],
  sourceKey: string,
  targetIndex: number,
  graphComplete: boolean,
): HistoryMove | null {
  if (
    !Number.isInteger(targetIndex) ||
    !historyMovePositions(rows, sourceKey, graphComplete).includes(targetIndex)
  )
    return null
  const sourceIndex = rows.findIndex((row) => historyRefKey(row.ref) === sourceKey)
  if (sourceIndex < 0) return null

  const nextRows = [...rows]
  const [source] = nextRows.splice(sourceIndex, 1)
  if (!source) return null
  nextRows.splice(targetIndex, 0, source)
  if (nextRows.every((row, index) => row === rows[index])) return null

  return {
    item: source.ref,
    historyAfter: nextRows[targetIndex - 1]?.ref ?? null,
    rows: nextRows,
  }
}
