import {
  createDocumentDependencyGraphFromSnapshot,
  type DocumentNodeRef,
  type FeatureRecord,
  readDatumPlaneFeatureParameters,
  type SketchRecord,
} from "@vibeshape/domain"
import { terminalFeatureIds } from "../features/part-design/terminal-features"

export type HistoryViewRow = Readonly<{
  ref: DocumentNodeRef
  record: SketchRecord | FeatureRecord
  kind: "sketch" | "feature"
  datum: boolean
  dependencies: readonly DocumentNodeRef[]
  dependents: readonly DocumentNodeRef[]
}>

export type ModelTreeHistoryView = Readonly<{
  rows: readonly HistoryViewRow[]
  labelsByRef: ReadonlyMap<string, string>
  bodyFeatures: readonly FeatureRecord[]
  graphFailed: boolean
  diagnostic?: string
}>

type Snapshot = Readonly<{ sketches: readonly SketchRecord[]; features: readonly FeatureRecord[] }>

export function historyRefKey(ref: DocumentNodeRef) {
  return `${ref.kind}:${ref.id}`
}

function labelsByRef(rows: readonly HistoryViewRow[]) {
  return new Map(rows.map((row) => [historyRefKey(row.ref), row.record.label ?? ""]))
}

export function selectModelTreeHistory(snapshot: Snapshot): ModelTreeHistoryView {
  const graphResult = createDocumentDependencyGraphFromSnapshot(snapshot)
  if (!graphResult.ok) {
    // Keep visibility bounded and deterministic, but never invent an interleaving on failure.
    const rows = [
      ...snapshot.sketches.map((record) => ({
        ref: { kind: "sketch" as const, id: record.id },
        record,
        kind: "sketch" as const,
        datum: false,
        dependencies: [],
        dependents: [],
      })),
      ...snapshot.features.map((record) => ({
        ref: { kind: "feature" as const, id: record.id },
        record,
        kind: "feature" as const,
        datum: readDatumPlaneFeatureParameters(record) !== null,
        dependencies: [],
        dependents: [],
      })),
    ]
    return {
      rows,
      labelsByRef: labelsByRef(rows),
      bodyFeatures: [],
      graphFailed: true,
      diagnostic: graphResult.diagnostic.message,
    }
  }
  const { graph } = graphResult
  const rows = graph.history.flatMap((ref) => {
    const node = graph.getNode(ref)
    if (!node) return []
    return [
      {
        ref,
        record: node.record,
        kind: ref.kind,
        datum:
          ref.kind === "feature" &&
          readDatumPlaneFeatureParameters(node.record as FeatureRecord) !== null,
        dependencies: graph.dependenciesOf(ref),
        dependents: graph.dependentsOf(ref),
      },
    ]
  })
  const bodyIds = terminalFeatureIds(snapshot.features)
  return {
    rows,
    labelsByRef: labelsByRef(rows),
    bodyFeatures: snapshot.features.filter((feature) => bodyIds.has(feature.id)),
    graphFailed: false,
  }
}
