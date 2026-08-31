import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import { intersectBoundedLineWithSupportPlane } from "@vibeshape/application/pierce-point"
import {
  type ProjectedSketchCurve,
  projectWorldCircularEdgeToSupport,
  projectWorldEllipticalEdgeToSupport,
  sampleWorldCircularEdge,
  sampleWorldEllipticalEdge,
  type WorldCircularEdgeGeometry,
  type WorldEllipticalEdgeGeometry,
} from "@vibeshape/application/sketch-curve-projection"
import {
  projectWorldPointToSupport,
  type SupportFrame,
  supportPointToWorld,
} from "@vibeshape/application/support-frame"
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
  coplanar?: boolean
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
  coplanar?: boolean
  projectable?: boolean
  piercePoint?: ProjectedModelPoint
}>

export type ExternalModelCurveCandidate = Readonly<{
  candidateId: string
  coplanar?: boolean
  featureId: FeatureId
  kind: "model-curve"
  label: string
  passiveEligible?: boolean
  points: readonly ProjectedModelPoint[]
  projectedGeometry?: ProjectedSketchCurve
  projectedType: "circle" | "arc" | "ellipse" | "elliptical-arc"
  reference: EdgeTopoRef
  sourceType: ExternalModelCurveSourceType
}>

export type ExternalModelCurveSourceType = "arc" | "circle" | "ellipse" | "elliptical-arc"

export type ExternalModelGeometryCandidate =
  | ExternalModelPointCandidate
  | ExternalModelLineCandidate
  | ExternalModelCurveCandidate

export type ExternalModelGeometryLabels = Readonly<{
  curve: (featureLabel: string, kind: ExternalModelCurveSourceType, ordinal: number) => string
  line: (featureLabel: string, ordinal: number) => string
  point: (featureLabel: string, ordinal: number) => string
}>

export function externalModelCurveLabelKind(kind: ExternalModelCurveSourceType) {
  return kind === "elliptical-arc" ? "ellipticalArc" : kind
}

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

export type ExternalModelGeometryRecord = Readonly<{
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
type ProtocolReferenceGeometry = NonNullable<ProtocolTopologyCandidate["referenceGeometry"]>

const EDGE_DISPLAY_BY_REFERENCE_KIND = {
  vertex: null,
  "line-edge": { displayKind: "line", geometryClass: "LINE" },
  "circle-edge": { displayKind: "curve", geometryClass: "CIRCLE" },
  "arc-edge": { displayKind: "curve", geometryClass: "CIRCLE" },
  "ellipse-edge": { displayKind: "curve", geometryClass: "ELLIPSE" },
  "elliptical-arc-edge": { displayKind: "curve", geometryClass: "ELLIPSE" },
} as const satisfies Record<
  ProtocolReferenceGeometry["kind"],
  Readonly<{ displayKind: CandidateDisplayKind; geometryClass: string }> | null
>

function edgeDisplayKind(candidate: ProtocolTopologyCandidate): CandidateDisplayKind | null {
  const geometry = candidate.referenceGeometry
  if (candidate.kind !== "edge" || !geometry) return null
  const display = EDGE_DISPLAY_BY_REFERENCE_KIND[geometry.kind]
  return display && candidate.signature.geometryClass === display.geometryClass
    ? display.displayKind
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
    coplanar: pointIsOnSupport(targetFrame, candidate.referenceGeometry.position),
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
  const projectable =
    Math.hypot(projectedEnd.x - projectedStart.x, projectedEnd.y - projectedStart.y) > 1e-9
  return {
    candidateId: candidate.candidateId,
    end: { ...projectedEnd, world: candidate.referenceGeometry.end },
    featureId,
    kind: "model-line",
    label: labels.line(featureLabel, ordinal),
    reference: stableEdgeReference(featureId, candidate),
    start: { ...projectedStart, world: candidate.referenceGeometry.start },
    projectable,
    coplanar:
      pointIsOnSupport(targetFrame, candidate.referenceGeometry.start) &&
      pointIsOnSupport(targetFrame, candidate.referenceGeometry.end),
  }
}

function pointIsOnSupport(frame: SupportFrame, point: readonly [number, number, number]) {
  const relative = [
    point[0] - frame.origin[0],
    point[1] - frame.origin[1],
    point[2] - frame.origin[2],
  ] as const
  return (
    Math.abs(
      relative[0] * frame.normal[0] + relative[1] * frame.normal[1] + relative[2] * frame.normal[2],
    ) <= 1e-6
  )
}

type WorldModelCurveGeometry = WorldCircularEdgeGeometry | WorldEllipticalEdgeGeometry

function modelCurveGeometry(candidate: ProtocolTopologyCandidate): WorldModelCurveGeometry | null {
  if (candidate.kind !== "edge") return null
  const geometry = candidate.referenceGeometry
  if (!geometry) return null
  if (geometry.kind === "circle-edge" || geometry.kind === "arc-edge") {
    return candidate.signature.geometryClass === "CIRCLE" ? geometry : null
  }
  if (geometry.kind === "ellipse-edge" || geometry.kind === "elliptical-arc-edge") {
    return candidate.signature.geometryClass === "ELLIPSE" ? geometry : null
  }
  return null
}

function modelCurveIsCoplanar(frame: SupportFrame, geometry: WorldModelCurveGeometry) {
  const normalAlignment = Math.abs(
    geometry.normal[0] * frame.normal[0] +
      geometry.normal[1] * frame.normal[1] +
      geometry.normal[2] * frame.normal[2],
  )
  if (Math.abs(normalAlignment - 1) > 1e-6 || !pointIsOnSupport(frame, geometry.center)) {
    return false
  }
  if (geometry.kind === "circle-edge" || geometry.kind === "ellipse-edge") return true
  return [geometry.start, geometry.middle, geometry.end].every((point) =>
    pointIsOnSupport(frame, point),
  )
}

function modelCurveSourceType(geometry: WorldModelCurveGeometry): ExternalModelCurveSourceType {
  if (geometry.kind === "circle-edge") return "circle"
  if (geometry.kind === "arc-edge") return "arc"
  if (geometry.kind === "ellipse-edge") return "ellipse"
  return "elliptical-arc"
}

function createExternalModelCurveCandidate(
  featureId: FeatureId,
  featureLabel: string,
  candidate: ProtocolTopologyCandidate,
  targetFrame: SupportFrame,
  ordinal: number,
  labels: ExternalModelGeometryLabels,
): ExternalModelCurveCandidate | null {
  const geometry = modelCurveGeometry(candidate)
  if (!geometry) return null
  const circular = geometry.kind === "circle-edge" || geometry.kind === "arc-edge"
  const projection = circular
    ? projectWorldCircularEdgeToSupport(geometry, targetFrame)
    : projectWorldEllipticalEdgeToSupport(geometry, targetFrame)
  if (!projection) return null
  const sourceType = modelCurveSourceType(geometry)
  const worldPoints = circular
    ? sampleWorldCircularEdge(geometry)
    : sampleWorldEllipticalEdge(geometry)
  const points = worldPoints.map((world) => ({
    world,
    ...projectWorldPointToSupport(targetFrame, world),
  }))
  return {
    candidateId: candidate.candidateId,
    coplanar: modelCurveIsCoplanar(targetFrame, geometry),
    featureId,
    kind: "model-curve",
    label: labels.curve(featureLabel, sourceType, ordinal),
    points,
    projectedGeometry: projection,
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
  const resolve = createTopologyReferenceResolver(
    record.geometry.topologyCandidates.map(domainTopologyCandidate),
  )
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
    const resolution = resolve(curve.reference)
    result.push({
      ...curve,
      passiveEligible:
        resolution.status === "resolved" && resolution.candidateId === candidate.candidateId,
    })
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
  const geometry = modelCurveGeometry(candidate)
  return geometry ? labels.curve(featureLabel, modelCurveSourceType(geometry), ordinal) : null
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

export function resolveModelFaceSelectionOrdinal(
  records: readonly ExternalModelGeometryRecord[],
  featureId: string,
  meshFaceId: number,
): number | null {
  const candidates = records.find((record) => record.featureId === featureId)?.geometry
    .topologyCandidates
  if (!candidates) return null
  const candidate = candidates.find(
    (item) => item.kind === "face" && item.meshFaceId === meshFaceId,
  )
  if (!candidate || candidateDisplayKind(candidate) !== "face") return null
  return candidateDisplayOrdinals(candidates).get(topologyCandidateKey(candidate)) ?? null
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

export function externalModelPierceCandidates(
  candidates: readonly ExternalModelGeometryCandidate[],
  targetFrame: SupportFrame,
): readonly ExternalModelLineCandidate[] {
  return candidates.flatMap((candidate) => {
    if (candidate.kind !== "model-line") return []
    const point = intersectBoundedLineWithSupportPlane(
      candidate.start.world,
      candidate.end.world,
      targetFrame,
    )
    return point
      ? [
          {
            ...candidate,
            piercePoint: { world: supportPointToWorld(targetFrame, point), ...point },
          },
        ]
      : []
  })
}

export function availableExternalModelPierceCandidates(
  candidates: readonly ExternalModelGeometryCandidate[],
  draft: SketchRecord,
  referenceId: SketchExternalReferenceId | null,
  targetFrame: SupportFrame,
): readonly ExternalModelLineCandidate[] {
  if (!referenceId) return externalModelPierceCandidates(candidates, targetFrame)
  const reference = draft.externalReferences?.find(({ id }) => id === referenceId)
  if (reference?.kind !== "model-pierce-point") return []
  return externalModelPierceCandidates(
    repairExternalModelGeometryCandidates(candidates, draft, referenceId),
    targetFrame,
  )
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
    if (reference.kind === "model-line" || reference.kind === "model-pierce-point")
      return candidate.kind === "model-line"
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
  if (candidate.kind === "model-line" && candidate.projectable === false) return draft
  const materialized = materializeExternalModelCandidate(draft, candidate)
  if (candidate.kind === "model-point") {
    if (materialized.kind !== "model-point") return materialized.sketch
    return attachExternalProjectedPoint(
      materialized.sketch,
      materialized.projectedPointId,
      selectedEntityIds,
    )
  }
  return materialized.sketch
}

export function applyExternalModelPierceCandidate(
  draft: SketchRecord,
  candidate: ExternalModelLineCandidate,
  selectedEntityIds: readonly SketchEntityId[],
  records: readonly ExternalModelGeometryRecord[],
): SketchRecord {
  if (
    selectedEntityIds.length !== 1 ||
    draft.entities.find(({ id }) => id === selectedEntityIds[0])?.type !== "point"
  )
    return draft
  const existing = (draft.externalReferences ?? []).find(
    (reference) =>
      reference.kind === "model-pierce-point" &&
      modelTopologyReferenceResolvesToCandidate(records, reference, candidate),
  )
  const projectedPointId =
    existing?.kind === "model-pierce-point"
      ? existing.projectedPointId
      : createBrowserSketchEntityId()
  const next = existing
    ? draft
    : {
        ...draft,
        externalReferences: [
          ...(draft.externalReferences ?? []),
          {
            schemaVersion: 0 as const,
            id: createBrowserSketchExternalReferenceId(),
            kind: "model-pierce-point" as const,
            reference: candidate.reference,
            projectedPointId,
          },
        ],
      }
  return attachExternalProjectedPoint(next, projectedPointId, selectedEntityIds)
}

function modelTopologyReferenceResolvesToCandidate(
  records: readonly ExternalModelGeometryRecord[],
  reference: NonNullable<SketchRecord["externalReferences"]>[number],
  candidate: ExternalModelGeometryCandidate,
) {
  if (!("reference" in reference)) return false
  if (reference.reference.featureId !== candidate.featureId) return false
  const record = records.find(({ featureId }) => featureId === candidate.featureId)
  if (!record) return false
  const resolve = createTopologyReferenceResolver(
    record.geometry.topologyCandidates.map(domainTopologyCandidate),
  )
  const resolution = resolve(reference.reference)
  return resolution.status === "resolved" && resolution.candidateId === candidate.candidateId
}

export type MaterializedExternalModelCandidate =
  | Readonly<{ kind: "model-point"; projectedPointId: SketchEntityId; sketch: SketchRecord }>
  | Readonly<{
      kind: "model-line"
      projectedEndPointId: SketchEntityId
      projectedLineId: SketchEntityId
      projectedStartPointId: SketchEntityId
      sketch: SketchRecord
    }>
  | Readonly<{
      kind: "model-curve"
      projectedEntityId: SketchEntityId
      projectedPointIds: readonly SketchEntityId[]
      sketch: SketchRecord
    }>

function modelTopologyReferenceMatchesCandidate(
  reference: NonNullable<SketchRecord["externalReferences"]>[number],
  candidate: ExternalModelGeometryCandidate,
) {
  return (
    "reference" in reference &&
    reference.reference.featureId === candidate.reference.featureId &&
    reference.reference.kind === candidate.reference.kind &&
    (candidate.reference.semanticRole
      ? reference.reference.semanticRole === candidate.reference.semanticRole
      : candidate.reference.lineageToken
        ? reference.reference.lineageToken === candidate.reference.lineageToken
        : false)
  )
}

function externalModelReferenceMatchesCandidate(
  reference: NonNullable<SketchRecord["externalReferences"]>[number],
  candidate: ExternalModelGeometryCandidate,
) {
  return (
    reference.kind === candidate.kind &&
    modelTopologyReferenceMatchesCandidate(reference, candidate)
  )
}

export function sketchReferencesExternalModelCandidate(
  draft: SketchRecord,
  candidate: ExternalModelGeometryCandidate,
): boolean {
  return (draft.externalReferences ?? []).some(
    (reference) =>
      isSketchExternalModelReference(reference) &&
      externalModelReferenceMatchesCandidate(reference, candidate),
  )
}

function existingModelMaterialization(
  draft: SketchRecord,
  candidate: ExternalModelGeometryCandidate,
): MaterializedExternalModelCandidate | null {
  const existing = (draft.externalReferences ?? []).find(
    (reference) =>
      isSketchExternalModelReference(reference) &&
      externalModelReferenceMatchesCandidate(reference, candidate),
  )
  if (!existing || !isSketchExternalModelReference(existing)) return null
  if (existing.kind === "model-point") {
    return { kind: "model-point", projectedPointId: existing.projectedPointId, sketch: draft }
  }
  if (existing.kind === "model-line") {
    return {
      kind: "model-line",
      projectedEndPointId: existing.projectedEndPointId,
      projectedLineId: existing.projectedLineId,
      projectedStartPointId: existing.projectedStartPointId,
      sketch: draft,
    }
  }
  if (existing.kind !== "model-curve") return null
  return {
    kind: "model-curve",
    projectedEntityId: existing.projectedEntityId,
    projectedPointIds: existing.projectedPointIds,
    sketch: draft,
  }
}

export function materializeExternalModelCandidate(
  draft: SketchRecord,
  candidate: ExternalModelGeometryCandidate,
): MaterializedExternalModelCandidate {
  const existing = existingModelMaterialization(draft, candidate)
  if (existing) return existing
  const references = draft.externalReferences ?? []
  if (candidate.kind === "model-curve") {
    const projectedEntityId = createBrowserSketchEntityId()
    const projectedPointIds = Array.from(
      { length: projectedExternalCurvePointCount(candidate.projectedType) },
      () => createBrowserSketchEntityId(),
    )
    return {
      kind: "model-curve",
      projectedEntityId,
      projectedPointIds,
      sketch: {
        ...draft,
        externalReferences: [
          ...references,
          {
            schemaVersion: 0,
            id: createBrowserSketchExternalReferenceId(),
            kind: "model-curve",
            reference: candidate.reference,
            sourceType: candidate.sourceType,
            projectedEntityId,
            projectedType: candidate.projectedType,
            projectedPointIds,
          },
        ],
      },
    }
  }
  if (candidate.kind === "model-line") {
    const projectedLineId = createBrowserSketchEntityId()
    const projectedStartPointId = createBrowserSketchEntityId()
    const projectedEndPointId = createBrowserSketchEntityId()
    return {
      kind: "model-line",
      projectedLineId,
      projectedStartPointId,
      projectedEndPointId,
      sketch: {
        ...draft,
        externalReferences: [
          ...references,
          {
            schemaVersion: 0,
            id: createBrowserSketchExternalReferenceId(),
            kind: "model-line",
            reference: candidate.reference,
            projectedLineId,
            projectedStartPointId,
            projectedEndPointId,
          },
        ],
      },
    }
  }
  const projectedPointId = createBrowserSketchEntityId()
  return {
    kind: "model-point",
    projectedPointId,
    sketch: {
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
  }
}

export function applyExternalModelCandidateSelection(
  draft: SketchRecord,
  candidate: ExternalModelGeometryCandidate,
  selectedEntityIds: readonly SketchEntityId[],
  repairReferenceId: SketchExternalReferenceId | null,
) {
  if (repairReferenceId) {
    const reference = draft.externalReferences?.find(({ id }) => id === repairReferenceId)
    if (reference?.kind === "model-pierce-point" && candidate.kind === "model-line") {
      return replaceSketchExternalReference(draft, repairReferenceId, {
        kind: "model-pierce-point",
        reference: candidate.reference,
      })
    }
  }
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
