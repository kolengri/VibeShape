import {
  type DocumentFeatureContentPreparationResult,
  expectedSketchFeatureDependencyIds,
  type FeatureGeometryRecord,
} from "@vibeshape/application/feature-rebuild"
import { type SupportFrame, sketchFrame } from "@vibeshape/application/support-frame"
import type {
  DocumentSnapshot,
  FeatureRecord,
  SketchEntity,
  SketchProfileSelector,
  SketchRecord,
} from "@vibeshape/domain"
import { featureTypeKey } from "@vibeshape/domain/feature-type-contracts"
import {
  loftFeatureParametersSchema,
  loftFeatureParametersV2Schema,
  loftFeatureType,
  loftFeatureTypeV2,
  MAX_LOFT_SECTIONS,
  readLoftFeatureParameters,
} from "@vibeshape/domain/part-design-loft"
import {
  type LoftFeatureParametersV3,
  loftFeatureParametersV3Schema,
  loftFeatureTypeV3,
  loftV3SketchIds,
  loftV3SupportBodies,
  MAX_LOFT_V3_DEPENDENCIES,
  readLoftFeatureParametersV3,
} from "@vibeshape/domain/part-design-loft-v3"
import {
  readSweepFeatureParameters,
  sweepFeatureParametersSchema,
  sweepFeatureType,
} from "@vibeshape/domain/part-design-sweep"
import { isSketchExternalModelReference } from "@vibeshape/domain/sketch"
import type { SketchPathSelector } from "@vibeshape/domain/sketch-path-selector"
import type { AnalyticalSweepPathContent } from "@vibeshape/protocol"
import {
  analyticalProfileSchema,
  analyticalSweepPathSchema,
  type LoftFeatureContentParametersV3,
  loftFeatureContentParametersSchema,
  loftFeatureContentParametersV2Schema,
  loftFeatureContentParametersV3Schema,
  sweepFeatureContentParametersSchema,
} from "@vibeshape/protocol"
import type { SolveSketchRecordResult } from "@vibeshape/sketch-solver"
import { isError } from "is-what"
import {
  materializeDirectedSketchCurve,
  materializeSelectedProfile,
} from "./analytical-profile-content"

type Solution = Extract<SolveSketchRecordResult, { ok: true }>["solution"]
type Failure = Extract<DocumentFeatureContentPreparationResult, { ok: false }>
type SolvedSketch = Readonly<{ ok: true; solution: Solution }> | Failure
type PreparationInput = Readonly<{
  document: DocumentSnapshot
  feature: FeatureRecord
  features: readonly FeatureRecord[]
  geometry: readonly FeatureGeometryRecord[]
  solveSketch: (sketch: SketchRecord) => Promise<SolvedSketch>
}>

function failure(reason: string, values: Readonly<Record<string, string | number>> = {}): Failure {
  return {
    ok: false,
    diagnostic: { code: "org.vibeshape.feature.sweep-loft-invalid", values: { reason, ...values } },
  }
}

export function shouldPrepareSweepLoftFeatureContent(feature: FeatureRecord) {
  const key = featureTypeKey(feature.type)
  return (
    key === featureTypeKey(loftFeatureType.type) ||
    key === featureTypeKey(loftFeatureTypeV2.type) ||
    key === featureTypeKey(loftFeatureTypeV3.type) ||
    key === featureTypeKey(sweepFeatureType.type)
  )
}

function validateDependencies(
  input: PreparationInput,
  sketchIds: readonly string[],
  additionalOwners: readonly FeatureRecord["id"][] = [],
) {
  const expected = expectedSketchFeatureDependencyIds(input.document, sketchIds, [
    ...input.feature.references.map(({ featureId }) => featureId),
    ...additionalOwners,
  ])
  const limit = readLoftFeatureParametersV3(input.feature)
    ? MAX_LOFT_V3_DEPENDENCIES
    : readLoftFeatureParameters(input.feature)
      ? MAX_LOFT_SECTIONS
      : 8
  if (expected.length > limit)
    return failure("dependency-budget-exceeded", { count: expected.length })
  if (
    expected.length !== input.feature.dependencies.length ||
    expected.some((id, index) => id !== input.feature.dependencies[index])
  )
    return failure("dependency-owners-mismatch")
  const unavailableOwner = expected.find(
    (id) => !input.features.some((feature) => feature.id === id && !feature.suppressed),
  )
  return unavailableOwner
    ? failure("dependency-owner-unavailable", { featureId: unavailableOwner })
    : null
}

async function solvedSketch(
  input: PreparationInput,
  sketchId: string,
  visiting = new Set<string>(),
): Promise<
  Failure | Readonly<{ ok: true; sketch: SketchRecord; frame: SupportFrame; solution: Solution }>
> {
  if (visiting.has(sketchId)) return failure("external-source-cycle", { sketchId })
  const sketch = input.document.sketches.find(({ id }) => id === sketchId)
  if (!sketch) return failure("sketch-not-found", { sketchId })
  const frame = sketchFrame(sketch, input.document, input.features, new Set(), input.geometry)
  if (!frame) return failure("sketch-support-unresolved", { sketchId })
  // The legacy external resolver can fall back to authored source points. Validate every source first.
  for (const reference of sketch.externalReferences ?? []) {
    if (isSketchExternalModelReference(reference)) continue
    const source = await solvedSketch(
      input,
      reference.sourceSketchId,
      new Set([...visiting, sketchId]),
    )
    if (!source.ok) return source
  }
  const solved = await solveCurrentSketch(input, sketch)
  if (!solved.ok) return solved
  return { ok: true as const, sketch, frame, solution: solved.solution }
}

function validateSolvedSketch(
  solved: SolvedSketch,
  sketchId: string,
  revision: number,
): SolvedSketch {
  if (!solved.ok) return solved
  if (solved.solution.sketchId !== sketchId)
    return failure("solution-sketch-mismatch", { sketchId })
  if (solved.solution.sourceRevision !== revision)
    return failure("solution-revision-mismatch", { sketchId })
  if (
    solved.solution.status !== "fully-constrained" &&
    solved.solution.status !== "under-constrained"
  )
    return failure("solution-status-unsupported", { sketchId, status: solved.solution.status })
  return solved
}

async function solveCurrentSketch(
  input: PreparationInput,
  sketch: SketchRecord,
): Promise<SolvedSketch> {
  try {
    return validateSolvedSketch(await input.solveSketch(sketch), sketch.id, input.document.revision)
  } catch (error) {
    return failure("sketch-solve-or-external-reference-failed", {
      sketchId: sketch.id,
      message: isError(error) ? error.message : String(error),
    })
  }
}

async function prepareProfile(input: PreparationInput, selector: SketchProfileSelector) {
  const solved = await solvedSketch(input, selector.sketchId)
  if (!solved.ok) return solved
  const profile = materializeSelectedProfile(solved.sketch, solved.solution, selector)
  if (!profile.ok) return profile
  const parsed = analyticalProfileSchema.safeParse({
    sketchId: solved.sketch.id,
    ...(solved.sketch.support
      ? { supportFeatureId: solved.sketch.support.reference.featureId }
      : {}),
    frame: solved.frame,
    outer: profile.outer,
    holes: profile.holes,
  })
  return parsed.success
    ? { ok: true as const, profile: parsed.data }
    : failure("invalid-materialized-profile", {
        issue: parsed.error.issues[0]?.message ?? "unknown-schema-issue",
      })
}

type PathSegment = NonNullable<ReturnType<typeof materializeDirectedSketchCurve>>
type Endpoint = Readonly<{
  segmentIndex: number
  start: boolean
  pointId: string
  point: readonly [number, number]
}>

function endpointsNear(left: Endpoint, right: Endpoint) {
  return Math.hypot(left.point[0] - right.point[0], left.point[1] - right.point[1]) <= 1e-6
}

function invalidPathCurve(
  curve: PathSegment,
  entity: Extract<SketchEntity, { type: "line" | "arc" | "cubic-bezier" | "elliptical-arc" }>,
  points: ReadonlyMap<string, Readonly<{ x: number; y: number }>>,
) {
  if (Math.hypot(curve.end[0] - curve.start[0], curve.end[1] - curve.start[1]) <= 1e-6)
    return failure("path-curve-degenerate", { entityId: entity.id })
  if (entity.type !== "arc") return null
  const center = points.get(entity.centerPointId)
  if (!center) return failure("path-curve-unsolved", { entityId: entity.id })
  const startRadius = Math.hypot(curve.start[0] - center.x, curve.start[1] - center.y)
  const endRadius = Math.hypot(curve.end[0] - center.x, curve.end[1] - center.y)
  return startRadius <= 1e-6 || Math.abs(startRadius - endRadius) > 1e-6
    ? failure("path-arc-radius-mismatch", { entityId: entity.id })
    : null
}

function selectedPathCurves(
  sketch: SketchRecord,
  solution: Solution,
  selector: SketchPathSelector,
) {
  const points = new Map(solution.points.map(({ entityId, x, y }) => [entityId, { x, y }] as const))
  const curves: PathSegment[] = []
  for (const id of selector.entityIds) {
    const entity = sketch.entities.find((candidate) => candidate.id === id)
    if (
      !entity ||
      (entity.type !== "line" &&
        entity.type !== "arc" &&
        entity.type !== "cubic-bezier" &&
        entity.type !== "elliptical-arc")
    )
      return failure("path-curve-unavailable", { entityId: id })
    const curve = materializeDirectedSketchCurve(entity, false, points)
    if (!curve) return failure("path-curve-unsolved", { entityId: id })
    const invalid = invalidPathCurve(curve, entity, points)
    if (invalid) return invalid
    curves.push(curve)
  }
  return { ok: true as const, curves }
}

function pathEndpoints(curves: readonly PathSegment[], startPointId: string) {
  const endpoints: Endpoint[] = curves.flatMap((curve, segmentIndex) => [
    { segmentIndex, start: true, pointId: curve.startPointId, point: curve.start },
    { segmentIndex, start: false, pointId: curve.endPointId, point: curve.end },
  ])
  const neighbors = endpoints.map((endpoint) =>
    endpoints.filter((other) => endpointsNear(endpoint, other)),
  )
  if (neighbors.some((joined) => joined.length > 2))
    return failure("path-branch-or-revisited-endpoint")
  const terminals = endpoints.filter((_, index) => neighbors[index]?.length === 1)
  if (terminals.length !== 2) return failure("path-disconnected-or-closed")
  const start = terminals.find(({ pointId }) => pointId === startPointId)
  return start
    ? { ok: true as const, start, endpoints }
    : failure("path-start-not-terminal", { startPointId })
}

function reversePathCurve(curve: PathSegment): PathSegment {
  const reversed = {
    ...curve,
    startPointId: curve.endPointId,
    endPointId: curve.startPointId,
    start: curve.end,
    end: curve.start,
  }
  if (curve.type === "cubic-bezier")
    return {
      ...curve,
      ...reversed,
      type: "cubic-bezier",
      control1: curve.control2,
      control2: curve.control1,
      control1PointId: curve.control2PointId,
      control2PointId: curve.control1PointId,
    }
  if (curve.type === "elliptical-arc")
    return {
      ...curve,
      ...reversed,
      type: "elliptical-arc",
      secondaryAxisPoint: [
        2 * curve.center[0] - curve.secondaryAxisPoint[0],
        2 * curve.center[1] - curve.secondaryAxisPoint[1],
      ],
    }
  return reversed
}

function traversePath(
  curves: readonly PathSegment[],
  endpoints: readonly Endpoint[],
  start: Endpoint,
) {
  const used = new Set<number>()
  const segments: PathSegment[] = []
  let endpoint: Endpoint | undefined = start
  while (endpoint) {
    const curve = curves[endpoint.segmentIndex]
    if (!curve || used.has(endpoint.segmentIndex)) return failure("path-curve-revisited")
    used.add(endpoint.segmentIndex)
    segments.push(endpoint.start ? curve : reversePathCurve(curve))
    const end: Endpoint | undefined =
      endpoints[endpoint.segmentIndex * 2 + (endpoint.start ? 1 : 0)]
    if (!end) return failure("path-endpoint-unavailable")
    const next: Endpoint[] = endpoints.filter(
      (other) => !used.has(other.segmentIndex) && endpointsNear(end, other),
    )
    if (next.length > 1) return failure("path-branch-or-revisited-endpoint")
    endpoint = next[0]
  }
  return used.size === curves.length
    ? { ok: true as const, segments }
    : failure("path-disconnected-or-closed")
}

/** Solved coincident endpoints may have distinct authored point IDs. No polyline is introduced. */
export function materializeSelectedPath(
  sketch: SketchRecord,
  solution: Solution,
  selector: SketchPathSelector,
) {
  if (selector.sketchId !== sketch.id) return failure("path-sketch-mismatch")
  if (new Set(selector.entityIds).size !== selector.entityIds.length)
    return failure("path-curve-duplicate")
  const selected = selectedPathCurves(sketch, solution, selector)
  if (!selected.ok) return selected
  const endpoints = pathEndpoints(selected.curves, selector.startPointId)
  if (!endpoints.ok) return endpoints
  const directed = traversePath(selected.curves, endpoints.endpoints, endpoints.start)
  return directed.ok ? { ...directed, sourceEntityIds: [...selector.entityIds] } : directed
}

async function preparePath(input: PreparationInput, selector: SketchPathSelector) {
  const solved = await solvedSketch(input, selector.sketchId)
  if (!solved.ok) return solved
  const path = materializeSelectedPath(solved.sketch, solved.solution, selector)
  if (!path.ok) return path
  const parsed = analyticalSweepPathSchema.safeParse({
    sketchId: solved.sketch.id,
    ...(solved.sketch.support
      ? { supportFeatureId: solved.sketch.support.reference.featureId }
      : {}),
    frame: solved.frame,
    sourceEntityIds: path.sourceEntityIds,
    segments: path.segments,
    startPointId: selector.startPointId,
  })
  return parsed.success
    ? { ok: true as const, path: parsed.data }
    : failure("invalid-materialized-path", {
        issue: parsed.error.issues[0]?.message ?? "unknown-schema-issue",
      })
}

function parseLoftContent(
  loft: NonNullable<ReturnType<typeof readLoftFeatureParameters>>,
  sections: Parameters<typeof loftFeatureContentParametersSchema.parse>[0],
) {
  return "holeCorrespondence" in loft
    ? loftFeatureContentParametersV2Schema.safeParse({
        sections,
        ruled: loft.ruled,
        holeCorrespondence: loft.holeCorrespondence,
      })
    : loftFeatureContentParametersSchema.safeParse({ sections, ruled: loft.ruled })
}

async function prepareLoft(
  input: PreparationInput,
  loft: NonNullable<ReturnType<typeof readLoftFeatureParameters>>,
): Promise<DocumentFeatureContentPreparationResult> {
  const invalidDependencies = validateDependencies(
    input,
    loft.sections.map(({ sketchId }) => sketchId),
  )
  if (invalidDependencies) return invalidDependencies
  const sections = []
  for (const selector of loft.sections) {
    const section = await prepareProfile(input, selector)
    if (!section.ok) return section
    if (section.profile.holes.length && !("holeCorrespondence" in loft))
      return failure("loft-holes-unsupported")
    sections.push(section.profile)
  }
  const parsed = parseLoftContent(loft, sections)
  return parsed.success
    ? { ok: true, parameters: parsed.data }
    : failure("invalid-materialized-loft", {
        issue: parsed.error.issues[0]?.message ?? "unknown-schema-issue",
      })
}

async function prepareLoftPaths<T extends { path: SketchPathSelector }>(
  input: PreparationInput,
  entries: readonly T[],
): Promise<
  Failure | { ok: true; entries: (Omit<T, "path"> & { path: AnalyticalSweepPathContent })[] }
> {
  const result: (Omit<T, "path"> & { path: AnalyticalSweepPathContent })[] = []
  for (const entry of entries) {
    const path = await preparePath(input, entry.path)
    if (!path.ok) return path
    result.push({ ...entry, path: path.path })
  }
  return { ok: true, entries: result }
}

async function prepareConstrainedLoft(
  input: PreparationInput,
  loft: LoftFeatureParametersV3,
): Promise<DocumentFeatureContentPreparationResult> {
  const invalid = validateDependencies(
    input,
    loftV3SketchIds(loft),
    loftV3SupportBodies(loft).map(({ featureId }) => featureId),
  )
  if (invalid) return invalid
  const sections = []
  for (const selector of loft.sections) {
    const result = await prepareProfile(input, selector)
    if (!result.ok) return result
    sections.push(result.profile)
  }
  const rails = await prepareLoftPaths(input, loft.rails)
  if (!rails.ok) return rails
  const guides = await prepareLoftPaths(input, loft.guides)
  if (!guides.ok) return guides
  const materializeEnd = (
    entries: LoftFeatureParametersV3["start"],
  ): LoftFeatureContentParametersV3["start"] =>
    entries.map(({ support: { featureId, ...support }, ...condition }) => ({
      ...condition,
      support,
      supportInputIndex: input.feature.dependencies.indexOf(featureId),
    }))
  const parsed = loftFeatureContentParametersV3Schema.safeParse({
    ...loft,
    sections,
    rails: rails.entries,
    guides: guides.entries,
    start: materializeEnd(loft.start),
    end: materializeEnd(loft.end),
  })
  return parsed.success
    ? { ok: true, parameters: parsed.data }
    : failure("invalid-materialized-constrained-loft", {
        issue: parsed.error.issues[0]?.message ?? "unknown-schema-issue",
      })
}

async function prepareSweep(
  input: PreparationInput,
  sweep: NonNullable<ReturnType<typeof readSweepFeatureParameters>>,
): Promise<DocumentFeatureContentPreparationResult> {
  const invalidDependencies = validateDependencies(input, [
    sweep.profile.sketchId,
    sweep.path.sketchId,
  ])
  if (invalidDependencies) return invalidDependencies
  const profile = await prepareProfile(input, sweep.profile)
  if (!profile.ok) return profile
  const path = await preparePath(input, sweep.path)
  if (!path.ok) return path
  const parsed = sweepFeatureContentParametersSchema.safeParse({
    profile: profile.profile,
    path: path.path,
  })
  return parsed.success
    ? { ok: true, parameters: parsed.data }
    : failure("invalid-materialized-sweep", {
        issue: parsed.error.issues[0]?.message ?? "unknown-schema-issue",
      })
}

export async function prepareSweepLoftFeatureContent(
  input: PreparationInput,
): Promise<DocumentFeatureContentPreparationResult | null> {
  if (!shouldPrepareSweepLoftFeatureContent(input.feature)) return null
  const constrainedLoft = readLoftFeatureParametersV3(input.feature)
  if (constrainedLoft) return prepareConstrainedLoft(input, constrainedLoft)
  const loft = readLoftFeatureParameters(input.feature)
  if (loft) return prepareLoft(input, loft)
  const sweep = readSweepFeatureParameters(input.feature)
  if (sweep) return prepareSweep(input, sweep)
  const key = featureTypeKey(input.feature.type)
  const schema =
    key === featureTypeKey(loftFeatureTypeV3.type)
      ? loftFeatureParametersV3Schema
      : key === featureTypeKey(loftFeatureTypeV2.type)
        ? loftFeatureParametersV2Schema
        : key === featureTypeKey(loftFeatureType.type)
          ? loftFeatureParametersSchema
          : sweepFeatureParametersSchema
  const invalid = schema.safeParse(input.feature.parameters)
  return failure("invalid-authored-parameters", {
    issue: invalid.success
      ? "unknown-schema-issue"
      : (invalid.error.issues[0]?.message ?? "unknown-schema-issue"),
  })
}
