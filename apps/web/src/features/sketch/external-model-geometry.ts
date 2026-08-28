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
  PlanarFaceTopoRef,
  SketchEntityId,
  SketchExternalReferenceId,
  SketchRecord,
  VertexTopoRef,
} from "@vibeshape/domain"
import {
  createTopologyReferenceResolver,
  featureIdSchema,
  isOrphanedModelReference,
  isSketchExternalModelReference,
  projectedExternalCurvePointCount,
  replaceSketchExternalReference,
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

export type ExternalModelReferenceLabels = ExternalModelGeometryLabels &
  Readonly<{
    face: (featureLabel: string, ordinal: number) => string
    problem: (
      featureLabel: string,
      kind: "edge" | "face" | "vertex",
      status: "ambiguous" | "missing",
    ) => string
    unknownFeature: string
  }>

type ExternalModelGeometryRecord = Readonly<{
  featureId: string
  geometry: FeatureGeometryRecord["geometry"]
}>

type ExternalModelReferenceContext = Readonly<{
  candidatesByKey: ReadonlyMap<string, ProtocolTopologyCandidate>
  ordinals: ReadonlyMap<string, number>
  resolve: ReturnType<typeof createTopologyReferenceResolver>
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

type CandidateDisplayKind = "curve" | "face" | "line" | "point"

function edgeDisplayKind(candidate: ProtocolTopologyCandidate): CandidateDisplayKind | null {
  if (candidate.signature.geometryClass === "LINE") {
    return candidate.referenceGeometry?.kind === "line-edge" ? "line" : null
  }
  if (candidate.signature.geometryClass !== "CIRCLE") return null
  return candidate.referenceGeometry?.kind === "circle-edge" ||
    candidate.referenceGeometry?.kind === "arc-edge"
    ? "curve"
    : null
}

function candidateDisplayKind(candidate: ProtocolTopologyCandidate): CandidateDisplayKind | null {
  if (candidate.kind === "face") return "face"
  if (candidate.kind === "edge") return edgeDisplayKind(candidate)
  return candidate.signature.geometryClass === "POINT" &&
    candidate.referenceGeometry?.kind === "vertex"
    ? "point"
    : null
}

function topologyCandidateKey(candidate: Pick<ProtocolTopologyCandidate, "candidateId" | "kind">) {
  return `${candidate.kind}:${candidate.candidateId}`
}

function candidateDisplayOrdinals(candidates: readonly ProtocolTopologyCandidate[]) {
  const counts: Record<CandidateDisplayKind, number> = { curve: 0, face: 0, line: 0, point: 0 }
  const ordinals = new Map<string, number>()
  const displayCandidates = candidates
    .flatMap((candidate) => {
      const kind = candidateDisplayKind(candidate)
      return kind ? [{ candidate, kind, presentationKey: topologyPresentationKey(candidate) }] : []
    })
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.presentationKey.localeCompare(right.presentationKey),
    )
  for (const { candidate, kind } of displayCandidates) {
    counts[kind] += 1
    ordinals.set(topologyCandidateKey(candidate), counts[kind])
  }
  return ordinals
}

function topologyPresentationKey(candidate: ProtocolTopologyCandidate) {
  const identity = candidate.semanticRole
    ? ["semantic", candidate.semanticRole]
    : candidate.lineageTokens.length > 0
      ? ["lineage", ...[...candidate.lineageTokens].sort()]
      : ["signature"]
  const signature = candidate.signature
  return JSON.stringify([
    ...identity,
    signature.geometryClass,
    signature.centroid,
    signature.bounds.min,
    signature.bounds.max,
    signature.measure,
    signature.direction ?? null,
    signature.directionMode ?? null,
    signature.boundaryCount,
    [...signature.adjacentGeometryClasses].sort(),
    candidate.candidateId,
  ])
}

function referenceContexts(records: readonly ExternalModelGeometryRecord[]) {
  return new Map<string, ExternalModelReferenceContext>(
    records.map((record) => [
      record.featureId,
      {
        candidatesByKey: new Map(
          record.geometry.topologyCandidates.map((candidate) => [
            topologyCandidateKey(candidate),
            candidate,
          ]),
        ),
        ordinals: candidateDisplayOrdinals(record.geometry.topologyCandidates),
        resolve: createTopologyReferenceResolver(
          record.geometry.topologyCandidates.map(domainTopologyCandidate),
        ),
      },
    ]),
  )
}

function referencedCandidateKeys(
  records: readonly ExternalModelGeometryRecord[],
  draft: SketchRecord,
) {
  const recordsByFeatureId = new Map(
    records.map((record) => [
      record.featureId,
      {
        resolve: createTopologyReferenceResolver(
          record.geometry.topologyCandidates.map(domainTopologyCandidate),
        ),
      },
    ]),
  )
  const keys = new Set<string>()
  for (const external of draft.externalReferences ?? []) {
    if (
      external.kind !== "model-point" &&
      external.kind !== "model-line" &&
      external.kind !== "model-curve"
    ) {
      continue
    }
    const context = recordsByFeatureId.get(external.reference.featureId)
    if (!context) continue
    const resolution = context.resolve(external.reference)
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
  const ordinals = candidateDisplayOrdinals(record.geometry.topologyCandidates)
  for (const candidate of record.geometry.topologyCandidates) {
    if (used.has(candidateKey(featureId, candidate))) continue
    const ordinal = ordinals.get(topologyCandidateKey(candidate))
    if (!ordinal) continue
    const point = createExternalModelPointCandidate(
      featureId,
      featureLabel,
      candidate,
      targetFrame,
      ordinal,
      labels,
    )
    if (point) {
      result.push(point)
      continue
    }
    const line = createExternalModelLineCandidate(
      featureId,
      featureLabel,
      candidate,
      targetFrame,
      ordinal,
      labels,
    )
    if (line) {
      result.push(line)
      continue
    }
    const curve = createExternalModelCurveCandidate(
      featureId,
      featureLabel,
      candidate,
      targetFrame,
      ordinal,
      labels,
    )
    if (!curve) continue
    result.push(curve)
  }
  return result
}

function resolvedModelReferenceLabel(
  candidate: ProtocolTopologyCandidate,
  featureLabel: string,
  ordinal: number,
  labels: ExternalModelReferenceLabels,
) {
  const displayKind = candidateDisplayKind(candidate)
  if (displayKind === "point") return labels.point(featureLabel, ordinal)
  if (displayKind === "line") return labels.line(featureLabel, ordinal)
  if (displayKind === "face") return labels.face(featureLabel, ordinal)
  if (displayKind !== "curve") return null
  return labels.curve(
    featureLabel,
    candidate.referenceGeometry?.kind === "arc-edge" ? "arc" : "circle",
    ordinal,
  )
}

export function externalModelReferenceLabels(
  records: readonly ExternalModelGeometryRecord[],
  features: readonly FeatureRecord[],
  externalReferences: SketchRecord["externalReferences"],
  labels: ExternalModelReferenceLabels,
): ReadonlyMap<string, string> {
  const recordsByFeatureId = referenceContexts(records)
  const featureLabels = new Map(features.map((feature) => [feature.id, feature.label]))
  const result = new Map<string, string>()
  for (const external of externalReferences ?? []) {
    if (!isSketchExternalModelReference(external)) continue
    const featureLabel = featureLabels.get(external.reference.featureId) ?? labels.unknownFeature
    const context = recordsByFeatureId.get(external.reference.featureId)
    if (!context) {
      result.set(external.id, labels.problem(featureLabel, external.reference.kind, "missing"))
      continue
    }
    const resolution = context.resolve(external.reference)
    if (resolution.status !== "resolved") {
      result.set(
        external.id,
        labels.problem(featureLabel, external.reference.kind, resolution.status),
      )
      continue
    }
    const candidate = context.candidatesByKey.get(
      topologyCandidateKey({
        candidateId: resolution.candidateId,
        kind: external.reference.kind,
      }),
    )
    const ordinal = candidate ? context.ordinals.get(topologyCandidateKey(candidate)) : undefined
    const label =
      candidate && ordinal
        ? resolvedModelReferenceLabel(candidate, featureLabel, ordinal, labels)
        : null
    result.set(
      external.id,
      label ?? labels.problem(featureLabel, external.reference.kind, "missing"),
    )
  }
  return result
}

export function resolvePlanarFaceSupportLabel(
  records: readonly ExternalModelGeometryRecord[],
  features: readonly FeatureRecord[],
  reference: PlanarFaceTopoRef,
  labels: Pick<ExternalModelReferenceLabels, "face">,
): string | null {
  const context = referenceContexts(records).get(reference.featureId)
  if (!context) return null
  const resolution = context.resolve(reference)
  if (resolution.status !== "resolved") return null
  const candidate = context.candidatesByKey.get(
    topologyCandidateKey({ candidateId: resolution.candidateId, kind: reference.kind }),
  )
  const ordinal = candidate ? context.ordinals.get(topologyCandidateKey(candidate)) : undefined
  if (!candidate || candidateDisplayKind(candidate) !== "face" || !ordinal) return null
  const feature = features.find(({ id }) => id === reference.featureId)
  return feature?.label ? labels.face(feature.label, ordinal) : null
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

export function repairExternalModelGeometryCandidates(
  candidates: readonly ExternalModelGeometryCandidate[],
  draft: SketchRecord,
  referenceId: SketchExternalReferenceId | null,
) {
  if (!referenceId) return candidates
  const reference = draft.externalReferences?.find(({ id }) => id === referenceId)
  if (!reference || !isSketchExternalModelReference(reference)) return []
  return candidates.filter((candidate) => {
    if (
      !isOrphanedModelReference(reference) &&
      candidate.featureId !== reference.reference.featureId
    ) {
      return false
    }
    if (reference.kind === "model-point") return candidate.kind === "model-point"
    if (reference.kind === "model-line") return candidate.kind === "model-line"
    if (reference.kind !== "model-curve" || candidate.kind !== "model-curve") return false
    return (
      candidate.sourceType === reference.sourceType &&
      candidate.projectedType === reference.projectedType
    )
  })
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

export function applyExternalModelCandidateSelection(
  draft: SketchRecord,
  candidate: ExternalModelGeometryCandidate,
  selectedEntityIds: readonly SketchEntityId[],
  repairReferenceId: SketchExternalReferenceId | null,
) {
  return repairReferenceId
    ? replaceSketchExternalReference(draft, repairReferenceId, candidate)
    : applyExternalModelCandidate(draft, candidate, selectedEntityIds)
}

export function applyExternalModelIntersection(
  draft: SketchRecord,
  reference: PlanarFaceTopoRef,
): SketchRecord {
  return {
    ...draft,
    externalReferences: [
      ...(draft.externalReferences ?? []),
      {
        schemaVersion: 0,
        id: createBrowserSketchExternalReferenceId(),
        kind: "model-intersection",
        reference,
        projectedLineId: createBrowserSketchEntityId(),
        projectedStartPointId: createBrowserSketchEntityId(),
        projectedEndPointId: createBrowserSketchEntityId(),
      },
    ],
  }
}

export function planarFaceCanIntersectSketch(
  reference: PlanarFaceTopoRef,
  targetFrame: SupportFrame,
) {
  const faceNormal = reference.signature.direction
  if (!faceNormal) return false
  const alignment = Math.abs(
    faceNormal[0] * targetFrame.normal[0] +
      faceNormal[1] * targetFrame.normal[1] +
      faceNormal[2] * targetFrame.normal[2],
  )
  return alignment < 1 - 1e-6
}
