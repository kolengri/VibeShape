import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import {
  projectWorldCircularEdgeToSupport,
  sampleWorldCircularEdge,
} from "@vibeshape/application/sketch-curve-projection"
import { projectWorldPointToSupport, type SupportFrame } from "@vibeshape/application/support-frame"
import type {
  TopologyCandidate as DomainTopologyCandidate,
  EdgeTopoRef,
  FeatureId,
  FeatureRecord,
  SketchEntityId,
  SketchRecord,
  VertexTopoRef,
} from "@vibeshape/domain"
import {
  featureIdSchema,
  projectedExternalCurvePointCount,
  resolveTopologyReference,
} from "@vibeshape/domain"
import type { TopologyCandidate as ProtocolTopologyCandidate } from "@vibeshape/protocol"
import {
  createBrowserSketchEntityId,
  createBrowserSketchExternalReferenceId,
} from "../../document/document-controller"
import { attachExternalProjectedPoint } from "./external-sketch-points"

export type ExternalModelPointCandidate = Readonly<{
  candidateId: string
  featureId: FeatureId
  kind: "model-point"
  label: string
  position: readonly [number, number, number]
  reference: VertexTopoRef
  x: number
  y: number
}>

type ProjectedModelPoint = Readonly<{
  world: readonly [number, number, number]
  x: number
  y: number
}>

export type ExternalModelLineCandidate = Readonly<{
  candidateId: string
  end: ProjectedModelPoint
  featureId: FeatureId
  kind: "model-line"
  label: string
  reference: EdgeTopoRef
  start: ProjectedModelPoint
}>

export type ExternalModelCurveCandidate = Readonly<{
  candidateId: string
  featureId: FeatureId
  kind: "model-curve"
  label: string
  points: readonly ProjectedModelPoint[]
  projectedType: "circle" | "arc" | "ellipse" | "elliptical-arc"
  reference: EdgeTopoRef
  sourceType: "circle" | "arc"
}>

export type ExternalModelGeometryCandidate =
  | ExternalModelPointCandidate
  | ExternalModelLineCandidate
  | ExternalModelCurveCandidate

export type ExternalModelGeometryLabels = Readonly<{
  curve: (featureLabel: string, kind: "circle" | "arc", ordinal: number) => string
  line: (featureLabel: string, ordinal: number) => string
  point: (featureLabel: string, ordinal: number) => string
}>

type ExternalModelGeometryRecord = Readonly<{
  featureId: string
  geometry: FeatureGeometryRecord["geometry"]
}>

function domainTopologyCandidate(candidate: ProtocolTopologyCandidate): DomainTopologyCandidate {
  const { referenceGeometry: _referenceGeometry, ...domainCandidate } = candidate
  return domainCandidate
}

function candidateKey(
  featureId: string,
  candidate: Pick<ProtocolTopologyCandidate, "candidateId" | "kind">,
) {
  return `${featureId}:${candidate.kind}:${candidate.candidateId}`
}

function referencedCandidateKeys(
  records: readonly ExternalModelGeometryRecord[],
  draft: SketchRecord,
) {
  const recordsByFeatureId = new Map(records.map((record) => [record.featureId, record]))
  const keys = new Set<string>()
  for (const external of draft.externalReferences ?? []) {
    if (
      external.kind !== "model-point" &&
      external.kind !== "model-line" &&
      external.kind !== "model-curve"
    ) {
      continue
    }
    const record = recordsByFeatureId.get(external.reference.featureId)
    if (!record) continue
    const candidates = record.geometry.topologyCandidates.map(domainTopologyCandidate)
    const resolution = resolveTopologyReference(external.reference, candidates)
    if (resolution.status !== "resolved") continue
    keys.add(
      candidateKey(external.reference.featureId, {
        candidateId: resolution.candidateId,
        kind: external.kind === "model-point" ? "vertex" : "edge",
      }),
    )
  }
  return keys
}

function stableVertexReference(
  featureId: FeatureId,
  candidate: ProtocolTopologyCandidate,
): VertexTopoRef {
  const identity = candidate.semanticRole
    ? { semanticRole: candidate.semanticRole }
    : candidate.lineageTokens.length === 1
      ? { lineageToken: candidate.lineageTokens[0] }
      : {}
  return {
    schemaVersion: 0,
    featureId,
    kind: "vertex",
    signature: { ...candidate.signature, kind: "vertex" },
    ...identity,
  }
}

function stableEdgeReference(
  featureId: FeatureId,
  candidate: ProtocolTopologyCandidate,
): EdgeTopoRef {
  const identity = candidate.semanticRole
    ? { semanticRole: candidate.semanticRole }
    : candidate.lineageTokens.length === 1
      ? { lineageToken: candidate.lineageTokens[0] }
      : {}
  return {
    schemaVersion: 0,
    featureId,
    kind: "edge",
    signature: { ...candidate.signature, kind: "edge" },
    ...identity,
  }
}

function createExternalModelPointCandidate(
  featureId: FeatureId,
  featureLabel: string,
  candidate: ProtocolTopologyCandidate,
  targetFrame: SupportFrame,
  ordinal: number,
  labels: ExternalModelGeometryLabels,
): ExternalModelPointCandidate | null {
  if (
    candidate.kind !== "vertex" ||
    candidate.signature.geometryClass !== "POINT" ||
    candidate.referenceGeometry?.kind !== "vertex"
  ) {
    return null
  }
  return {
    candidateId: candidate.candidateId,
    featureId,
    kind: "model-point",
    label: labels.point(featureLabel, ordinal),
    position: candidate.referenceGeometry.position,
    reference: stableVertexReference(featureId, candidate),
    ...projectWorldPointToSupport(targetFrame, candidate.referenceGeometry.position),
  }
}

function createExternalModelLineCandidate(
  featureId: FeatureId,
  featureLabel: string,
  candidate: ProtocolTopologyCandidate,
  targetFrame: SupportFrame,
  ordinal: number,
  labels: ExternalModelGeometryLabels,
): ExternalModelLineCandidate | null {
  if (
    candidate.kind !== "edge" ||
    candidate.signature.geometryClass !== "LINE" ||
    candidate.referenceGeometry?.kind !== "line-edge"
  ) {
    return null
  }
  const projectedStart = projectWorldPointToSupport(targetFrame, candidate.referenceGeometry.start)
  const projectedEnd = projectWorldPointToSupport(targetFrame, candidate.referenceGeometry.end)
  if (Math.hypot(projectedEnd.x - projectedStart.x, projectedEnd.y - projectedStart.y) <= 1e-9) {
    return null
  }
  return {
    candidateId: candidate.candidateId,
    end: { ...projectedEnd, world: candidate.referenceGeometry.end },
    featureId,
    kind: "model-line",
    label: labels.line(featureLabel, ordinal),
    reference: stableEdgeReference(featureId, candidate),
    start: { ...projectedStart, world: candidate.referenceGeometry.start },
  }
}

function createExternalModelCurveCandidate(
  featureId: FeatureId,
  featureLabel: string,
  candidate: ProtocolTopologyCandidate,
  targetFrame: SupportFrame,
  ordinal: number,
  labels: ExternalModelGeometryLabels,
): ExternalModelCurveCandidate | null {
  const geometry = candidate.referenceGeometry
  if (
    candidate.kind !== "edge" ||
    candidate.signature.geometryClass !== "CIRCLE" ||
    (geometry?.kind !== "circle-edge" && geometry?.kind !== "arc-edge")
  ) {
    return null
  }
  const projection = projectWorldCircularEdgeToSupport(geometry, targetFrame)
  if (!projection) return null
  const sourceType = geometry.kind === "circle-edge" ? "circle" : "arc"
  const points = sampleWorldCircularEdge(geometry).map((world) => ({
    world,
    ...projectWorldPointToSupport(targetFrame, world),
  }))
  return {
    candidateId: candidate.candidateId,
    featureId,
    kind: "model-curve",
    label: labels.curve(featureLabel, sourceType, ordinal),
    points,
    projectedType: projection.type,
    reference: stableEdgeReference(featureId, candidate),
    sourceType,
  }
}

function candidatesForRecord(
  record: ExternalModelGeometryRecord,
  featureId: FeatureId,
  featureLabel: string,
  used: ReadonlySet<string>,
  targetFrame: SupportFrame,
  labels: ExternalModelGeometryLabels,
) {
  const result: ExternalModelGeometryCandidate[] = []
  let pointOrdinal = 0
  let lineOrdinal = 0
  let curveOrdinal = 0
  for (const candidate of record.geometry.topologyCandidates) {
    if (used.has(candidateKey(featureId, candidate))) continue
    const point = createExternalModelPointCandidate(
      featureId,
      featureLabel,
      candidate,
      targetFrame,
      pointOrdinal + 1,
      labels,
    )
    if (point) {
      pointOrdinal += 1
      result.push(point)
      continue
    }
    const line = createExternalModelLineCandidate(
      featureId,
      featureLabel,
      candidate,
      targetFrame,
      lineOrdinal + 1,
      labels,
    )
    if (line) {
      lineOrdinal += 1
      result.push(line)
      continue
    }
    const curve = createExternalModelCurveCandidate(
      featureId,
      featureLabel,
      candidate,
      targetFrame,
      curveOrdinal + 1,
      labels,
    )
    if (!curve) continue
    curveOrdinal += 1
    result.push(curve)
  }
  return result
}

export function projectExternalModelGeometryCandidates(
  records: readonly ExternalModelGeometryRecord[],
  features: readonly FeatureRecord[],
  visibleFeatureIds: readonly FeatureId[],
  targetFrame: SupportFrame,
  labels: ExternalModelGeometryLabels,
): readonly ExternalModelGeometryCandidate[] {
  const visible = new Set(visibleFeatureIds)
  const featureLabels = new Map(features.map((feature) => [feature.id, feature.label]))
  const used = new Set<string>()
  return records.flatMap((record) => {
    const featureId = featureIdSchema.parse(record.featureId)
    if (!visible.has(featureId)) return []
    const featureLabel = featureLabels.get(featureId) ?? featureId
    return candidatesForRecord(record, featureId, featureLabel, used, targetFrame, labels)
  })
}

export function availableExternalModelGeometryCandidates(
  candidates: readonly ExternalModelGeometryCandidate[],
  records: readonly ExternalModelGeometryRecord[],
  draft: SketchRecord,
) {
  const used = referencedCandidateKeys(records, draft)
  return candidates.filter(
    (candidate) =>
      !used.has(
        candidateKey(candidate.featureId, {
          candidateId: candidate.candidateId,
          kind: candidate.kind === "model-point" ? "vertex" : "edge",
        }),
      ),
  )
}

export function externalModelGeometryCandidates(
  records: readonly ExternalModelGeometryRecord[],
  features: readonly FeatureRecord[],
  visibleFeatureIds: readonly FeatureId[],
  draft: SketchRecord,
  targetFrame: SupportFrame,
  labels: ExternalModelGeometryLabels,
): readonly ExternalModelGeometryCandidate[] {
  return availableExternalModelGeometryCandidates(
    projectExternalModelGeometryCandidates(
      records,
      features,
      visibleFeatureIds,
      targetFrame,
      labels,
    ),
    records,
    draft,
  )
}

export function applyExternalModelCandidate(
  draft: SketchRecord,
  candidate: ExternalModelGeometryCandidate,
  selectedEntityIds: readonly SketchEntityId[],
): SketchRecord {
  const references = draft.externalReferences ?? []
  if (candidate.kind === "model-curve") {
    return {
      ...draft,
      externalReferences: [
        ...references,
        {
          schemaVersion: 0,
          id: createBrowserSketchExternalReferenceId(),
          kind: "model-curve",
          reference: candidate.reference,
          sourceType: candidate.sourceType,
          projectedEntityId: createBrowserSketchEntityId(),
          projectedType: candidate.projectedType,
          projectedPointIds: Array.from(
            { length: projectedExternalCurvePointCount(candidate.projectedType) },
            () => createBrowserSketchEntityId(),
          ),
        },
      ],
    }
  }
  if (candidate.kind === "model-line") {
    return {
      ...draft,
      externalReferences: [
        ...references,
        {
          schemaVersion: 0,
          id: createBrowserSketchExternalReferenceId(),
          kind: "model-line",
          reference: candidate.reference,
          projectedLineId: createBrowserSketchEntityId(),
          projectedStartPointId: createBrowserSketchEntityId(),
          projectedEndPointId: createBrowserSketchEntityId(),
        },
      ],
    }
  }
  const projectedPointId = createBrowserSketchEntityId()
  return attachExternalProjectedPoint(
    {
      ...draft,
      externalReferences: [
        ...references,
        {
          schemaVersion: 0,
          id: createBrowserSketchExternalReferenceId(),
          kind: "model-point",
          reference: candidate.reference,
          projectedPointId,
        },
      ],
    },
    projectedPointId,
    selectedEntityIds,
  )
}
