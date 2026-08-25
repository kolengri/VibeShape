import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import { projectSketchCurveBetweenFrames } from "@vibeshape/application/sketch-curve-projection"
import {
  projectSketchPointBetweenFrames,
  projectWorldPointToSupport,
  type SupportFrame,
  sketchFrame,
} from "@vibeshape/application/support-frame"
import type {
  DocumentSnapshot,
  FeatureRecord,
  SketchExternalCurveReference,
  SketchExternalLineReference,
  SketchExternalModelLineReference,
  SketchExternalModelPointReference,
  SketchExternalPointReference,
  SketchPoint2,
  SketchRecord,
  TopologyCandidate,
} from "@vibeshape/domain"
import { resolveTopologyReference } from "@vibeshape/domain"
import type { TopologyCandidate as ProtocolTopologyCandidate } from "@vibeshape/protocol"
import type { SketchCompilationInput, SolveSketchRecordResult } from "@vibeshape/sketch-solver"

export type SketchSolvePort = (
  input: SketchCompilationInput,
) => SolveSketchRecordResult | Promise<SolveSketchRecordResult>

export type SketchSolveCache = Map<string, Promise<SolveSketchRecordResult>>

export type FeatureGeometryLookup =
  | ReadonlyMap<string, FeatureGeometryRecord>
  | readonly FeatureGeometryRecord[]

function sourcePointResult(
  source: SketchRecord,
  result: SolveSketchRecordResult,
  sourcePointId: string,
) {
  const solved = result.ok
    ? result.solution.points.find((point) => point.entityId === sourcePointId)
    : null
  if (solved) return { x: solved.x, y: solved.y }
  const authored = source.entities.find((entity) => entity.id === sourcePointId)
  return authored?.type === "point" ? { x: authored.x, y: authored.y } : null
}

export type ResolvedExternalSketchGeometry = Readonly<
  Pick<SketchCompilationInput, "externalCurves" | "externalLines" | "externalPoints">
>

function resolveExternalPoint(
  reference: SketchExternalPointReference,
  source: SketchRecord,
  result: SolveSketchRecordResult,
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
): NonNullable<SketchCompilationInput["externalPoints"]>[number] {
  const point = sourcePointResult(source, result, reference.sourcePointId)
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
): NonNullable<SketchCompilationInput["externalLines"]>[number] {
  const sourceLine = source.entities.find(({ id }) => id === reference.sourceLineId)
  if (sourceLine?.type !== "line") {
    throw new Error(`External source line ${reference.sourceLineId} is unavailable.`)
  }
  const sourceStart = sourcePointResult(source, result, sourceLine.startPointId)
  const sourceEnd = sourcePointResult(source, result, sourceLine.endPointId)
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

function sourcePointMap(source: SketchRecord, result: SolveSketchRecordResult) {
  return new Map(
    source.entities.flatMap((entity) => {
      if (entity.type !== "point") return []
      const point = sourcePointResult(source, result, entity.id)
      return point ? ([[entity.id, point]] as const) : []
    }),
  )
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

function resolvedModelCandidate(
  reference: SketchExternalModelPointReference | SketchExternalModelLineReference,
  lookup: FeatureGeometryLookup | undefined,
): ProtocolTopologyCandidate {
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
  return candidate
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
  reference: SketchExternalCurveReference,
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
  reference: SketchExternalCurveReference,
  projection: NonNullable<ReturnType<typeof projectSketchCurveBetweenFrames>>,
): ExternalCurveInput {
  if (projection.type !== reference.projectedType) {
    throw new Error(
      `External source curve ${reference.sourceEntityId} changed projected geometry type.`,
    )
  }
  const points = projection.points.map((point, index) => {
    const id = reference.projectedPointIds[index]
    if (!id) throw new Error("External projected curve point identities are incomplete.")
    return projectedPointEntity(id, point)
  })
  return { points, curve: projectedCurveEntity(reference, projection, points) }
}

function resolveExternalCurve(
  reference: SketchExternalCurveReference,
  source: SketchRecord,
  result: SolveSketchRecordResult,
  sourceFrame: SupportFrame,
  targetFrame: SupportFrame,
): NonNullable<SketchCompilationInput["externalCurves"]>[number] {
  const sourceCurve = source.entities.find(({ id }) => id === reference.sourceEntityId)
  if (
    !sourceCurve ||
    sourceCurve.type === "point" ||
    sourceCurve.type === "line" ||
    sourceCurve.type !== reference.sourceType
  ) {
    throw new Error(`External source curve ${reference.sourceEntityId} is unavailable.`)
  }
  const solvedRadius =
    sourceCurve.type === "circle" && result.ok
      ? result.solution.circles.find(({ entityId }) => entityId === sourceCurve.id)?.radius
      : undefined
  const projection = projectSketchCurveBetweenFrames(
    sourceFrame,
    targetFrame,
    sourceCurve,
    sourcePointMap(source, result),
    solvedRadius,
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
) {
  const cached = results.get(source.id)
  if (cached) return cached
  const pending = resolveExternalSketchGeometry(
    document,
    source,
    solveSketch,
    features,
    results,
    geometryLookup,
  ).then((externalGeometry) =>
    solveSketch({
      revision: document.revision,
      sketch: source,
      variables: [...document.variables],
      continuation: null,
      draggedPoints: [],
      ...externalGeometry,
    }),
  )
  results.set(source.id, pending)
  return pending
}

/** Resolves persisted references without serializing disposable solver output. */
export async function resolveExternalSketchGeometry(
  document: DocumentSnapshot,
  sketch: SketchRecord,
  solveSketch: SketchSolvePort,
  features: readonly FeatureRecord[] = document.features,
  results: SketchSolveCache = new Map(),
  geometryLookup?: FeatureGeometryLookup,
): Promise<ResolvedExternalSketchGeometry> {
  const targetFrame = sketchFrame(sketch, document, features)
  if (!targetFrame) throw new Error(`Sketch support ${sketch.id} is unavailable.`)
  const points: NonNullable<SketchCompilationInput["externalPoints"]> = []
  const lines: NonNullable<SketchCompilationInput["externalLines"]> = []
  const curves: NonNullable<SketchCompilationInput["externalCurves"]> = []
  for (const reference of sketch.externalReferences ?? []) {
    if (reference.kind === "model-point") {
      points.push(resolveExternalModelPoint(reference, targetFrame, geometryLookup))
      continue
    }
    if (reference.kind === "model-line") {
      lines.push(resolveExternalModelLine(reference, targetFrame, geometryLookup))
      continue
    }
    const source = document.sketches.find((candidate) => candidate.id === reference.sourceSketchId)
    if (!source) throw new Error(`External source sketch ${reference.sourceSketchId} is missing.`)
    const sourceFrame = sketchFrame(source, document, features)
    if (!sourceFrame) throw new Error(`External source support ${source.id} is unavailable.`)
    const result = await sourceSolve(
      results,
      document,
      source,
      solveSketch,
      features,
      geometryLookup,
    )
    if (reference.kind === "line") {
      lines.push(resolveExternalLine(reference, source, result, sourceFrame, targetFrame))
      continue
    }
    if (reference.kind === "curve") {
      curves.push(resolveExternalCurve(reference, source, result, sourceFrame, targetFrame))
      continue
    }
    points.push(resolveExternalPoint(reference, source, result, sourceFrame, targetFrame))
  }
  return { externalCurves: curves, externalLines: lines, externalPoints: points }
}
