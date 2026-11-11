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
import { materializeSelectedPath, type PreparationInput, solvedSketch } from "./sweep-loft-content"

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

export function isPathPatternFeature(feature: FeatureRecord) {
  return featureTypeKey(feature.type) === featureTypeKey(patternFeatureTypeV3.type)
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
  const circle = { entityId: entity.id, type: "circle" as const, center, radius }
  if (selector.startPointId === entity.centerPointId)
    return { ok: true as const, geometry: { kind: "circle" as const, circle, startAngle: 0 } }
  const start = points.get(selector.startPointId)
  if (
    !start ||
    Math.abs(Math.hypot(start[0] - center[0], start[1] - center[1]) - radius) > ON_CIRCLE_TOLERANCE
  )
    return failure("path-start-not-on-circle", { startPointId: selector.startPointId })
  const angle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const startAngle = angle < 0 ? angle + 2 * Math.PI : angle
  return {
    ok: true as const,
    geometry: {
      kind: "circle" as const,
      circle,
      startAngle: startAngle >= 2 * Math.PI ? 0 : startAngle,
    },
  }
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
export async function preparePathPatternFeatureContent(
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
