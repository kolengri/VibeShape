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
  type FeatureRecord,
  readDatumPlaneFeatureParameters,
  readExtrusionFeatureParameters,
  readRevolveFeatureParameters,
  type SketchEntity,
  type SketchRecord,
} from "@vibeshape/domain"
import {
  datumPlaneFeatureContentParametersSchema,
  extrusionFeatureContentParametersSchema,
  revolveFeatureContentParametersSchema,
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

function prepareRevolve(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  parameters: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>,
  frame: SupportFrame,
) {
  const profile = materializeSelectedProfile(sketch, solution, parameters.profile)
  if (!profile.ok) return profile
  const resolvedAxis = resolveRevolveAxis(sketch, solution, parameters.axis, frame)
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

function resolveRevolveAxis(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  axis: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>["axis"],
  frame: SupportFrame,
) {
  if (axis.kind === "origin-axis") {
    return {
      ok: true as const,
      origin: frame.origin,
      direction: axis.axis === "x" ? frame.xAxis : frame.yAxis,
    }
  }
  return resolveSketchLineRevolveAxis(sketch, solution, axis, frame)
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
  const extrusion = readExtrusionFeatureParameters(feature)
  if (extrusion) {
    return prepareProfileFeatureContent({
      document,
      feature: { kind: "extrusion", parameters: extrusion },
      features,
      geometry,
      modelMaterializationCache,
      sectionPlanarFace,
      solveSketch,
      solvedBySketchId,
    })
  }
  const revolve = readRevolveFeatureParameters(feature)
  if (!revolve) return null
  return prepareProfileFeatureContent({
    document,
    feature: { kind: "revolve", parameters: revolve },
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
    }>
  | Readonly<{
      kind: "revolve"
      parameters: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>
    }>

async function prepareProfileFeatureContent({
  document,
  feature,
  features,
  geometry,
  modelMaterializationCache,
  sectionPlanarFace,
  solveSketch,
  solvedBySketchId,
}: Readonly<{
  document: DocumentSnapshot
  feature: ProfileFeature
  features: readonly FeatureRecord[]
  geometry: readonly FeatureGeometryRecord[]
  modelMaterializationCache: ExternalModelMaterializationCache
  sectionPlanarFace: PlanarFaceSectionPort | undefined
  solveSketch: SketchSolvePort | null
  solvedBySketchId: Map<string, Promise<SolveSketchRecordResult>>
}>) {
  const sketch = document.sketches.find(({ id }) => id === feature.parameters.profile.sketchId)
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
      solvedBySketchId,
      solveSketch,
      document,
      sketch,
      features,
      geometry,
      sectionPlanarFace,
      modelMaterializationCache,
    ),
    document,
    sketch,
  )
  if (!result.ok) return result
  return feature.kind === "extrusion"
    ? prepareExtrusion(sketch, result.solution, feature.parameters, frame)
    : prepareRevolve(sketch, result.solution, feature.parameters, frame)
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
