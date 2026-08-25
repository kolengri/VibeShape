import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
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
import { featureIdSchema, resolveTopologyReference } from "@vibeshape/domain"
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

export type ExternalModelGeometryCandidate =
  | ExternalModelPointCandidate
  | ExternalModelLineCandidate

export type ExternalModelGeometryLabels = Readonly<{
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
    if (external.kind !== "model-point" && external.kind !== "model-line") continue
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

export function externalModelGeometryCandidates(
  records: readonly ExternalModelGeometryRecord[],
  features: readonly FeatureRecord[],
  visibleFeatureIds: readonly FeatureId[],
  draft: SketchRecord,
  targetFrame: SupportFrame,
  labels: ExternalModelGeometryLabels,
): readonly ExternalModelGeometryCandidate[] {
  const visible = new Set(visibleFeatureIds)
  const featureLabels = new Map(features.map((feature) => [feature.id, feature.label]))
  const used = referencedCandidateKeys(records, draft)
  const result: ExternalModelGeometryCandidate[] = []

  for (const record of records) {
    const featureId = featureIdSchema.parse(record.featureId)
    if (!visible.has(featureId)) continue
    const featureLabel = featureLabels.get(featureId) ?? featureId
    let pointOrdinal = 0
    let lineOrdinal = 0
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
      }
    }
  }
  return result
}

export function applyExternalModelCandidate(
  draft: SketchRecord,
  candidate: ExternalModelGeometryCandidate,
  selectedEntityIds: readonly SketchEntityId[],
): SketchRecord {
  const references = draft.externalReferences ?? []
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
