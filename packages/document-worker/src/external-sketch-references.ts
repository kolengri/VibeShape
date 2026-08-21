import type { DocumentSnapshot, SketchRecord } from "@vibeshape/domain"
import type { SketchCompilationInput, SolveSketchRecordResult } from "@vibeshape/sketch-solver"

export type SketchSolvePort = (
  input: SketchCompilationInput,
) => SolveSketchRecordResult | Promise<SolveSketchRecordResult>

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

/** Resolves persisted point references without serializing disposable solver output. */
export async function resolveExternalSketchPoints(
  document: DocumentSnapshot,
  sketch: SketchRecord,
  solveSketch: SketchSolvePort,
): Promise<SketchCompilationInput["externalPoints"]> {
  const results = new Map<string, Promise<SolveSketchRecordResult>>()
  const points: NonNullable<SketchCompilationInput["externalPoints"]> = []
  for (const reference of sketch.externalReferences ?? []) {
    const source = document.sketches.find((candidate) => candidate.id === reference.sourceSketchId)
    if (!source) throw new Error(`External source sketch ${reference.sourceSketchId} is missing.`)
    let pending = results.get(source.id)
    if (!pending) {
      pending = Promise.resolve(
        solveSketch({
          revision: document.revision,
          sketch: source,
          variables: [...document.variables],
          continuation: null,
          draggedPoints: [],
          externalPoints: [],
        }),
      )
      results.set(source.id, pending)
    }
    const point = sourcePointResult(source, await pending, reference.sourcePointId)
    if (!point) {
      throw new Error(`External source point ${reference.sourcePointId} is unavailable.`)
    }
    points.push({
      schemaVersion: 0,
      id: reference.projectedPointId,
      type: "point",
      construction: true,
      ...point,
    })
  }
  return points
}
