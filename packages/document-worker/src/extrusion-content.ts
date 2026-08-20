import type {
  DocumentFeatureContentPreparationPort,
  DocumentFeatureContentPreparationResult,
} from "@vibeshape/application/feature-rebuild"
import {
  boxFeatureParametersSchema,
  cylinderFeatureParametersSchema,
  type DocumentSnapshot,
  type FeatureRecord,
  readDatumPlaneFeatureParameters,
  readExtrusionFeatureParameters,
  type SketchEntity,
  type SketchRecord,
} from "@vibeshape/domain"
import {
  datumPlaneFeatureContentParametersSchema,
  extrusionFeatureContentParametersSchema,
  extrusionFrameSchema,
} from "@vibeshape/protocol"
import {
  resolveSketchProfileSelector,
  type SketchProfileLoop,
  type SolveSketchRecordResult,
} from "@vibeshape/sketch-solver"
import type { SketchSolvePort } from "./runtime"

const TWO_PI = Math.PI * 2
type ExtrusionFrame = ReturnType<typeof extrusionFrameSchema.parse>
type Vector3 = readonly [number, number, number]

function dot(left: Vector3, right: Vector3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: Vector3, right: Vector3): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function normalize(vector: Vector3): [number, number, number] | null {
  const magnitude = Math.hypot(...vector)
  return magnitude > Number.EPSILON
    ? [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
    : null
}

function frameFromNormal(origin: Vector3, normal: Vector3): ExtrusionFrame | null {
  const unitNormal = normalize(normal)
  if (!unitNormal) return null
  const reference: Vector3 = Math.abs(unitNormal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const projection = dot(reference, unitNormal)
  const projected: [number, number, number] = [
    reference[0] - projection * unitNormal[0],
    reference[1] - projection * unitNormal[1],
    reference[2] - projection * unitNormal[2],
  ]
  const xAxis = normalize(projected)
  if (!xAxis) return null
  return extrusionFrameSchema.parse({
    origin,
    xAxis,
    yAxis: cross(unitNormal, xAxis),
    normal: unitNormal,
  })
}

function originPlaneFrame(plane: SketchRecord["plane"]): ExtrusionFrame {
  if (plane === "xz") {
    return { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, -1, 0] }
  }
  if (plane === "yz") {
    return { origin: [0, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] }
  }
  return { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }
}

function translatedFrame(frame: ExtrusionFrame, offset: number, reverse = false): ExtrusionFrame {
  return extrusionFrameSchema.parse({
    origin: [
      frame.origin[0] + frame.normal[0] * offset,
      frame.origin[1] + frame.normal[1] * offset,
      frame.origin[2] + frame.normal[2] * offset,
    ],
    xAxis: frame.xAxis,
    yAxis: reverse ? frame.yAxis.map((coordinate) => -coordinate) : frame.yAxis,
    normal: reverse ? frame.normal.map((coordinate) => -coordinate) : frame.normal,
  })
}

function boxSupportFrame(feature: FeatureRecord, role: string) {
  const parameters = boxFeatureParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) return null
  const { centered, depth, height, width } = parameters.data
  const minimumZ = centered ? -height.value / 2 : 0
  const maximumZ = centered ? height.value / 2 : height.value
  const definitions: Readonly<Record<string, readonly [Vector3, number]>> = {
    "primitive.box.side.x-min": [[-1, 0, 0], -width.value / 2],
    "primitive.box.side.x-max": [[1, 0, 0], width.value / 2],
    "primitive.box.side.y-min": [[0, -1, 0], -depth.value / 2],
    "primitive.box.side.y-max": [[0, 1, 0], depth.value / 2],
    "primitive.box.cap.start": [[0, 0, -1], -minimumZ],
    "primitive.box.cap.end": [[0, 0, 1], maximumZ],
  }
  const definition = definitions[role]
  if (!definition) return null
  const [normal, coordinate] = definition
  return frameFromNormal(
    [normal[0] * coordinate, normal[1] * coordinate, normal[2] * coordinate],
    normal,
  )
}

function cylinderSupportFrame(feature: FeatureRecord, role: string) {
  const parameters = cylinderFeatureParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) return null
  const { centered, height } = parameters.data
  if (role === "primitive.cylinder.cap.start") {
    const z = centered ? -height.value / 2 : 0
    return frameFromNormal([0, 0, z], [0, 0, -1])
  }
  if (role === "primitive.cylinder.cap.end") {
    const z = centered ? height.value / 2 : height.value
    return frameFromNormal([0, 0, z], [0, 0, 1])
  }
  return null
}

function extrusionSupportFrame(
  feature: FeatureRecord,
  role: string,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  visitedFeatureIds: ReadonlySet<string>,
) {
  const parameters = readExtrusionFeatureParameters(feature)
  if (!parameters) return null
  const sourceSketch = document.sketches.find(({ id }) => id === parameters.profile.sketchId)
  if (!sourceSketch) return null
  const frame = sketchFrame(sourceSketch, document, features, visitedFeatureIds)
  if (!frame) return null
  const start = parameters.symmetric ? -parameters.distance.value / 2 : 0
  if (role === "extrusion.cap.start") return translatedFrame(frame, start, true)
  return role === "extrusion.cap.end"
    ? translatedFrame(frame, start + parameters.distance.value)
    : null
}

function datumPlaneFrame(
  feature: FeatureRecord,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  visitedFeatureIds: ReadonlySet<string>,
): ExtrusionFrame | null {
  const parameters = readDatumPlaneFeatureParameters(feature)
  if (!parameters) return null
  const support = parameters.support
  const baseFrame: ExtrusionFrame | null =
    support.kind === "origin-plane"
      ? originPlaneFrame(support.plane)
      : (() => {
          const source = features.find(({ id }) => id === support.reference.featureId)
          const role = support.reference.semanticRole
          if (!source || !role || visitedFeatureIds.has(source.id)) return null
          return featureSupportFrame(
            source,
            role,
            document,
            features,
            new Set([...visitedFeatureIds, source.id]),
          )
        })()
  return baseFrame ? translatedFrame(baseFrame, parameters.offset.value) : null
}

function featureSupportFrame(
  feature: FeatureRecord,
  role: string,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  visitedFeatureIds: ReadonlySet<string>,
): ExtrusionFrame | null {
  if (feature.type.typeId === "org.vibeshape.feature.part-design.box") {
    return boxSupportFrame(feature, role)
  }
  if (feature.type.typeId === "org.vibeshape.feature.part-design.cylinder") {
    return cylinderSupportFrame(feature, role)
  }
  if (feature.type.typeId === "org.vibeshape.feature.part-design.extrusion") {
    return extrusionSupportFrame(feature, role, document, features, visitedFeatureIds)
  }
  if (
    feature.type.typeId === "org.vibeshape.feature.reference-geometry.datum-plane" &&
    role === "datum.plane"
  ) {
    return datumPlaneFrame(feature, document, features, visitedFeatureIds)
  }
  return null
}

function sketchFrame(
  sketch: SketchRecord,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  visitedFeatureIds: ReadonlySet<string> = new Set(),
): ExtrusionFrame | null {
  const support = sketch.support
  if (!support) return originPlaneFrame(sketch.plane)
  const reference = support.reference
  const role = reference.semanticRole
  if (!role || visitedFeatureIds.has(reference.featureId)) return null
  const feature = features.find(({ id }) => id === reference.featureId)
  if (!feature) return null
  return featureSupportFrame(
    feature,
    role,
    document,
    features,
    new Set([...visitedFeatureIds, reference.featureId]),
  )
}

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
  const center = solvedPoint(points, entity.centerPointId)
  const primaryAxisPoint = solvedPoint(points, entity.primaryAxisPointId)
  const secondaryAxisPoint = solvedPoint(points, entity.secondaryAxisPointId)
  const first = solvedPoint(points, entity.startPointId)
  const second = solvedPoint(points, entity.endPointId)
  if (!center || !primaryAxisPoint || !secondaryAxisPoint || !first || !second) return null
  const start = reversed ? second : first
  const end = reversed ? first : second
  return {
    entityId: entity.id,
    type: "elliptical-arc" as const,
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

function prepareExtrusion(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  parameters: NonNullable<ReturnType<typeof readExtrusionFeatureParameters>>,
  frame: ExtrusionFrame,
) {
  const resolution = resolveSketchProfileSelector(
    parameters.profile,
    sketch.id,
    solution.profileResult,
  )
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
  const prepared = extrusionFeatureContentParametersSchema.safeParse({
    sketchId: sketch.id,
    ...(sketch.support ? { supportFeatureId: sketch.support.reference.featureId } : {}),
    frame,
    outer,
    holes: holes.flatMap((hole) => (hole ? [hole] : [])),
    distance: parameters.distance.value,
    symmetric: parameters.symmetric,
    operation: parameters.operation,
  })
  return prepared.success
    ? ({ ok: true, parameters: prepared.data } as const)
    : failure("org.vibeshape.feature.sketch-profile-invalid", "invalid-materialized-profile")
}

function solveSketchOnce(
  solvedBySketchId: Map<string, Promise<SolveSketchRecordResult>>,
  solveSketch: SketchSolvePort,
  document: DocumentSnapshot,
  sketch: SketchRecord,
) {
  const cached = solvedBySketchId.get(sketch.id)
  if (cached) return cached
  const pending = Promise.resolve(
    solveSketch({
      sketch,
      variables: [...document.variables],
      revision: document.revision,
      continuation: null,
      draggedPoints: [],
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
  const parameters = readExtrusionFeatureParameters(feature)
  if (!parameters) return null
  const sketch = document.sketches.find(({ id }) => id === parameters.profile.sketchId)
  if (!sketch) return failure("org.vibeshape.feature.sketch-missing", "sketch-not-found")
  const frame = sketchFrame(sketch, document, features)
  if (!frame) {
    return failure("org.vibeshape.feature.sketch-support-missing", "support-unresolved")
  }
  if (!solveSketch) {
    return failure("org.vibeshape.feature.sketch-solver-unavailable", "solver-unavailable")
  }
  const result = validatedSolution(
    await solveSketchOnce(solvedBySketchId, solveSketch, document, sketch),
    document,
    sketch,
  )
  return result.ok ? prepareExtrusion(sketch, result.solution, parameters, frame) : result
}

export function createDocumentFeatureContentPreparer(
  solveSketch: SketchSolvePort | null,
): DocumentFeatureContentPreparationPort {
  const solvedBySketchId = new Map<string, Promise<SolveSketchRecordResult>>()
  return ({ document, feature, features = document.features }) =>
    prepareFeatureContent(document, feature, features, solveSketch, solvedBySketchId)
}
