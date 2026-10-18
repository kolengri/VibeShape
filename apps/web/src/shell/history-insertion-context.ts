import type { SketchId } from "@vibeshape/domain"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import type { DocumentControllerState } from "../document/document-controller"

/** Null means full authority; -1 is the explicit boundary before the first item. */
export function effectiveHistoryBoundaryIndex(
  controller: DocumentControllerState,
  items: readonly HistoryItemRef[],
  editingSketchId?: SketchId | null,
  graphFailed = false,
): number | null {
  const report = controller.report
  if (!report || graphFailed) return null
  const cursor = controller.historyInsertion
  if (cursor && cursor.documentId === report.snapshot.id) {
    if (!cursor.historyAfter) return -1
    const anchor = cursor.historyAfter
    const index = items.findIndex((item) => item.kind === anchor.kind && item.id === anchor.id)
    if (index >= 0) return index
  }
  if (!editingSketchId || !report.snapshot.sketches.some(({ id }) => id === editingSketchId))
    return null
  const index = items.findIndex((item) => item.kind === "sketch" && item.id === editingSketchId)
  return index < 0 ? null : index
}

/** The insertion boundary limits input picking and preview, while full History stays visible. */
export function historyInsertionContext(
  controller: DocumentControllerState,
): DocumentControllerState {
  const { report, historyInsertion: cursor } = controller
  if (!report || !cursor || cursor.documentId !== report.snapshot.id) return controller
  const history = report.historyItems ?? []
  const index = cursor.historyAfter
    ? history.findIndex(
        (item) => item.kind === cursor.historyAfter?.kind && item.id === cursor.historyAfter.id,
      )
    : -1
  if (cursor.historyAfter && index < 0) return controller
  const items = history.slice(0, index + 1)
  const featureIds = new Set<string>(
    items.filter((item) => item.kind === "feature").map(({ id }) => id),
  )
  const sketchIds = new Set<string>(
    items.filter((item) => item.kind === "sketch").map(({ id }) => id),
  )
  const rebuild = report.rebuild
  return {
    ...controller,
    report: {
      ...report,
      historyItems: items,
      snapshot: {
        ...report.snapshot,
        features: report.snapshot.features.filter(({ id }) => featureIds.has(id)),
        sketches: report.snapshot.sketches.filter(({ id }) => sketchIds.has(id)),
      },
      rebuild: rebuild.ok
        ? {
            ...rebuild,
            response: {
              ...rebuild.response,
              geometry: rebuild.response.geometry.filter(({ featureId }) =>
                featureIds.has(featureId),
              ),
              sketches: rebuild.response.sketches.filter(({ sketchId }) => sketchIds.has(sketchId)),
              evaluation: {
                ...rebuild.response.evaluation,
                records: rebuild.response.evaluation.records.filter(({ featureId }) =>
                  featureIds.has(featureId),
                ),
              },
            },
          }
        : rebuild,
    },
  }
}

export function historyInsertionAnchor(
  controller: DocumentControllerState,
  item: HistoryItemRef,
  side: "above" | "below",
) {
  const items = controller.report?.historyItems ?? []
  const index = items.findIndex(
    (candidate) => candidate.kind === item.kind && candidate.id === item.id,
  )
  if (index < 0) return { found: false as const }
  return { found: true as const, anchor: side === "below" ? item : (items[index - 1] ?? null) }
}
