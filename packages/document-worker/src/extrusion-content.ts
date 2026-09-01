import type {
  DocumentFeatureContentPreparationPort,
  DocumentFeatureContentPreparationResult,
  FeatureGeometryRecord,
} from "@vibeshape/application/feature-rebuild"
import {
  datumPlaneFrame,
  type SupportFrame,
  sketchFrame,
  supportPointToWorld,
} from "@vibeshape/application/support-frame"
import {
  type DocumentSnapshot,
  type EdgeTopoRef,
  type FeatureRecord,
  readDatumPlaneFeatureParameters,
  readExtrusionFeatureParameters,
  readRevolveFeatureParameters,
  resolveTopologyReference,
  type SketchEntity,
  type SketchProfileSelector,
  type SketchProfileSet,
  type SketchRecord,
} from "@vibeshape/domain"
import type { TopologyCandidate as ProtocolTopologyCandidate } from "@vibeshape/protocol"
import {
  datumPlaneFeatureContentParametersSchema,
  extrusionFeatureContentParametersSchema,
  extrusionMultiProfileFeatureContentParametersSchema,
  extrusionMultiProfileModifyingFeatureContentParametersSchema,
  revolveFeatureContentParametersSchema,
  revolveMultiProfileFeatureContentParametersSchema,
  revolveMultiProfileModifyingFeatureContentParametersSchema,
} from "@vibeshape/protocol"
import {
  resolveSketchProfileSelector,
  type SketchProfileLoop,
  type SolveSketchRecordResult,
} from "@vibeshape/sketch-solver"
import {
  type ExternalModelMaterializationCache,
  type PlanarFaceSectionPort,
  resolveExternalSketchGeometry,
  type SketchSolveCache,
} from "./external-sketch-references"
import type { SketchSolvePort } from "./runtime"

const TWO_PI = Math.PI * 2

function failure(
  code: string,
  reason: string,
  values: Readonly<Record<string, string | number>> = {},
): Extract<DocumentFeatureContentPreparationResult, { ok: false }> {
  return { ok: false, diagnostic: { code, values: { reason, ...values } } }
}

function normalizedPositiveAngle(angle: number) {
  const normalized = angle % TWO_PI
  return normalized < 0 ? normalized + TWO_PI : normalized
}

function solvedPoint(
  points: ReadonlyMap<string, Readonly<{ x: number; y: number }>>,
  entityId: string,
) {
  return points.get(entityId) ?? null
}

type SolvedPoint = NonNullable<ReturnType<typeof solvedPoint>>

function allPointsSolved(points: Array<SolvedPoint | null>): points is SolvedPoint[] {
  return points.every((point) => point !== null)
}

function lineSegment(
  entity: Extract<SketchEntity, { type: "line" }>,
  reversed: boolean,
  points: ReadonlyMap<string, Readonly<{ x: number; y: number }>>,
) {
  const first = solvedPoint(points, entity.startPointId)
  const second = solvedPoint(points, entity.endPointId)
  if (!first || !second) return null
  const start = reversed ? second : first
  const end = reversed ? first : second
  return {
    entityId: entity.id,
    type: "line" as const,
    startPointId: reversed ? entity.endPointId : entity.startPointId,
    endPointId: reversed ? entity.startPointId : entity.endPointId,
    start: [start.x, start.y] as const,
    end: [end.x, end.y] as const,
  }
}

function arcSegment(
  entity: Extract<SketchEntity, { type: "arc" }>,
  reversed: boolean,
  points: ReadonlyMap<string, Readonly<{ x: number; y: number }>>,
) {
  const center = solvedPoint(points, entity.centerPointId)
  const first = solvedPoint(points, entity.startPointId)
  const second = solvedPoint(points, entity.endPointId)
  if (!center || !first || !second) return null
  const startAngle = Math.atan2(first.y - center.y, first.x - center.x)
  const endAngle = Math.atan2(second.y - center.y, second.x - center.x)
  const sweep = normalizedPositiveAngle(endAngle - startAngle) || TWO_PI
  const radius = Math.hypot(first.x - center.x, first.y - center.y)
  const middleAngle = startAngle + sweep / 2
  const middle = [
    center.x + radius * Math.cos(middleAngle),
    center.y + radius * Math.sin(middleAngle),
  ] as const
  const start = reversed ? second : first
  const end = reversed ? first : second
  return {
    entityId: entity.id,
    type: "arc" as const,
    startPointId: reversed ? entity.endPointId : entity.startPointId,
    endPointId: reversed ? entity.startPointId : entity.endPointId,
    start: [start.x, start.y] as const,
    middle,
    end: [end.x, end.y] as const,
  }
}

function circleSegment(
  entity: Extract<SketchEntity, { type: "circle" }>,
  points: ReadonlyMap<string, Readonly<{ x: number; y: number }>>,
  radii: ReadonlyMap<string, number>,
) {
  const center = solvedPoint(points, entity.centerPointId)
  const radius = radii.get(entity.id)
  return center && radius
    ? {
        entityId: entity.id,
        type: "circle" as const,
        center: [center.x, center.y] as const,
        radius,
      }
    : null
}

function ellipseSegment(
  entity: Extract<SketchEntity, { type: "ellipse" }>,
  points: ReadonlyMap<string, Readonly<{ x: number; y: number }>>,
) {
  const center = solvedPoint(points, entity.centerPointId)
  const primaryAxisPoint = solvedPoint(points, entity.primaryAxisPointId)
  const secondaryAxisPoint = solvedPoint(points, entity.secondaryAxisPointId)
  return center && primaryAxisPoint && secondaryAxisPoint
    ? {
        entityId: entity.id,
        type: "ellipse" as const,
        center: [center.x, center.y] as const,
        primaryAxisPoint: [primaryAxisPoint.x, primaryAxisPoint.y] as const,
        secondaryAxisPoint: [secondaryAxisPoint.x, secondaryAxisPoint.y] as const,
      }
    : null
}

function ellipticalArcSegment(
  entity: Extract<SketchEntity, { type: "elliptical-arc" }>,
  reversed: boolean,
  points: ReadonlyMap<string, Readonly<{ x: number; y: number }>>,
) {
  const solved = [
    solvedPoint(points, entity.centerPointId),
    solvedPoint(points, entity.primaryAxisPointId),
    solvedPoint(points, entity.secondaryAxisPointId),
    solvedPoint(points, entity.startPointId),
    solvedPoint(points, entity.endPointId),
  ]
  if (!allPointsSolved(solved)) return null
  const [center, primaryAxisPoint, secondaryAxisPoint, first, second] = solved as [
    SolvedPoint,
    SolvedPoint,
    SolvedPoint,
    SolvedPoint,
    SolvedPoint,
  ]
  const start = reversed ? second : first
  const end = reversed ? first : second
  return {
    entityId: entity.id,
    type: "elliptical-arc" as const,
    startPointId: reversed ? entity.endPointId : entity.startPointId,
    endPointId: reversed ? entity.startPointId : entity.endPointId,
    center: [center.x, center.y] as const,
    primaryAxisPoint: [primaryAxisPoint.x, primaryAxisPoint.y] as const,
    secondaryAxisPoint: [secondaryAxisPoint.x, secondaryAxisPoint.y] as const,
    start: [start.x, start.y] as const,
    end: [end.x, end.y] as const,
  }
}

function materializeLoop(
  loop: SketchProfileLoop,
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
) {
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]))
  const points = new Map(solution.points.map(({ entityId, x, y }) => [entityId, { x, y }] as const))
  const radii = new Map(solution.circles.map(({ entityId, radius }) => [entityId, radius] as const))
  const segments = loop.segments.map((segment) => {
    const entity = entities.get(segment.entityId)
    if (!entity || entity.type !== segment.type) return null
    if (entity.type === "line") return lineSegment(entity, segment.reversed, points)
    if (entity.type === "arc") return arcSegment(entity, segment.reversed, points)
    if (entity.type === "circle") return circleSegment(entity, points, radii)
    if (entity.type === "ellipse") return ellipseSegment(entity, points)
    if (entity.type === "elliptical-arc") {
      return ellipticalArcSegment(entity, segment.reversed, points)
    }
    return null
  })
  if (segments.some((segment) => segment === null)) return null
  return {
    sourceEntityIds: [...loop.sourceEntityIds].sort(),
    segments: segments.flatMap((segment) => (segment ? [segment] : [])),
  }
}

function materializeSelectedProfile(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  profile: NonNullable<ReturnType<typeof readExtrusionFeatureParameters>>["profile"],
) {
  const resolution = resolveSketchProfileSelector(profile, sketch.id, solution.profileResult)
  if (resolution.status === "ambiguous") {
    return failure("org.vibeshape.feature.sketch-profile-ambiguous", "ambiguous-profile", {
      matchCount: resolution.profileIndices.length,
    })
  }
  if (resolution.status === "missing") {
    return failure("org.vibeshape.feature.sketch-profile-missing", resolution.reason)
  }
  const outerLoop = solution.profileResult.loops[resolution.outerLoopIndex]
  const holeLoops = resolution.holeLoopIndices.map(
    (loopIndex) => solution.profileResult.loops[loopIndex],
  )
  if (!outerLoop || holeLoops.some((loop) => loop === undefined)) {
    return failure("org.vibeshape.feature.sketch-profile-missing", "invalid-loop-reference")
  }
  const outer = materializeLoop(outerLoop, sketch, solution)
  const holes = holeLoops.map((loop) => (loop ? materializeLoop(loop, sketch, solution) : null))
  if (!outer || holes.some((hole) => hole === null)) {
    return failure("org.vibeshape.feature.sketch-profile-invalid", "missing-solved-geometry")
  }
  return { ok: true as const, outer, holes: holes.flatMap((hole) => (hole ? [hole] : [])) }
}

/**
 * Materialize each authored selector separately. The profile-set schema owns
 * canonical ordering and bounds; this function deliberately does not merge
 * adjacent loops or infer a replacement selector.
 */
function materializeSelectedProfiles(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  selectors: readonly SketchProfileSelector[],
) {
  if (selectors.some((selector) => selector.sketchId !== sketch.id)) {
    return failure("org.vibeshape.feature.sketch-profile-invalid", "multi-profile-sketch-mismatch")
  }
  const profiles = selectors.map((selector) =>
    materializeSelectedProfile(sketch, solution, selector),
  )
  const failed = profiles.find((profile) => !profile.ok)
  return (
    failed ?? {
      ok: true as const,
      profiles: profiles.flatMap((profile) =>
        profile.ok ? [{ outer: profile.outer, holes: profile.holes }] : [],
      ),
    }
  )
}

type MultiProfileParameters = Readonly<{
  profiles: SketchProfileSet
  distance?: { readonly value: number }
  symmetric?: boolean
  angle?: { readonly value: number }
  operation: "new" | "add" | "remove" | "intersect"
  axis?: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>["axis"]
}>

function prepareExtrusion(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  parameters: NonNullable<ReturnType<typeof readExtrusionFeatureParameters>>,
  frame: SupportFrame,
) {
  const profile = materializeSelectedProfile(sketch, solution, parameters.profile)
  if (!profile.ok) return profile
  const prepared = extrusionFeatureContentParametersSchema.safeParse({
    sketchId: sketch.id,
    ...(sketch.support ? { supportFeatureId: sketch.support.reference.featureId } : {}),
    frame,
    outer: profile.outer,
    holes: profile.holes,
    distance: parameters.distance.value,
    symmetric: parameters.symmetric,
    operation: parameters.operation,
  })
  return prepared.success
    ? ({ ok: true, parameters: prepared.data } as const)
    : failure("org.vibeshape.feature.sketch-profile-invalid", "invalid-materialized-profile")
}

function prepareMultiExtrusion(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  parameters: MultiProfileParameters,
  frame: SupportFrame,
) {
  if (!parameters.distance || parameters.symmetric === undefined) {
    return failure("org.vibeshape.feature.sketch-profile-invalid", "invalid-multi-profile-input")
  }
  const profiles = materializeSelectedProfiles(sketch, solution, parameters.profiles.profiles)
  if (!profiles.ok) return profiles
  const content = {
    sketchId: sketch.id,
    ...(sketch.support ? { supportFeatureId: sketch.support.reference.featureId } : {}),
    frame,
    profiles: profiles.profiles,
    distance: parameters.distance.value,
    symmetric: parameters.symmetric,
    operation: parameters.operation,
  }
  const prepared =
    parameters.operation === "new"
      ? extrusionMultiProfileFeatureContentParametersSchema.safeParse(content)
      : extrusionMultiProfileModifyingFeatureContentParametersSchema.safeParse(content)
  return prepared.success
    ? ({ ok: true, parameters: prepared.data as never } as const)
    : failure("org.vibeshape.feature.sketch-profile-invalid", "invalid-materialized-profile-set", {
        issue: prepared.error.issues[0]?.message ?? "unknown-schema-issue",
      })
}

function prepareRevolve(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  parameters: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>,
  frame: SupportFrame,
  geometry: readonly FeatureGeometryRecord[],
) {
  const profile = materializeSelectedProfile(sketch, solution, parameters.profile)
  if (!profile.ok) return profile
  const resolvedAxis = resolveRevolveAxis(sketch, solution, parameters.axis, frame, geometry)
  if (!resolvedAxis.ok) return resolvedAxis
  const prepared = revolveFeatureContentParametersSchema.safeParse({
    sketchId: sketch.id,
    ...(sketch.support ? { supportFeatureId: sketch.support.reference.featureId } : {}),
    frame,
    outer: profile.outer,
    holes: profile.holes,
    axis: parameters.axis,
    axisOrigin: resolvedAxis.origin,
    axisDirection: resolvedAxis.direction,
    angleRadians: parameters.angle.value,
    operation: parameters.operation,
  })
  return prepared.success
    ? ({ ok: true, parameters: prepared.data } as const)
    : failure("org.vibeshape.feature.sketch-profile-invalid", "invalid-materialized-profile")
}

function prepareMultiRevolve(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  parameters: MultiProfileParameters,
  frame: SupportFrame,
  geometry: readonly FeatureGeometryRecord[],
) {
  if (!parameters.angle || !parameters.axis) {
    return failure("org.vibeshape.feature.sketch-profile-invalid", "invalid-multi-profile-input")
  }
  const profiles = materializeSelectedProfiles(sketch, solution, parameters.profiles.profiles)
  if (!profiles.ok) return profiles
  const resolvedAxis = resolveRevolveAxis(sketch, solution, parameters.axis, frame, geometry)
  if (!resolvedAxis.ok) return resolvedAxis
  const content = {
    sketchId: sketch.id,
    ...(sketch.support ? { supportFeatureId: sketch.support.reference.featureId } : {}),
    frame,
    profiles: profiles.profiles,
    axis: parameters.axis,
    axisOrigin: resolvedAxis.origin,
    axisDirection: resolvedAxis.direction,
    angleRadians: parameters.angle.value,
    operation: parameters.operation,
  }
  const prepared =
    parameters.operation === "new"
      ? revolveMultiProfileFeatureContentParametersSchema.safeParse(content)
      : revolveMultiProfileModifyingFeatureContentParametersSchema.safeParse(content)
  return prepared.success
    ? ({ ok: true, parameters: prepared.data as never } as const)
    : failure("org.vibeshape.feature.sketch-profile-invalid", "invalid-materialized-profile-set")
}

function resolveRevolveAxis(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  axis: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>["axis"],
  frame: SupportFrame,
  geometry: readonly FeatureGeometryRecord[],
) {
  if (axis.kind === "origin-axis") {
    return {
      ok: true as const,
      origin: frame.origin,
      direction: axis.axis === "x" ? frame.xAxis : frame.yAxis,
    }
  }
  if (axis.kind === "model-edge") {
    return resolveModelEdgeRevolveAxis(axis.reference, frame, geometry)
  }
  return resolveSketchLineRevolveAxis(sketch, solution, axis, frame)
}

function domainTopologyCandidate(candidate: ProtocolTopologyCandidate) {
  const { referenceGeometry: _referenceGeometry, ...domainCandidate } = candidate
  return domainCandidate
}

function resolveModelEdgeRevolveAxis(
  reference: EdgeTopoRef,
  frame: SupportFrame,
  geometry: readonly FeatureGeometryRecord[],
) {
  const resolved = resolveModelEdgeCandidate(reference, geometry)
  if (!resolved.ok) return resolved
  return lineCandidateAxis(resolved.candidate, frame)
}

function resolveModelEdgeCandidate(
  reference: EdgeTopoRef,
  geometry: readonly FeatureGeometryRecord[],
) {
  const record = geometry.find(({ featureId }) => featureId === reference.featureId)
  if (!record) {
    return failure(
      "org.vibeshape.feature.sketch-profile-invalid",
      "revolve-axis-model-edge-unavailable",
    )
  }
  const resolution = resolveTopologyReference(
    reference,
    record.geometry.topologyCandidates.map(domainTopologyCandidate),
  )
  if (resolution.status !== "resolved") {
    return failure(
      "org.vibeshape.feature.sketch-profile-invalid",
      `revolve-axis-model-edge-${resolution.status}`,
    )
  }
  const candidate = record.geometry.topologyCandidates.find(
    ({ candidateId }) => candidateId === resolution.candidateId,
  )
  if (
    candidate?.kind !== "edge" ||
    candidate.signature.geometryClass !== "LINE" ||
    candidate.referenceGeometry?.kind !== "line-edge"
  ) {
    return failure(
      "org.vibeshape.feature.sketch-profile-invalid",
      "revolve-axis-model-edge-wrong-type",
    )
  }
  return { ok: true as const, candidate }
}

function lineCandidateAxis(candidate: ProtocolTopologyCandidate, frame: SupportFrame) {
  if (candidate.referenceGeometry?.kind !== "line-edge") {
    return failure(
      "org.vibeshape.feature.sketch-profile-invalid",
      "revolve-axis-model-edge-wrong-type",
    )
  }
  const { start: origin, end } = candidate.referenceGeometry
  const delta = [end[0] - origin[0], end[1] - origin[1], end[2] - origin[2]] as const
  const length = Math.hypot(...delta)
  if (!(length > Number.EPSILON) || !Number.isFinite(length)) {
    return failure(
      "org.vibeshape.feature.sketch-profile-invalid",
      "revolve-axis-model-edge-degenerate",
    )
  }
  const direction = [delta[0] / length, delta[1] / length, delta[2] / length] as const
  if (!axisLiesInFrame(origin, direction, frame)) {
    return failure(
      "org.vibeshape.feature.sketch-profile-invalid",
      "revolve-axis-model-edge-noncoplanar",
    )
  }
  return { ok: true as const, origin, direction }
}

function axisLiesInFrame(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  frame: SupportFrame,
) {
  const relative = [
    origin[0] - frame.origin[0],
    origin[1] - frame.origin[1],
    origin[2] - frame.origin[2],
  ] as const
  const dot = (vector: readonly [number, number, number]) =>
    vector[0] * frame.normal[0] + vector[1] * frame.normal[1] + vector[2] * frame.normal[2]
  return Math.abs(dot(relative)) <= 1e-6 && Math.abs(dot(direction)) <= 1e-6
}

function resolveSketchLineRevolveAxis(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  axis: Extract<
    NonNullable<ReturnType<typeof readRevolveFeatureParameters>>["axis"],
    { kind: "sketch-line" }
  >,
  frame: SupportFrame,
) {
  if (axis.sketchId !== sketch.id) {
    return failure("org.vibeshape.feature.sketch-profile-invalid", "revolve-axis-sketch-mismatch")
  }
  const entity = sketch.entities.find(({ id }) => id === axis.entityId)
  if (entity?.type !== "line") {
    return failure("org.vibeshape.feature.sketch-profile-invalid", "revolve-axis-line-unavailable")
  }
  const solvedPoints = new Map(
    solution.points.map(({ entityId, x, y }) => [entityId, { x, y }] as const),
  )
  const start = solvedPoint(solvedPoints, entity.startPointId)
  const end = solvedPoint(solvedPoints, entity.endPointId)
  if (!start || !end) {
    return failure("org.vibeshape.feature.sketch-profile-invalid", "revolve-axis-line-unsolved")
  }
  const origin = supportPointToWorld(frame, start)
  const worldEnd = supportPointToWorld(frame, end)
  const delta = [worldEnd[0] - origin[0], worldEnd[1] - origin[1], worldEnd[2] - origin[2]] as const
  const length = Math.hypot(...delta)
  if (!(length > Number.EPSILON) || !Number.isFinite(length)) {
    return failure("org.vibeshape.feature.sketch-profile-invalid", "revolve-axis-line-degenerate")
  }
  return {
    ok: true as const,
    origin,
    direction: [delta[0] / length, delta[1] / length, delta[2] / length] as const,
  }
}

export function solveSketchOnce(
  solvedBySketchId: SketchSolveCache,
  solveSketch: SketchSolvePort,
  document: DocumentSnapshot,
  sketch: SketchRecord,
  features: readonly FeatureRecord[] = document.features,
  geometry: readonly FeatureGeometryRecord[] = [],
  sectionPlanarFace?: PlanarFaceSectionPort,
  modelMaterializationCache: ExternalModelMaterializationCache = new Map(),
) {
  const cached = solvedBySketchId.get(sketch.id)
  if (cached) return cached
  const pending = resolveExternalSketchGeometry(
    document,
    sketch,
    solveSketch,
    features,
    solvedBySketchId,
    geometry,
    sectionPlanarFace,
    new Map(),
    modelMaterializationCache,
  ).then((externalGeometry) =>
    solveSketch({
      sketch,
      variables: [...document.variables],
      revision: document.revision,
      continuation: null,
      draggedPoints: [],
      ...externalGeometry,
    }),
  )
  solvedBySketchId.set(sketch.id, pending)
  return pending
}

function validatedSolution(
  result: SolveSketchRecordResult,
  document: DocumentSnapshot,
  sketch: SketchRecord,
) {
  if (!result.ok) {
    return failure("org.vibeshape.feature.sketch-solve-failed", result.diagnostic.code)
  }
  const { solution } = result
  const supportedStatus =
    solution.status === "fully-constrained" || solution.status === "under-constrained"
  return solution.sketchId === sketch.id &&
    solution.sourceRevision === document.revision &&
    supportedStatus
    ? ({ ok: true, solution } as const)
    : failure("org.vibeshape.feature.sketch-solve-failed", solution.status)
}

function profileFeatureFromRecord(feature: FeatureRecord): ProfileFeature | null {
  const extrusion = readExtrusionFeatureParameters(feature)
  if (extrusion) {
    return {
      kind: "extrusion",
      parameters: extrusion,
      multiProfile: feature.type.schemaVersion === 3 || feature.type.schemaVersion === 4,
    }
  }
  const revolve = readRevolveFeatureParameters(feature)
  return revolve
    ? {
        kind: "revolve",
        parameters: revolve,
        multiProfile: feature.type.schemaVersion === 5 || feature.type.schemaVersion === 6,
      }
    : null
}

async function prepareFeatureContent(
  document: DocumentSnapshot,
  feature: FeatureRecord,
  features: readonly FeatureRecord[],
  solveSketch: SketchSolvePort | null,
  solvedBySketchId: Map<string, Promise<SolveSketchRecordResult>>,
  geometry: readonly FeatureGeometryRecord[],
  sectionPlanarFace: PlanarFaceSectionPort | undefined,
  modelMaterializationCache: ExternalModelMaterializationCache,
) {
  const datumPlane = readDatumPlaneFeatureParameters(feature)
  if (datumPlane) {
    const frame = datumPlaneFrame(feature, document, features, new Set([feature.id]))
    if (!frame) {
      return failure("org.vibeshape.feature.datum-plane-support-missing", "support-unresolved")
    }
    return {
      ok: true as const,
      parameters: datumPlaneFeatureContentParametersSchema.parse({
        frame,
        size: 64,
        ...(datumPlane.support.kind === "feature-face"
          ? { supportFeatureId: datumPlane.support.reference.featureId }
          : {}),
      }),
    }
  }
  const profileFeature = profileFeatureFromRecord(feature)
  if (!profileFeature) return null
  return prepareProfileFeatureContent({
    document,
    feature: profileFeature,
    features,
    geometry,
    modelMaterializationCache,
    sectionPlanarFace,
    solveSketch,
    solvedBySketchId,
  })
}

type ProfileFeature =
  | Readonly<{
      kind: "extrusion"
      parameters: NonNullable<ReturnType<typeof readExtrusionFeatureParameters>>
      multiProfile: boolean
    }>
  | Readonly<{
      kind: "revolve"
      parameters: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>
      multiProfile: boolean
    }>

type ProfileFeatureContentInput = Readonly<{
  document: DocumentSnapshot
  feature: ProfileFeature
  features: readonly FeatureRecord[]
  geometry: readonly FeatureGeometryRecord[]
  modelMaterializationCache: ExternalModelMaterializationCache
  sectionPlanarFace: PlanarFaceSectionPort | undefined
  solveSketch: SketchSolvePort | null
  solvedBySketchId: Map<string, Promise<SolveSketchRecordResult>>
}>

function prepareSolvedProfileFeature(
  input: ProfileFeatureContentInput,
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  frame: SupportFrame,
) {
  const { feature, geometry } = input
  const multiProfile = feature.multiProfile
    ? (feature.parameters.profiles as SketchProfileSet | undefined)
    : null
  if (multiProfile) {
    const multiParameters = { ...feature.parameters, profiles: multiProfile }
    return feature.kind === "extrusion"
      ? prepareMultiExtrusion(sketch, solution, multiParameters, frame)
      : prepareMultiRevolve(sketch, solution, multiParameters, frame, geometry)
  }
  return feature.kind === "extrusion"
    ? prepareExtrusion(sketch, solution, feature.parameters, frame)
    : prepareRevolve(sketch, solution, feature.parameters, frame, geometry)
}

function profileFeatureSketchId(feature: ProfileFeature) {
  if (!feature.multiProfile) return feature.parameters.profile.sketchId
  const profiles = feature.parameters.profiles as SketchProfileSet | undefined
  return profiles?.profiles[0]?.sketchId ?? null
}

async function prepareProfileFeatureContent(input: ProfileFeatureContentInput) {
  const { document, feature, features, geometry, solveSketch } = input
  const profileSketchId = profileFeatureSketchId(feature)
  const sketch = document.sketches.find(({ id }) => id === profileSketchId)
  if (!sketch) return failure("org.vibeshape.feature.sketch-missing", "sketch-not-found")
  const frame = sketchFrame(sketch, document, features, new Set(), geometry)
  if (!frame) {
    return failure("org.vibeshape.feature.sketch-support-missing", "support-unresolved")
  }
  if (!solveSketch) {
    return failure("org.vibeshape.feature.sketch-solver-unavailable", "solver-unavailable")
  }
  const result = validatedSolution(
    await solveSketchOnce(
      input.solvedBySketchId,
      solveSketch,
      document,
      sketch,
      features,
      geometry,
      input.sectionPlanarFace,
      input.modelMaterializationCache,
    ),
    document,
    sketch,
  )
  if (!result.ok) return result
  return prepareSolvedProfileFeature(input, sketch, result.solution, frame)
}

export function shouldPrepareDocumentFeatureContent(feature: FeatureRecord) {
  return Boolean(
    readDatumPlaneFeatureParameters(feature) ||
      readExtrusionFeatureParameters(feature) ||
      readRevolveFeatureParameters(feature),
  )
}

export function createDocumentFeatureContentPreparer(
  solveSketch: SketchSolvePort | null,
  solvedBySketchId: SketchSolveCache = new Map(),
  sectionPlanarFace?: PlanarFaceSectionPort,
  modelMaterializationCache: ExternalModelMaterializationCache = new Map(),
): DocumentFeatureContentPreparationPort {
  return ({ document, feature, features = document.features, geometry = [] }) =>
    prepareFeatureContent(
      document,
      feature,
      features,
      solveSketch,
      solvedBySketchId,
      geometry,
      sectionPlanarFace,
      modelMaterializationCache,
    )
}
