import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import {
  projectSketchCurveBetweenFrames,
  projectWorldCircularEdgeToSupport,
} from "@vibeshape/application/sketch-curve-projection"
import {
  projectSketchPointBetweenFrames,
  projectWorldPointToSupport,
  type SupportFrame,
  sketchFrame,
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
  SketchExternalModelPointReference,
  SketchExternalPointReference,
  SketchPoint2,
  SketchRecord,
  TopologyCandidate,
} from "@vibeshape/domain"
import { resolveTopologyReference } from "@vibeshape/domain"
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
  if (
    candidate.kind !== "edge" ||
    candidate.signature.geometryClass !== "CIRCLE" ||
    (geometry?.kind !== "circle-edge" && geometry?.kind !== "arc-edge") ||
    (reference.sourceType === "circle") !== (geometry.kind === "circle-edge")
  ) {
    throw new Error(`External model curve ${reference.id} has mismatched geometry.`)
  }
  const projection = projectWorldCircularEdgeToSupport(geometry, targetFrame)
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
  )
  cache.set(source.id, pending)
  return pending
}

async function resolveExternalReference(
  reference: ExternalReference,
  document: DocumentSnapshot,
  targetFrame: SupportFrame,
  solveSketch: SketchSolvePort,
  features: readonly FeatureRecord[],
  results: SketchSolveCache,
  geometryLookup?: FeatureGeometryLookup,
  sectionPlanarFace?: PlanarFaceSectionPort,
  externalGeometryCache: ExternalSketchGeometryCache = new Map(),
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
  if (reference.kind === "model-curve") {
    return {
      kind: "curve",
      value: resolveExternalModelCurve(reference, targetFrame, geometryLookup),
    }
  }
  if (reference.kind === "model-intersection") {
    return {
      kind: "line",
      value: await resolveExternalModelIntersection(
        document.id,
        reference,
        targetFrame,
        geometryLookup,
        sectionPlanarFace,
      ),
    }
  }
  const source = document.sketches.find((candidate) => candidate.id === reference.sourceSketchId)
  if (!source) throw new Error(`External source sketch ${reference.sourceSketchId} is missing.`)
  const sourceFrame = sketchFrame(source, document, features)
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
): Promise<ResolvedExternalSketchGeometry> {
  const targetFrame = sketchFrame(sketch, document, features)
  if (!targetFrame) throw new Error(`Sketch support ${sketch.id} is unavailable.`)
  const points: NonNullable<SketchCompilationInput["externalPoints"]> = []
  const lines: NonNullable<SketchCompilationInput["externalLines"]> = []
  const curves: NonNullable<SketchCompilationInput["externalCurves"]> = []
  for (const reference of sketch.externalReferences ?? []) {
    const resolved = await resolveExternalReference(
      reference,
      document,
      targetFrame,
      solveSketch,
      features,
      results,
      geometryLookup,
      sectionPlanarFace,
      externalGeometryCache,
    )
    if (resolved.kind === "point") points.push(resolved.value)
    if (resolved.kind === "line") lines.push(resolved.value)
    if (resolved.kind === "curve") curves.push(resolved.value)
  }
  return { externalCurves: curves, externalLines: lines, externalPoints: points }
}
