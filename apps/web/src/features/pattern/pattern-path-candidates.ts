import { type SketchDisplayRecord, sketchCurveSamples } from "@vibeshape/application/sketch-display"
import type { SketchPoint2, SketchRecord } from "@vibeshape/domain"
import type {
  ViewerSketchReferenceCandidate,
  ViewerVector3,
} from "@vibeshape/viewer/three-viewport"

export type PatternPathCurveKind = "line" | "arc" | "circle" | "cubic-bezier" | "elliptical-arc"
type Frame = SketchDisplayRecord["frame"]
type Entity = SketchRecord["entities"][number]
type PathEntity = Extract<Entity, { type: PatternPathCurveKind }>

const PATH_CURVE_KINDS = new Set<string>([
  "line",
  "arc",
  "circle",
  "cubic-bezier",
  "elliptical-arc",
])

function isPathEntity(entity: Entity): entity is PathEntity {
  return !entity.construction && PATH_CURVE_KINDS.has(entity.type)
}

function local(frame: Frame, [x, y, z]: readonly [number, number, number]): SketchPoint2 {
  const offset = [x - frame.origin[0], y - frame.origin[1], z - frame.origin[2]]
  const dot = (axis: readonly number[]) =>
    offset.reduce((total, value, index) => total + value * (axis[index] ?? 0), 0)
  return { x: dot(frame.xAxis), y: dot(frame.yAxis) }
}

function world(frame: Frame, { x, y }: SketchPoint2): ViewerVector3 {
  return [0, 1, 2].map(
    (axis) =>
      (frame.origin[axis] ?? 0) + (frame.xAxis[axis] ?? 0) * x + (frame.yAxis[axis] ?? 0) * y,
  ) as unknown as ViewerVector3
}

function candidate(
  sketchId: string,
  entity: PathEntity,
  samples: readonly ViewerVector3[],
  label: string,
): ViewerSketchReferenceCandidate | null {
  const start = samples[0]
  const end = samples[samples.length - 1]
  if (!start || !end || samples.length < 2) return null
  if (entity.type === "line")
    return { kind: "line", label, start, end, sourceLineId: entity.id, sourceSketchId: sketchId }
  return {
    kind: "curve",
    label,
    points: samples,
    sourceEntityId: entity.id,
    sourceSketchId: sketchId,
    sourceType: entity.type,
  }
}

/**
 * Projects a sketch's selectable path curves into world space from the current solved display:
 * solved point positions and solved circle radii, sampled by the shared sketch display sampler.
 */
export function patternPathCandidates(
  sketch: SketchRecord,
  display: SketchDisplayRecord,
  label: (kind: PatternPathCurveKind, number: number) => string,
): readonly ViewerSketchReferenceCandidate[] {
  if (display.sketchId !== sketch.id || !display.solvedPoints) return []
  const points = new Map(
    display.solvedPoints.map(({ entityId, position }) => [
      entityId,
      local(display.frame, position),
    ]),
  )
  const radii = new Map(
    (display.solvedCircles ?? []).map(({ entityId, radius }) => [entityId, radius] as const),
  )
  return sketch.entities.flatMap((entity, index) => {
    if (!isPathEntity(entity)) return []
    const samples = sketchCurveSamples(entity, points, radii).map((sample) =>
      world(display.frame, sample),
    )
    const result = candidate(sketch.id, entity, samples, label(entity.type, index + 1))
    return result ? [result] : []
  })
}
