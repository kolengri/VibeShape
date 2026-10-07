import type {
  DocumentFeatureContentPreparationResult,
  FeatureGeometryRecord,
} from "@vibeshape/application/feature-rebuild"
import { resolveReferencePlane } from "@vibeshape/application/reference-frame"
import { type SupportFrame, sketchFrame } from "@vibeshape/application/support-frame"
import {
  canonicalJson,
  type DocumentSnapshot,
  type FeatureRecord,
  type SketchRecord,
} from "@vibeshape/domain"
import {
  type FdmFeatureParameters,
  fdmContentParameters,
  fdmDependencyIds,
  readFdmFeatureParameters,
} from "@vibeshape/domain/part-design-fdm"
import { fdmFeatureContentParametersSchema } from "@vibeshape/protocol"
import type { SolveSketchRecordResult } from "@vibeshape/sketch-solver"

type Web = Extract<FdmFeatureParameters, { kind: "web" }>
type Solution = Extract<SolveSketchRecordResult, { ok: true }>["solution"]
type Context = {
  document: DocumentSnapshot
  features: readonly FeatureRecord[]
  geometry: readonly FeatureGeometryRecord[]
  solveSketch: (
    sketch: SketchRecord,
  ) => Promise<
    | Extract<SolveSketchRecordResult, { ok: true }>
    | Extract<DocumentFeatureContentPreparationResult, { ok: false }>
  >
}
function failure(reason: string) {
  return {
    ok: false as const,
    diagnostic: { code: "org.vibeshape.feature.fdm-invalid", values: { reason } },
  }
}
function savedSupportsMatch(feature: FeatureRecord, p: Web, sketch: SketchRecord) {
  const supportId = sketch.support?.reference.featureId ?? null
  const expected = fdmDependencyIds(p, supportId)
  if (JSON.stringify(feature.dependencies) !== JSON.stringify(expected)) return false
  const references = sketch.support ? [sketch.support.reference] : []
  return canonicalJson(feature.references) === canonicalJson(references)
}
function solvedWebLines(p: Web, sketch: SketchRecord, solution: Solution) {
  const points = new Map(solution.points.map((point) => [point.entityId, point]))
  const segments: { start: [number, number]; end: [number, number] }[] = []
  for (const id of p.lineIds) {
    const line = sketch.entities.find((entity) => entity.id === id)
    if (line?.type !== "line" || line.construction)
      return failure("Web requires saved nonconstruction straight lines.")
    const start = points.get(line.startPointId),
      end = points.get(line.endPointId)
    if (!start || !end) return failure("A saved Web endpoint is missing from the solved sketch.")
    segments.push({ start: [start.x, start.y], end: [end.x, end.y] })
  }
  return { ok: true as const, segments }
}
function webDepth(p: Web, frame: SupportFrame, context: Context) {
  if (!p.stopPlane) return { ok: true as const, depth: p.depth.value }
  // Infinite authored/datum planes are exact; finite face coverage is a different contract.
  if (p.stopPlane.kind === "planar-face")
    return failure("Web stop-to-face is unsupported; select an explicit or datum plane.")
  const plane = resolveReferencePlane(p.stopPlane, context)
  if (!plane) return failure("The Web stop plane is unresolved.")
  const dot = plane.normal.reduce(
    (sum, value, index) => sum + value * (frame.normal[index] ?? 0),
    0,
  )
  if (Math.abs(Math.abs(dot) - 1) > 1e-8)
    return failure("Web stop planes must be parallel to the saved sketch plane.")
  const offset = plane.normal.reduce(
    (sum, value, index) => sum + value * ((plane.origin[index] ?? 0) - (frame.origin[index] ?? 0)),
    0,
  )
  return { ok: true as const, depth: (offset / dot) * (p.direction === "reverse" ? -1 : 1) }
}
function parseWebContent(input: unknown) {
  const content = fdmFeatureContentParametersSchema.safeParse(input)
  return content.success
    ? { ok: true as const, parameters: content.data }
    : failure(content.error.issues[0]?.message ?? "Invalid materialized Web geometry.")
}
async function prepareWeb(feature: FeatureRecord, p: Web, context: Context) {
  const sketch = context.document.sketches.find(({ id }) => id === p.sketchId)
  if (!sketch) return failure("The saved Web sketch is missing.")
  if (!savedSupportsMatch(feature, p, sketch))
    return failure("Web dependencies must preserve the saved sketch support and stop-plane owners.")
  const frame = sketchFrame(sketch, context.document, context.features, new Set(), context.geometry)
  if (!frame) return failure("The Web sketch support is unresolved.")
  const solved = await context.solveSketch(sketch)
  if (!solved.ok) return solved
  const lines = solvedWebLines(p, sketch, solved.solution)
  if (!lines.ok) return lines
  const depth = webDepth(p, frame, context)
  if (!depth.ok) return depth
  return parseWebContent({
    kind: "web",
    frame,
    segments: lines.segments,
    thickness: p.thickness.value,
    depth: depth.depth,
    direction: p.direction,
    style: p.style,
    extendToWalls: p.extendToWalls,
    supportInputCount: feature.dependencies.length - 1,
  })
}
export async function prepareFdmContent(feature: FeatureRecord, context: Context) {
  const parameters = readFdmFeatureParameters(feature)
  if (!parameters) return null
  return parameters.kind === "web"
    ? prepareWeb(feature, parameters, context)
    : { ok: true as const, parameters: fdmContentParameters(parameters) }
}
