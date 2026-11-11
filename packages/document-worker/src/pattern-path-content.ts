import {
  type DocumentFeatureContentPreparationResult,
  expectedPathPatternDependencyIds,
} from "@vibeshape/application/feature-rebuild"
import type { FeatureRecord, SketchRecord } from "@vibeshape/domain"
import { featureTypeKey } from "@vibeshape/domain/feature-type-contracts"
import {
  type PatternFeatureParametersV3,
  patternFeatureParametersV3Schema,
  patternFeatureTypeV3,
  readPatternFeatureParametersV3,
} from "@vibeshape/domain/part-design-pattern-path"
import type { SketchPathSelector } from "@vibeshape/domain/sketch-path-selector"
import { patternFeatureContentParametersV3Schema } from "@vibeshape/protocol"
import type { SolveSketchRecordResult } from "@vibeshape/sketch-solver"
import {
  materializeSelectedPath,
  type PreparationInput,
  prepareSweepLoftFeatureContent,
  shouldPrepareSweepLoftFeatureContent,
  solvedSketch,
} from "./sweep-loft-content"

type Failure = Extract<DocumentFeatureContentPreparationResult, { ok: false }>
type Solution = Extract<SolveSketchRecordResult, { ok: true }>["solution"]
const CODE = "org.vibeshape.feature.pattern-path-invalid"
const ON_CIRCLE_TOLERANCE = 1e-6

function failure(reason: string, values: Readonly<Record<string, string | number>> = {}): Failure {
  return { ok: false, diagnostic: { code: CODE, values: { reason, ...values } } }
}

/** Shared sketch-path failures keep their reason but report the Pattern owner. */
function asPatternFailure(result: Failure): Failure {
  return { ok: false, diagnostic: { ...result.diagnostic, code: CODE } }
}

function isPathPatternFeature(feature: FeatureRecord) {
  return featureTypeKey(feature.type) === featureTypeKey(patternFeatureTypeV3.type)
}

/** Prepares path Pattern content, or Sweep and Loft content through their own owner. */
export async function prepareSketchPathFeatureContent(input: PreparationInput) {
  return (await preparePathPatternFeatureContent(input)) ?? prepareSweepLoftFeatureContent(input)
}

/** Features whose content needs a solved sketch path: Sweep, Loft and path Pattern. */
export function shouldPrepareSketchPathFeatureContent(feature: FeatureRecord) {
  return shouldPrepareSweepLoftFeatureContent(feature) || isPathPatternFeature(feature)
}

function validateDependencies(input: PreparationInput, parameters: PatternFeatureParametersV3) {
  const expected = expectedPathPatternDependencyIds(input.document, parameters)
  const actual = input.feature.dependencies
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index]))
    return failure("dependency-owners-mismatch")
  const unavailable = expected.find(
    (id) => !input.features.some((feature) => feature.id === id && !feature.suppressed),
  )
  return unavailable ? failure("dependency-owner-unavailable", { featureId: unavailable }) : null
}

type Point2 = readonly [number, number]

/** Counterclockwise angle in [0, 2π) of a solved start point on the circle, or null. */
function startAngleOnCircle(start: Point2 | undefined, center: Point2, radius: number) {
  if (!start) return null
  const [dx, dy] = [start[0] - center[0], start[1] - center[1]]
  if (Math.abs(Math.hypot(dx, dy) - radius) > ON_CIRCLE_TOLERANCE) return null
  const angle = Math.atan2(dy, dx)
  const positive = angle < 0 ? angle + 2 * Math.PI : angle
  return positive >= 2 * Math.PI ? 0 : positive
}

/**
 * A lone sketch circle is a closed path. Its start is the sketch X direction from the center when
 * the selector names the center point, or the named solved point that lies on the circle.
 */
function circleGeometry(sketch: SketchRecord, solution: Solution, selector: SketchPathSelector) {
  const [entityId] = selector.entityIds
  const entity = sketch.entities.find(({ id }) => id === entityId)
  if (selector.entityIds.length !== 1 || entity?.type !== "circle") return null
  const points = new Map(solution.points.map(({ entityId: id, x, y }) => [id, [x, y] as const]))
  const center = points.get(entity.centerPointId)
  const radius = solution.circles.find((circle) => circle.entityId === entity.id)?.radius
  if (!center || !radius) return failure("path-curve-unsolved", { entityId: entity.id })
  const startAngle =
    selector.startPointId === entity.centerPointId
      ? 0
      : startAngleOnCircle(points.get(selector.startPointId), center, radius)
  if (startAngle === null)
    return failure("path-start-not-on-circle", { startPointId: selector.startPointId })
  const circle = { entityId: entity.id, type: "circle" as const, center, radius }
  return { ok: true as const, geometry: { kind: "circle" as const, circle, startAngle } }
}

function pathGeometry(sketch: SketchRecord, solution: Solution, selector: SketchPathSelector) {
  const circle = circleGeometry(sketch, solution, selector)
  if (circle) return circle
  const chain = materializeSelectedPath(sketch, solution, selector, true)
  if (!chain.ok) return asPatternFailure(chain)
  return {
    ok: true as const,
    geometry: { kind: "chain" as const, closed: chain.closed, segments: chain.segments },
  }
}

async function preparePathPattern(
  input: PreparationInput,
  parameters: PatternFeatureParametersV3,
): Promise<DocumentFeatureContentPreparationResult> {
  const invalid = validateDependencies(input, parameters)
  if (invalid) return invalid
  const solved = await solvedSketch(input, parameters.path.sketchId)
  if (!solved.ok) return asPatternFailure(solved)
  const geometry = pathGeometry(solved.sketch, solved.solution, parameters.path)
  if (!geometry.ok) return geometry
  const parsed = patternFeatureContentParametersV3Schema.safeParse({
    kind: parameters.kind,
    count: parameters.count.value,
    path: {
      sketchId: solved.sketch.id,
      ...(solved.sketch.support
        ? { supportFeatureId: solved.sketch.support.reference.featureId }
        : {}),
      frame: solved.frame,
      sourceEntityIds: [...parameters.path.entityIds],
      startPointId: parameters.path.startPointId,
      geometry: geometry.geometry,
    },
    spacing:
      parameters.spacing.mode === "equal"
        ? { mode: "equal" }
        : { mode: "fixed", distance: parameters.spacing.distance.value },
    startOffset: parameters.startOffset.value,
    orientation: parameters.orientation,
    reverse: parameters.reverse,
  })
  return parsed.success
    ? { ok: true, parameters: parsed.data }
    : failure("invalid-materialized-path", {
        issue: parsed.error.issues[0]?.message ?? "unknown-schema-issue",
      })
}

/** Resolves the authored sketch path now; the kernel receives only directed analytical curves. */
async function preparePathPatternFeatureContent(
  input: PreparationInput,
): Promise<DocumentFeatureContentPreparationResult | null> {
  if (!isPathPatternFeature(input.feature)) return null
  const parameters = readPatternFeatureParametersV3(input.feature)
  if (parameters) return preparePathPattern(input, parameters)
  const invalid = patternFeatureParametersV3Schema.safeParse(input.feature.parameters)
  return failure("invalid-authored-parameters", {
    issue: invalid.success
      ? "unknown-schema-issue"
      : (invalid.error.issues[0]?.message ?? "unknown-schema-issue"),
  })
}
