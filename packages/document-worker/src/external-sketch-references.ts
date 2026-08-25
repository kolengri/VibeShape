import {
  projectSketchPointBetweenFrames,
  type SupportFrame,
  sketchFrame,
} from "@vibeshape/application/support-frame"
import type {
  DocumentSnapshot,
  FeatureRecord,
  SketchExternalLineReference,
  SketchExternalPointReference,
  SketchRecord,
} from "@vibeshape/domain"
import type { SketchCompilationInput, SolveSketchRecordResult } from "@vibeshape/sketch-solver"

export type SketchSolvePort = (
  input: SketchCompilationInput,
) => SolveSketchRecordResult | Promise<SolveSketchRecordResult>

export type SketchSolveCache = Map<string, Promise<SolveSketchRecordResult>>

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
  Pick<SketchCompilationInput, "externalLines" | "externalPoints">
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

function sourceSolve(
  results: SketchSolveCache,
  document: DocumentSnapshot,
  source: SketchRecord,
  solveSketch: SketchSolvePort,
  features: readonly FeatureRecord[],
) {
  const cached = results.get(source.id)
  if (cached) return cached
  const pending = resolveExternalSketchGeometry(
    document,
    source,
    solveSketch,
    features,
    results,
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
): Promise<ResolvedExternalSketchGeometry> {
  const targetFrame = sketchFrame(sketch, document, features)
  if (!targetFrame) throw new Error(`Sketch support ${sketch.id} is unavailable.`)
  const points: NonNullable<SketchCompilationInput["externalPoints"]> = []
  const lines: NonNullable<SketchCompilationInput["externalLines"]> = []
  for (const reference of sketch.externalReferences ?? []) {
    const source = document.sketches.find((candidate) => candidate.id === reference.sourceSketchId)
    if (!source) throw new Error(`External source sketch ${reference.sourceSketchId} is missing.`)
    const sourceFrame = sketchFrame(source, document, features)
    if (!sourceFrame) throw new Error(`External source support ${source.id} is unavailable.`)
    const result = await sourceSolve(results, document, source, solveSketch, features)
    if (reference.kind === "line") {
      lines.push(resolveExternalLine(reference, source, result, sourceFrame, targetFrame))
      continue
    }
    points.push(resolveExternalPoint(reference, source, result, sourceFrame, targetFrame))
  }
  return { externalLines: lines, externalPoints: points }
}
