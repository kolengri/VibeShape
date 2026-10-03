import type { DocumentFeatureContentPreparationResult } from "@vibeshape/application/feature-rebuild"
import type { SketchEntity, SketchProfileSelector, SketchRecord } from "@vibeshape/domain"
import {
  resolveSketchProfileSelector,
  type SketchProfileLoop,
  type SolveSketchRecordResult,
} from "@vibeshape/sketch-solver"

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

export function solvedPoint(
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

function cubicBezierSegment(
  entity: Extract<SketchEntity, { type: "cubic-bezier" }>,
  reversed: boolean,
  points: ReadonlyMap<string, Readonly<{ x: number; y: number }>>,
) {
  const startPointId = reversed ? entity.endPointId : entity.startPointId
  const control1PointId = reversed ? entity.control2PointId : entity.control1PointId
  const control2PointId = reversed ? entity.control1PointId : entity.control2PointId
  const endPointId = reversed ? entity.startPointId : entity.endPointId
  const start = solvedPoint(points, startPointId)
  const control1 = solvedPoint(points, control1PointId)
  const control2 = solvedPoint(points, control2PointId)
  const end = solvedPoint(points, endPointId)
  if (!start || !control1 || !control2 || !end) return null
  return {
    entityId: entity.id,
    type: "cubic-bezier" as const,
    startPointId,
    control1PointId,
    control2PointId,
    endPointId,
    start: [start.x, start.y] as const,
    control1: [control1.x, control1.y] as const,
    control2: [control2.x, control2.y] as const,
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
    if (entity.type === "cubic-bezier") return cubicBezierSegment(entity, segment.reversed, points)
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

export function materializeSelectedProfile(
  sketch: SketchRecord,
  solution: Extract<SolveSketchRecordResult, { ok: true }>["solution"],
  profile: SketchProfileSelector,
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

export function materializeDirectedSketchCurve(
  entity: Extract<SketchEntity, { type: "line" | "arc" }>,
  reversed: boolean,
  points: ReadonlyMap<string, Readonly<{ x: number; y: number }>>,
) {
  return entity.type === "line"
    ? lineSegment(entity, reversed, points)
    : arcSegment(entity, reversed, points)
}
