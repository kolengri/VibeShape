import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import { intersectBoundedLineWithSupportPlane } from "@vibeshape/application/pierce-point"
import {
  projectSketchCurveBetweenFrames,
  projectWorldCircularEdgeToSupport,
  projectWorldEllipticalEdgeToSupport,
} from "@vibeshape/application/sketch-curve-projection"
import {
  projectSketchPointBetweenFrames,
  projectWorldPointToSupport,
  type SupportFrame,
  sketchFrame,
  supportPointToWorld,
} from "@vibeshape/application/support-frame"
import type {
  DocumentSnapshot,
  FeatureRecord,
  SketchEntity,
  SketchExternalCurveReference,
  SketchExternalLineReference,
  SketchExternalModelCurveReference,
  SketchExternalModelIntersectionReference,
  SketchExternalModelLineReference,
  SketchExternalModelPiercePointReference,
  SketchExternalModelPointReference,
  SketchExternalModelReference,
  SketchExternalPiercePointReference,
  SketchExternalPointReference,
  SketchPoint2,
  SketchRecord,
  TopologyCandidate,
} from "@vibeshape/domain"
import {
  isOrphanedModelReference,
  isSketchExternalModelReference,
  resolveTopologyReference,
} from "@vibeshape/domain"
import type {
  PlanarFaceSectionInput,
  PlanarFaceSectionResult,
} from "@vibeshape/geometry-worker/engine"
import type { TopologyCandidate as ProtocolTopologyCandidate } from "@vibeshape/protocol"
import type { SketchCompilationInput, SolveSketchRecordResult } from "@vibeshape/sketch-solver"

export type SketchSolvePort = (
  input: SketchCompilationInput,
) => SolveSketchRecordResult | Promise<SolveSketchRecordResult>

export type SketchSolveCache = Map<string, Promise<SolveSketchRecordResult>>

export type FeatureGeometryLookup =
  | ReadonlyMap<string, FeatureGeometryRecord>
  | readonly FeatureGeometryRecord[]

export type PlanarFaceSectionPort = (
  input: PlanarFaceSectionInput,
) => PlanarFaceSectionResult | Promise<PlanarFaceSectionResult>

export type ResolvedExternalSketchGeometry = Readonly<
  Pick<SketchCompilationInput, "externalCurves" | "externalLines" | "externalPoints">
>

type ExternalSketchGeometryCache = Map<string, Promise<ResolvedExternalSketchGeometry>>

function externalGeometryPoints(geometry: ResolvedExternalSketchGeometry | undefined) {
  return [
    ...(geometry?.externalPoints ?? []),
    ...(geometry?.externalLines?.flatMap(({ startPoint, endPoint }) => [startPoint, endPoint]) ??
      []),
    ...(geometry?.externalCurves?.flatMap(({ points }) => points) ?? []),
  ]
}

function externalPointResult(
  geometry: ResolvedExternalSketchGeometry | undefined,
  pointId: string,
) {
  const point = externalGeometryPoints(geometry).find(({ id }) => id === pointId)
  return point ? { x: point.x, y: point.y } : null
}

function sourcePointResult(
  source: SketchRecord,
  result: SolveSketchRecordResult,
  sourcePointId: string,
  externalGeometry?: ResolvedExternalSketchGeometry,
) {
  const solved = result.ok
    ? result.solution.points.find((point) => point.entityId === sourcePointId)
    : null
  if (solved) return { x: solved.x, y: solved.y }
  const authored = source.entities.find((entity) => entity.id === sourcePointId)
  if (authored?.type === "point") return { x: authored.x, y: authored.y }
  return externalPointResult(externalGeometry, sourcePointId)
}

function solvedSourcePointResult(
  result: Extract<SolveSketchRecordResult, { ok: true }>,
  sourcePointId: string,
  externalGeometry?: ResolvedExternalSketchGeometry,
) {
  const solved = result.solution.points.find((point) => point.entityId === sourcePointId)
  return solved
    ? { x: solved.x, y: solved.y }
    : externalPointResult(externalGeometry, sourcePointId)
}

function resolveExternalPoint(
  reference: SketchExternalPointReference,
  source: SketchRecord,
  result: SolveSketchRecordResult,
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
  externalGeometry?: ResolvedExternalSketchGeometry,
): NonNullable<SketchCompilationInput["externalPoints"]>[number] {
  const point = sourcePointResult(source, result, reference.sourcePointId, externalGeometry)
  if (!point) throw new Error(`External source point ${reference.sourcePointId} is unavailable.`)
  const projected = projectSketchPointBetweenFrames(sourceFrame, targetFrame, point).local
  return {
    schemaVersion: 0,
    id: reference.projectedPointId,
    type: "point",
    construction: true,
    ...projected,
  }
}

function resolveExternalLine(
  reference: SketchExternalLineReference,
  source: SketchRecord,
  result: SolveSketchRecordResult,
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
  externalGeometry?: ResolvedExternalSketchGeometry,
): NonNullable<SketchCompilationInput["externalLines"]>[number] {
  const sourceLine =
    source.entities.find(({ id }) => id === reference.sourceLineId) ??
    externalGeometry?.externalLines?.find(({ line }) => line.id === reference.sourceLineId)?.line
  if (sourceLine?.type !== "line") {
    throw new Error(`External source line ${reference.sourceLineId} is unavailable.`)
  }
  const sourceStart = sourcePointResult(source, result, sourceLine.startPointId, externalGeometry)
  const sourceEnd = sourcePointResult(source, result, sourceLine.endPointId, externalGeometry)
  if (!sourceStart || !sourceEnd) {
    throw new Error(`External source line ${reference.sourceLineId} has unavailable endpoints.`)
  }
  const start = projectSketchPointBetweenFrames(sourceFrame, targetFrame, sourceStart).local
  const end = projectSketchPointBetweenFrames(sourceFrame, targetFrame, sourceEnd).local
  if (Math.hypot(end.x - start.x, end.y - start.y) <= 1e-9) {
    throw new Error(`External source line ${reference.sourceLineId} has a degenerate projection.`)
  }
  return {
    startPoint: {
      schemaVersion: 0,
      id: reference.projectedStartPointId,
      type: "point",
      construction: true,
      ...start,
    },
    endPoint: {
      schemaVersion: 0,
      id: reference.projectedEndPointId,
      type: "point",
      construction: true,
      ...end,
    },
    line: {
      schemaVersion: 0,
      id: reference.projectedLineId,
      type: "line",
      construction: true,
      startPointId: reference.projectedStartPointId,
      endPointId: reference.projectedEndPointId,
    },
  }
}

function resolveExternalPiercePoint(
  reference: SketchExternalPiercePointReference,
  source: SketchRecord,
  result: SolveSketchRecordResult,
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
  externalGeometry?: ResolvedExternalSketchGeometry,
): NonNullable<SketchCompilationInput["externalPoints"]>[number] {
  if (!result.ok) throw new Error(`External Pierce source sketch ${source.id} could not be solved.`)
  const sourceLine =
    source.entities.find(({ id }) => id === reference.sourceLineId) ??
    externalGeometry?.externalLines?.find(({ line }) => line.id === reference.sourceLineId)?.line
  if (sourceLine?.type !== "line")
    throw new Error(`External source line ${reference.sourceLineId} is unavailable.`)
  const start = solvedSourcePointResult(result, sourceLine.startPointId, externalGeometry)
  const end = solvedSourcePointResult(result, sourceLine.endPointId, externalGeometry)
  if (!start || !end)
    throw new Error(`External source line ${reference.sourceLineId} has unavailable endpoints.`)
  const point = intersectBoundedLineWithSupportPlane(
    supportPointToWorld(sourceFrame, start),
    supportPointToWorld(sourceFrame, end),
    targetFrame,
  )
  if (!point)
    throw new Error(
      `External source line ${reference.sourceLineId} does not pierce the target support.`,
    )
  return {
    schemaVersion: 0,
    id: reference.projectedPointId,
    type: "point",
    construction: true,
    ...point,
  }
}

function sourcePointMap(
  source: SketchRecord,
  result: SolveSketchRecordResult,
  externalGeometry?: ResolvedExternalSketchGeometry,
) {
  return new Map([
    ...(result.ok
      ? result.solution.points.map((point) => [point.entityId, { x: point.x, y: point.y }] as const)
      : []),
    ...source.entities.flatMap((entity) => {
      if (entity.type !== "point") return []
      const point = sourcePointResult(source, result, entity.id, externalGeometry)
      return point ? ([[entity.id, point]] as const) : []
    }),
    ...(externalGeometry?.externalPoints?.map(
      (point) => [point.id, { x: point.x, y: point.y }] as const,
    ) ?? []),
    ...(externalGeometry?.externalLines?.flatMap(({ startPoint, endPoint }) => [
      [startPoint.id, { x: startPoint.x, y: startPoint.y }] as const,
      [endPoint.id, { x: endPoint.x, y: endPoint.y }] as const,
    ]) ?? []),
    ...(externalGeometry?.externalCurves?.flatMap(({ points }) =>
      points.map((point) => [point.id, { x: point.x, y: point.y }] as const),
    ) ?? []),
  ])
}

function projectedPointEntity(id: string, point: SketchPoint2) {
  return { schemaVersion: 0 as const, id, type: "point" as const, construction: true, ...point }
}

function geometryRecord(
  lookup: FeatureGeometryLookup | undefined,
  featureId: string,
): FeatureGeometryRecord | undefined {
  if (!lookup) return undefined
  if ("get" in lookup) return lookup.get(featureId)
  return lookup.find((record) => record.featureId === featureId)
}

function domainTopologyCandidate(candidate: ProtocolTopologyCandidate): TopologyCandidate {
  const { referenceGeometry: _referenceGeometry, ...domainCandidate } = candidate
  return domainCandidate
}

function resolvedModelCandidateWithRecord(
  reference:
    | SketchExternalModelPointReference
    | SketchExternalModelLineReference
    | SketchExternalModelPiercePointReference
    | SketchExternalModelCurveReference
    | SketchExternalModelIntersectionReference,
  lookup: FeatureGeometryLookup | undefined,
): Readonly<{ candidate: ProtocolTopologyCandidate; record: FeatureGeometryRecord }> {
  const record = geometryRecord(lookup, reference.reference.featureId)
  if (!record) {
    throw new Error(
      `External model feature ${reference.reference.featureId} geometry is unavailable.`,
    )
  }
  const candidates = record.geometry.topologyCandidates
  const resolution = resolveTopologyReference(
    reference.reference,
    candidates.map(domainTopologyCandidate),
  )
  if (resolution.status !== "resolved") {
    throw new Error(
      `External model reference ${reference.id} is ${resolution.status} (${reference.reference.featureId}).`,
    )
  }
  const candidate = candidates.find(({ candidateId }) => candidateId === resolution.candidateId)
  if (!candidate) {
    throw new Error(`External model reference ${reference.id} resolved to missing geometry.`)
  }
  return { candidate, record }
}

function resolvedModelCandidate(
  reference:
    | SketchExternalModelPointReference
    | SketchExternalModelLineReference
    | SketchExternalModelPiercePointReference
    | SketchExternalModelCurveReference,
  lookup: FeatureGeometryLookup | undefined,
) {
  return resolvedModelCandidateWithRecord(reference, lookup).candidate
}

function resolveExternalModelPoint(
  reference: SketchExternalModelPointReference,
  targetFrame: SupportFrame,
  lookup: FeatureGeometryLookup | undefined,
): NonNullable<SketchCompilationInput["externalPoints"]>[number] {
  const candidate = resolvedModelCandidate(reference, lookup)
  if (
    candidate.kind !== "vertex" ||
    candidate.signature.geometryClass !== "POINT" ||
    candidate.referenceGeometry?.kind !== "vertex"
  ) {
    throw new Error(`External model point ${reference.id} has mismatched geometry.`)
  }
  const projected = projectWorldPointToSupport(targetFrame, candidate.referenceGeometry.position)
  return {
    schemaVersion: 0,
    id: reference.projectedPointId,
    type: "point",
    construction: true,
    ...projected,
  }
}

function resolveExternalModelLine(
  reference: SketchExternalModelLineReference,
  targetFrame: SupportFrame,
  lookup: FeatureGeometryLookup | undefined,
): NonNullable<SketchCompilationInput["externalLines"]>[number] {
  const candidate = resolvedModelCandidate(reference, lookup)
  if (
    candidate.kind !== "edge" ||
    candidate.signature.geometryClass !== "LINE" ||
    candidate.referenceGeometry?.kind !== "line-edge"
  ) {
    throw new Error(`External model line ${reference.id} has mismatched geometry.`)
  }
  const start = projectWorldPointToSupport(targetFrame, candidate.referenceGeometry.start)
  const end = projectWorldPointToSupport(targetFrame, candidate.referenceGeometry.end)
  if (Math.hypot(end.x - start.x, end.y - start.y) <= 1e-9) {
    throw new Error(`External model line ${reference.id} has a degenerate projection.`)
  }
  return {
    startPoint: projectedPointEntity(reference.projectedStartPointId, start),
    endPoint: projectedPointEntity(reference.projectedEndPointId, end),
    line: {
      schemaVersion: 0,
      id: reference.projectedLineId,
      type: "line",
      construction: true,
      startPointId: reference.projectedStartPointId,
      endPointId: reference.projectedEndPointId,
    },
  }
}

function resolveExternalModelPiercePoint(
  reference: SketchExternalModelPiercePointReference,
  targetFrame: SupportFrame,
  lookup: FeatureGeometryLookup | undefined,
): NonNullable<SketchCompilationInput["externalPoints"]>[number] {
  const candidate = resolvedModelCandidate(reference, lookup)
  if (
    candidate.kind !== "edge" ||
    candidate.signature.geometryClass !== "LINE" ||
    candidate.referenceGeometry?.kind !== "line-edge"
  ) {
    throw new Error(`External model Pierce ${reference.id} has mismatched geometry.`)
  }
  const point = intersectBoundedLineWithSupportPlane(
    candidate.referenceGeometry.start,
    candidate.referenceGeometry.end,
    targetFrame,
  )
  if (!point)
    throw new Error(`External model line ${reference.id} does not pierce the target support.`)
  return {
    schemaVersion: 0,
    id: reference.projectedPointId,
    type: "point",
    construction: true,
    ...point,
  }
}

async function resolveExternalModelIntersection(
  documentId: string,
  reference: SketchExternalModelIntersectionReference,
  targetFrame: SupportFrame,
  lookup: FeatureGeometryLookup | undefined,
  sectionPlanarFace: PlanarFaceSectionPort | undefined,
): Promise<NonNullable<SketchCompilationInput["externalLines"]>[number]> {
  if (!sectionPlanarFace) {
    throw new Error("Exact planar-face intersection is unavailable in this build.")
  }
  const { candidate, record } = resolvedModelCandidateWithRecord(reference, lookup)
  if (
    candidate.kind !== "face" ||
    candidate.signature.geometryClass !== "PLANE" ||
    candidate.meshFaceId === undefined
  ) {
    throw new Error(`External model intersection ${reference.id} has mismatched geometry.`)
  }
  const result = await sectionPlanarFace({
    documentId,
    sourceFeatureId: reference.reference.featureId,
    sourceContentHash: record.contentHash,
    reference: reference.reference,
    resolvedFaceKey: candidate.meshFaceId,
    planeOrigin: targetFrame.origin,
    planeNormal: targetFrame.normal,
  })
  if (!result.ok) throw new Error(result.diagnostic.message)
  const start = projectWorldPointToSupport(targetFrame, result.endpoints[0])
  const end = projectWorldPointToSupport(targetFrame, result.endpoints[1])
  if (Math.hypot(end.x - start.x, end.y - start.y) <= 1e-9) {
    throw new Error(`External model intersection ${reference.id} has a degenerate projection.`)
  }
  return {
    startPoint: projectedPointEntity(reference.projectedStartPointId, start),
    endPoint: projectedPointEntity(reference.projectedEndPointId, end),
    line: {
      schemaVersion: 0,
      id: reference.projectedLineId,
      type: "line",
      construction: true,
      startPointId: reference.projectedStartPointId,
      endPointId: reference.projectedEndPointId,
    },
  }
}

type ExternalCurveInput = NonNullable<SketchCompilationInput["externalCurves"]>[number]
type ReferenceGeometry = NonNullable<ProtocolTopologyCandidate["referenceGeometry"]>
type ModelCurveGeometry = Exclude<ReferenceGeometry, { kind: "line-edge" | "vertex" }>

const MODEL_CURVE_SOURCE_EXPECTATION = {
  circle: { geometryClass: "CIRCLE", geometryKind: "circle-edge" },
  arc: { geometryClass: "CIRCLE", geometryKind: "arc-edge" },
  ellipse: { geometryClass: "ELLIPSE", geometryKind: "ellipse-edge" },
  "elliptical-arc": { geometryClass: "ELLIPSE", geometryKind: "elliptical-arc-edge" },
} as const satisfies Record<
  SketchExternalModelCurveReference["sourceType"],
  Readonly<{ geometryClass: string; geometryKind: ModelCurveGeometry["kind"] }>
>

function modelCurveGeometry(geometry: ReferenceGeometry): ModelCurveGeometry | null {
  return geometry.kind === "vertex" || geometry.kind === "line-edge" ? null : geometry
}

function projectWorldModelCurveToSupport(geometry: ModelCurveGeometry, targetFrame: SupportFrame) {
  return geometry.kind === "circle-edge" || geometry.kind === "arc-edge"
    ? projectWorldCircularEdgeToSupport(geometry, targetFrame)
    : projectWorldEllipticalEdgeToSupport(geometry, targetFrame)
}

function requiredProjectedPoint(
  points: ExternalCurveInput["points"],
  index: number,
  message: string,
) {
  const point = points[index]
  if (!point) throw new Error(message)
  return point
}

function requiredProjectedRadius(projection: { radius?: number }) {
  if (!projection.radius) throw new Error("External projected circle radius is unavailable.")
  return projection.radius
}

function projectedCurveEntity(
  reference: SketchExternalCurveReference | SketchExternalModelCurveReference,
  projection: NonNullable<ReturnType<typeof projectSketchCurveBetweenFrames>>,
  points: ExternalCurveInput["points"],
): ExternalCurveInput["curve"] {
  const centerPoint = requiredProjectedPoint(
    points,
    0,
    "External projected curve requires a center point.",
  )
  const base = { schemaVersion: 0 as const, id: reference.projectedEntityId, construction: true }
  if (projection.type === "circle") {
    return {
      ...base,
      type: "circle",
      centerPointId: centerPoint.id,
      radius: requiredProjectedRadius(projection),
    }
  }
  const firstPoint = requiredProjectedPoint(
    points,
    1,
    "External projected curve defining points are unavailable.",
  )
  const secondPoint = requiredProjectedPoint(
    points,
    2,
    "External projected curve defining points are unavailable.",
  )
  if (projection.type === "arc") {
    return {
      ...base,
      type: "arc",
      centerPointId: centerPoint.id,
      startPointId: firstPoint.id,
      endPointId: secondPoint.id,
    }
  }
  if (projection.type === "ellipse") {
    return {
      ...base,
      type: "ellipse",
      centerPointId: centerPoint.id,
      primaryAxisPointId: firstPoint.id,
      secondaryAxisPointId: secondPoint.id,
    }
  }
  const startPoint = requiredProjectedPoint(
    points,
    3,
    "External projected elliptical arc endpoints are unavailable.",
  )
  const endPoint = requiredProjectedPoint(
    points,
    4,
    "External projected elliptical arc endpoints are unavailable.",
  )
  return {
    ...base,
    type: "elliptical-arc",
    centerPointId: centerPoint.id,
    primaryAxisPointId: firstPoint.id,
    secondaryAxisPointId: secondPoint.id,
    startPointId: startPoint.id,
    endPointId: endPoint.id,
  }
}

function materializeProjectedCurve(
  reference: SketchExternalCurveReference | SketchExternalModelCurveReference,
  projection: NonNullable<ReturnType<typeof projectSketchCurveBetweenFrames>>,
): ExternalCurveInput {
  if (projection.type !== reference.projectedType) {
    const source =
      reference.kind === "model-curve" ? reference.reference.featureId : reference.sourceEntityId
    throw new Error(`External source curve ${source} changed projected geometry type.`)
  }
  const points = projection.points.map((point, index) => {
    const id = reference.projectedPointIds[index]
    if (!id) throw new Error("External projected curve point identities are incomplete.")
    return projectedPointEntity(id, point)
  })
  return { points, curve: projectedCurveEntity(reference, projection, points) }
}

function resolveExternalModelCurve(
  reference: SketchExternalModelCurveReference,
  targetFrame: SupportFrame,
  lookup: FeatureGeometryLookup | undefined,
): ExternalCurveInput {
  const candidate = resolvedModelCandidate(reference, lookup)
  const geometry = candidate.referenceGeometry
  if (candidate.kind !== "edge" || !geometry) {
    throw new Error(`External model curve ${reference.id} has mismatched geometry.`)
  }
  const expected = MODEL_CURVE_SOURCE_EXPECTATION[reference.sourceType]
  if (
    candidate.signature.geometryClass !== expected.geometryClass ||
    geometry.kind !== expected.geometryKind
  ) {
    throw new Error(`External model curve ${reference.id} has mismatched geometry.`)
  }
  const curveGeometry = modelCurveGeometry(geometry)
  const projection = curveGeometry
    ? projectWorldModelCurveToSupport(curveGeometry, targetFrame)
    : null
  if (!projection) {
    throw new Error(`External model curve ${reference.id} has a degenerate projection.`)
  }
  return materializeProjectedCurve(reference, projection)
}

type SourceSketchCurve = Exclude<SketchEntity, { type: "line" | "point" }>

function sourceSketchCurve(
  reference: SketchExternalCurveReference,
  source: SketchRecord,
  externalGeometry?: ResolvedExternalSketchGeometry,
): SourceSketchCurve {
  const candidate =
    source.entities.find(({ id }) => id === reference.sourceEntityId) ??
    externalGeometry?.externalCurves?.find(({ curve }) => curve.id === reference.sourceEntityId)
      ?.curve
  if (
    !candidate ||
    candidate.type === "point" ||
    candidate.type === "line" ||
    candidate.type !== reference.sourceType
  ) {
    throw new Error(`External source curve ${reference.sourceEntityId} is unavailable.`)
  }
  return candidate as SourceSketchCurve
}

function sourceCircleRadius(curve: SourceSketchCurve, result: SolveSketchRecordResult) {
  if (curve.type !== "circle") return undefined
  if (!result.ok) return curve.radius
  return result.solution.circles.find(({ entityId }) => entityId === curve.id)?.radius
}

function resolveExternalCurve(
  reference: SketchExternalCurveReference,
  source: SketchRecord,
  result: SolveSketchRecordResult,
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
  externalGeometry?: ResolvedExternalSketchGeometry,
): NonNullable<SketchCompilationInput["externalCurves"]>[number] {
  const sourceCurve = sourceSketchCurve(reference, source, externalGeometry)
  const projection = projectSketchCurveBetweenFrames(
    sourceFrame,
    targetFrame,
    sourceCurve,
    sourcePointMap(source, result, externalGeometry),
    sourceCircleRadius(sourceCurve, result),
  )
  if (!projection) {
    throw new Error(
      `External source curve ${reference.sourceEntityId} has a degenerate projection.`,
    )
  }
  return materializeProjectedCurve(reference, projection)
}

function sourceSolve(
  results: SketchSolveCache,
  document: DocumentSnapshot,
  source: SketchRecord,
  solveSketch: SketchSolvePort,
  features: readonly FeatureRecord[],
  geometryLookup: FeatureGeometryLookup | undefined,
  sectionPlanarFace: PlanarFaceSectionPort | undefined,
  externalGeometry?: ResolvedExternalSketchGeometry,
) {
  const cached = results.get(source.id)
  if (cached) return cached
  const pending = (
    externalGeometry
      ? Promise.resolve(externalGeometry)
      : resolveExternalSketchGeometry(
          document,
          source,
          solveSketch,
          features,
          results,
          geometryLookup,
          sectionPlanarFace,
        )
  ).then((resolvedGeometry) =>
    solveSketch({
      revision: document.revision,
      sketch: source,
      variables: [...document.variables],
      continuation: null,
      draggedPoints: [],
      ...resolvedGeometry,
    }),
  )
  results.set(source.id, pending)
  return pending
}

type ExternalReference = NonNullable<SketchRecord["externalReferences"]>[number]
type ExternalLiveModelReference =
  | SketchExternalModelPointReference
  | SketchExternalModelLineReference
  | SketchExternalModelPiercePointReference
  | SketchExternalModelCurveReference
  | SketchExternalModelIntersectionReference
type ExternalModelReference = SketchExternalModelReference
export type ExternalModelMaterializationCache = Map<string, Promise<ResolvedReference>>
type ResolvedReference =
  | Readonly<{
      kind: "curve"
      value: NonNullable<SketchCompilationInput["externalCurves"]>[number]
    }>
  | Readonly<{
      kind: "line"
      value: NonNullable<SketchCompilationInput["externalLines"]>[number]
    }>
  | Readonly<{
      kind: "point"
      value: NonNullable<SketchCompilationInput["externalPoints"]>[number]
    }>

function sourceExternalGeometry(
  cache: ExternalSketchGeometryCache,
  document: DocumentSnapshot,
  source: SketchRecord,
  solveSketch: SketchSolvePort,
  features: readonly FeatureRecord[],
  results: SketchSolveCache,
  geometryLookup?: FeatureGeometryLookup,
  sectionPlanarFace?: PlanarFaceSectionPort,
  modelMaterializationCache: ExternalModelMaterializationCache = new Map(),
) {
  const cached = cache.get(source.id)
  if (cached) return cached
  const pending = resolveExternalSketchGeometry(
    document,
    source,
    solveSketch,
    features,
    results,
    geometryLookup,
    sectionPlanarFace,
    cache,
    modelMaterializationCache,
  )
  cache.set(source.id, pending)
  return pending
}

async function resolveExternalReference(
  reference: ExternalReference,
  ownerSketchId: string,
  document: DocumentSnapshot,
  targetFrame: SupportFrame,
  solveSketch: SketchSolvePort,
  features: readonly FeatureRecord[],
  results: SketchSolveCache,
  geometryLookup?: FeatureGeometryLookup,
  sectionPlanarFace?: PlanarFaceSectionPort,
  externalGeometryCache: ExternalSketchGeometryCache = new Map(),
  modelMaterializationCache: ExternalModelMaterializationCache = new Map(),
): Promise<ResolvedReference> {
  if (isSketchExternalModelReference(reference)) {
    if (isOrphanedModelReference(reference))
      throw new Error("The external model reference requires repair.")
    return materializeExternalModelReference(
      document.id,
      reference,
      ownerSketchId,
      targetFrame,
      geometryLookup,
      sectionPlanarFace,
      modelMaterializationCache,
    )
  }
  const source = document.sketches.find((candidate) => candidate.id === reference.sourceSketchId)
  if (!source) throw new Error(`External source sketch ${reference.sourceSketchId} is missing.`)
  const sourceFrame = sketchFrame(source, document, features, new Set(), geometryLookup)
  if (!sourceFrame) throw new Error(`External source support ${source.id} is unavailable.`)
  // Resolve the source's own projections so a later sketch can target their stable IDs.
  const resolvedSourceGeometry = await sourceExternalGeometry(
    externalGeometryCache,
    document,
    source,
    solveSketch,
    features,
    results,
    geometryLookup,
    sectionPlanarFace,
    modelMaterializationCache,
  )
  const result = await sourceSolve(
    results,
    document,
    source,
    solveSketch,
    features,
    geometryLookup,
    sectionPlanarFace,
    resolvedSourceGeometry,
  )
  if (reference.kind === "line") {
    return {
      kind: "line",
      value: resolveExternalLine(
        reference,
        source,
        result,
        sourceFrame,
        targetFrame,
        resolvedSourceGeometry,
      ),
    }
  }
  if (reference.kind === "pierce-point") {
    return {
      kind: "point",
      value: resolveExternalPiercePoint(
        reference,
        source,
        result,
        sourceFrame,
        targetFrame,
        resolvedSourceGeometry,
      ),
    }
  }
  if (reference.kind === "curve") {
    return {
      kind: "curve",
      value: resolveExternalCurve(
        reference,
        source,
        result,
        sourceFrame,
        targetFrame,
        resolvedSourceGeometry,
      ),
    }
  }
  return {
    kind: "point",
    value: resolveExternalPoint(
      reference,
      source,
      result,
      sourceFrame,
      targetFrame,
      resolvedSourceGeometry,
    ),
  }
}

async function resolveExternalModelReference(
  documentId: string,
  reference: ExternalLiveModelReference,
  targetFrame: SupportFrame,
  geometryLookup: FeatureGeometryLookup | undefined,
  sectionPlanarFace: PlanarFaceSectionPort | undefined,
): Promise<ResolvedReference> {
  if (reference.kind === "model-point") {
    return {
      kind: "point",
      value: resolveExternalModelPoint(reference, targetFrame, geometryLookup),
    }
  }
  if (reference.kind === "model-line") {
    return { kind: "line", value: resolveExternalModelLine(reference, targetFrame, geometryLookup) }
  }
  if (reference.kind === "model-pierce-point") {
    return {
      kind: "point",
      value: resolveExternalModelPiercePoint(reference, targetFrame, geometryLookup),
    }
  }
  if (reference.kind === "model-curve") {
    return {
      kind: "curve",
      value: resolveExternalModelCurve(reference, targetFrame, geometryLookup),
    }
  }
  return {
    kind: "line",
    value: await resolveExternalModelIntersection(
      documentId,
      reference,
      targetFrame,
      geometryLookup,
      sectionPlanarFace,
    ),
  }
}

function materializeExternalModelReference(
  documentId: string,
  reference: ExternalModelReference,
  ownerSketchId: string,
  targetFrame: SupportFrame,
  geometryLookup: FeatureGeometryLookup | undefined,
  sectionPlanarFace: PlanarFaceSectionPort | undefined,
  cache: ExternalModelMaterializationCache,
) {
  if (reference.schemaVersion !== 0)
    throw new Error("The external model reference requires repair.")
  const key = `${ownerSketchId}:${reference.id}`
  const cached = cache.get(key)
  if (cached) return cached
  const pending = resolveExternalModelReference(
    documentId,
    reference,
    targetFrame,
    geometryLookup,
    sectionPlanarFace,
  )
  cache.set(key, pending)
  return pending
}

type ModelReferenceEvidence = Readonly<{
  sketchId: string
  referenceId: string
  status: "resolved" | "broken"
}>

async function inspectExternalModelReference(
  document: DocumentSnapshot,
  sketch: SketchRecord,
  reference: ExternalModelReference,
  targetFrame: SupportFrame | null,
  geometryLookup: FeatureGeometryLookup | undefined,
  sectionPlanarFace: PlanarFaceSectionPort | undefined,
  modelMaterializationCache: ExternalModelMaterializationCache,
  isCurrent: (() => boolean) | undefined,
): Promise<ModelReferenceEvidence | null> {
  if (isCurrent && !isCurrent()) return null
  if (isOrphanedModelReference(reference))
    return { sketchId: sketch.id, referenceId: reference.id, status: "broken" }
  let status: ModelReferenceEvidence["status"] = "broken"
  if (targetFrame) {
    try {
      await materializeExternalModelReference(
        document.id,
        reference,
        sketch.id,
        targetFrame,
        geometryLookup,
        sectionPlanarFace,
        modelMaterializationCache,
      )
      status = "resolved"
    } catch {
      // Protocol evidence intentionally exposes only the bounded status.
    }
  }
  if (isCurrent && !isCurrent()) return null
  return { sketchId: sketch.id, referenceId: reference.id, status }
}

/** Inspects every model-backed reference independently using the solve materialization path. */
export async function inspectExternalModelReferenceHealth(
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  geometryLookup: FeatureGeometryLookup | undefined,
  sectionPlanarFace?: PlanarFaceSectionPort,
  modelMaterializationCache: ExternalModelMaterializationCache = new Map(),
  isCurrent?: () => boolean,
) {
  const evidence: ModelReferenceEvidence[] = []
  for (const sketch of document.sketches) {
    const targetFrame = sketchFrame(sketch, document, features, new Set(), geometryLookup)
    for (const reference of sketch.externalReferences ?? []) {
      if (!isSketchExternalModelReference(reference)) continue
      const record = await inspectExternalModelReference(
        document,
        sketch,
        reference,
        targetFrame,
        geometryLookup,
        sectionPlanarFace,
        modelMaterializationCache,
        isCurrent,
      )
      if (!record) return evidence
      evidence.push(record)
    }
  }
  return evidence
}

/** Resolves persisted references without serializing disposable solver output. */
export async function resolveExternalSketchGeometry(
  document: DocumentSnapshot,
  sketch: SketchRecord,
  solveSketch: SketchSolvePort,
  features: readonly FeatureRecord[] = document.features,
  results: SketchSolveCache = new Map(),
  geometryLookup?: FeatureGeometryLookup,
  sectionPlanarFace?: PlanarFaceSectionPort,
  externalGeometryCache: ExternalSketchGeometryCache = new Map(),
  modelMaterializationCache: ExternalModelMaterializationCache = new Map(),
): Promise<ResolvedExternalSketchGeometry> {
  const targetFrame = sketchFrame(sketch, document, features, new Set(), geometryLookup)
  if (!targetFrame) throw new Error(`Sketch support ${sketch.id} is unavailable.`)
  const points: NonNullable<SketchCompilationInput["externalPoints"]> = []
  const lines: NonNullable<SketchCompilationInput["externalLines"]> = []
  const curves: NonNullable<SketchCompilationInput["externalCurves"]> = []
  for (const reference of sketch.externalReferences ?? []) {
    const resolved = await resolveExternalReference(
      reference,
      sketch.id,
      document,
      targetFrame,
      solveSketch,
      features,
      results,
      geometryLookup,
      sectionPlanarFace,
      externalGeometryCache,
      modelMaterializationCache,
    )
    if (resolved.kind === "point") points.push(resolved.value)
    if (resolved.kind === "line") lines.push(resolved.value)
    if (resolved.kind === "curve") curves.push(resolved.value)
  }
  return { externalCurves: curves, externalLines: lines, externalPoints: points }
}
