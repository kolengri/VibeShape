import {
  createDocumentDependencyGraphFromSnapshot,
  type DocumentNodeRef,
  type FeatureRecord,
  inspectSketchReferenceHealth,
  readDatumPlaneFeatureParameters,
  type SketchModelReferenceHealthResolver,
  type SketchRecord,
  type SketchReferenceHealth,
} from "@vibeshape/domain"
import type { DocumentModelReferenceEvidence, DocumentWorkerResponse } from "@vibeshape/protocol"
import { terminalFeatureIds } from "../features/part-design/terminal-features"
import {
  inspectSketchSupportHealth,
  type SketchSupportHealth,
} from "../features/sketch/sketch-support"

export type HistoryViewRow = Readonly<{
  ref: DocumentNodeRef
  record: SketchRecord | FeatureRecord
  kind: "sketch" | "feature"
  datum: boolean
  dependencies: readonly DocumentNodeRef[]
  dependents: readonly DocumentNodeRef[]
  referenceHealth: SketchReferenceHealth | null
  supportHealth: SketchSupportHealth | null
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

function modelReferenceHealthResolver(
  evidence: readonly DocumentModelReferenceEvidence[] | undefined,
): SketchModelReferenceHealthResolver | undefined {
  if (!evidence) return undefined
  const byReference = new Map(
    evidence.map((record) => [`${record.sketchId}:${record.referenceId}`, record.status] as const),
  )
  return (ownerSketchId, reference) =>
    byReference.get(`${ownerSketchId}:${reference.id}`) ?? "unknown"
}

export function selectModelTreeHistory(
  snapshot: Snapshot,
  modelReferenceEvidence?: readonly DocumentModelReferenceEvidence[],
  rebuild?: Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>,
): ModelTreeHistoryView {
  const referenceHealth = inspectSketchReferenceHealth(
    snapshot.sketches,
    undefined,
    modelReferenceHealthResolver(modelReferenceEvidence),
  )
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
        referenceHealth: referenceHealth.get(record.id) ?? null,
        supportHealth: inspectSketchSupportHealth(record, rebuild),
      })),
      ...snapshot.features.map((record) => ({
        ref: { kind: "feature" as const, id: record.id },
        record,
        kind: "feature" as const,
        datum: readDatumPlaneFeatureParameters(record) !== null,
        dependencies: [],
        dependents: [],
        referenceHealth: null,
        supportHealth: null,
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
        referenceHealth:
          ref.kind === "sketch"
            ? (referenceHealth.get(node.record.id as SketchRecord["id"]) ?? null)
            : null,
        supportHealth:
          ref.kind === "sketch"
            ? inspectSketchSupportHealth(node.record as SketchRecord, rebuild)
            : null,
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
