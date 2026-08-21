import { type SupportFrame, sketchFrame } from "@vibeshape/application/support-frame"
import {
  type DocumentSnapshot,
  type FeatureRecord,
  type SketchEntity,
  type SketchPoint2,
  type SketchRecord,
  sketchEllipseGeometry,
  sketchEllipsePointAt,
  sketchEllipticalArcGeometry,
} from "@vibeshape/domain"
import type { DocumentWorkerResponse, SolvedSketchWire } from "@vibeshape/protocol"

export type SketchDisplayRecord = Extract<
  DocumentWorkerResponse,
  { type: "documentRebuilt" }
>["sketches"][number]
type PointLookup = ReadonlyMap<string, SketchPoint2>
export type SketchDisplaySolution = Readonly<{
  points: readonly SolvedSketchWire["points"][number][]
  circles: readonly SolvedSketchWire["circles"][number][]
}>

const CURVE_SEGMENTS = 64
const MAX_SKETCH_DISPLAY_SEGMENTS = 100_000
const TWO_PI = Math.PI * 2

function solvedGeometry(sketch: SketchRecord, solution: SketchDisplaySolution | null) {
  const solvedPoints = new Map(solution?.points.map(({ entityId, x, y }) => [entityId, { x, y }]))
  const solvedRadii = new Map(solution?.circles.map(({ entityId, radius }) => [entityId, radius]))
  const points = new Map<string, SketchPoint2>()
  for (const entity of sketch.entities) {
    if (entity.type !== "point") continue
    points.set(entity.id, solvedPoints.get(entity.id) ?? { x: entity.x, y: entity.y })
  }
  return { points, radii: solvedRadii }
}

function positiveSweep(start: number, end: number) {
  return (((end - start) % TWO_PI) + TWO_PI) % TWO_PI
}

function sampledArc(center: SketchPoint2, start: SketchPoint2, end: SketchPoint2) {
  const radius = Math.hypot(start.x - center.x, start.y - center.y)
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x)
  const sweep = positiveSweep(startAngle, endAngle)
  if (!Number.isFinite(radius) || radius <= Number.EPSILON || sweep <= Number.EPSILON) return []
  const segmentCount = Math.max(8, Math.ceil((sweep / TWO_PI) * CURVE_SEGMENTS))
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = startAngle + sweep * (index / segmentCount)
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  })
}

function sampledCircle(center: SketchPoint2, radius: number) {
  if (!Number.isFinite(radius) || radius <= Number.EPSILON) return []
  return Array.from({ length: CURVE_SEGMENTS + 1 }, (_, index) => {
    const angle = (TWO_PI * index) / CURVE_SEGMENTS
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  })
}

function sampledEllipse(
  center: SketchPoint2,
  primaryAxisPoint: SketchPoint2,
  secondaryAxisPoint: SketchPoint2,
) {
  const geometry = sketchEllipseGeometry(center, primaryAxisPoint, secondaryAxisPoint)
  return geometry
    ? Array.from({ length: CURVE_SEGMENTS + 1 }, (_, index) =>
        sketchEllipsePointAt(geometry, (TWO_PI * index) / CURVE_SEGMENTS),
      )
    : []
}

function sampledEllipticalArc(
  center: SketchPoint2,
  primaryAxisPoint: SketchPoint2,
  secondaryAxisPoint: SketchPoint2,
  start: SketchPoint2,
  end: SketchPoint2,
) {
  const geometry = sketchEllipticalArcGeometry(
    center,
    primaryAxisPoint,
    secondaryAxisPoint,
    start,
    end,
  )
  if (!geometry) return []
  const segmentCount = Math.max(8, Math.ceil((geometry.sweep / TWO_PI) * CURVE_SEGMENTS))
  return Array.from({ length: segmentCount + 1 }, (_, index) =>
    sketchEllipsePointAt(
      geometry,
      geometry.startParameter + geometry.sweep * (index / segmentCount),
    ),
  )
}

function point(points: PointLookup, id: string) {
  return points.get(id) ?? null
}

type CurveEntity = Exclude<SketchEntity, { type: "point" }>

function lineSamples(entity: Extract<CurveEntity, { type: "line" }>, points: PointLookup) {
  const start = point(points, entity.startPointId)
  const end = point(points, entity.endPointId)
  if (!start || !end) return []
  return [start, end]
}

function circleSamples(
  entity: Extract<CurveEntity, { type: "circle" }>,
  points: PointLookup,
  radii: ReadonlyMap<string, number>,
) {
  const center = point(points, entity.centerPointId)
  return center ? sampledCircle(center, radii.get(entity.id) ?? entity.radius) : []
}

function arcSamples(entity: Extract<CurveEntity, { type: "arc" }>, points: PointLookup) {
  const center = point(points, entity.centerPointId)
  const start = point(points, entity.startPointId)
  const end = point(points, entity.endPointId)
  if (!center || !start || !end) return []
  return sampledArc(center, start, end)
}

function ellipseSamples(
  entity: Extract<CurveEntity, { type: "ellipse" | "elliptical-arc" }>,
  points: PointLookup,
) {
  const center = point(points, entity.centerPointId)
  const primary = point(points, entity.primaryAxisPointId)
  const secondary = point(points, entity.secondaryAxisPointId)
  if (!center || !primary || !secondary) return []
  if (entity.type === "ellipse") return sampledEllipse(center, primary, secondary)
  const start = point(points, entity.startPointId)
  const end = point(points, entity.endPointId)
  return start && end ? sampledEllipticalArc(center, primary, secondary, start, end) : []
}

function curveSamples(
  entity: CurveEntity,
  points: PointLookup,
  radii: ReadonlyMap<string, number>,
) {
  switch (entity.type) {
    case "line":
      return lineSamples(entity, points)
    case "circle":
      return circleSamples(entity, points, radii)
    case "arc":
      return arcSamples(entity, points)
    case "ellipse":
    case "elliptical-arc":
      return ellipseSamples(entity, points)
  }
}

function worldPoint(frame: SupportFrame, local: SketchPoint2) {
  return [
    frame.origin[0] + frame.xAxis[0] * local.x + frame.yAxis[0] * local.y,
    frame.origin[1] + frame.xAxis[1] * local.x + frame.yAxis[1] * local.y,
    frame.origin[2] + frame.xAxis[2] * local.x + frame.yAxis[2] * local.y,
  ] as const
}

function appendPoint(target: number[], frame: SupportFrame, local: SketchPoint2) {
  target.push(...worldPoint(frame, local))
}

function appendSegments(
  target: number[],
  frame: SupportFrame,
  samples: readonly SketchPoint2[],
  remaining: number,
) {
  const segmentCount = Math.min(Math.max(samples.length - 1, 0), remaining)
  for (let index = 0; index < segmentCount; index += 1) {
    const start = samples[index]
    const end = samples[index + 1]
    if (!start || !end) continue
    appendPoint(target, frame, start)
    appendPoint(target, frame, end)
  }
  return segmentCount
}

export function materializeSketchDisplay(
  document: DocumentSnapshot,
  sketch: SketchRecord,
  solution: SketchDisplaySolution | null = null,
  features: readonly FeatureRecord[] = document.features,
): SketchDisplayRecord | null {
  const frame = sketchFrame(sketch, document, features)
  if (!frame) return null
  const { points, radii } = solvedGeometry(sketch, solution)
  const curvePositions: number[] = []
  const constructionCurvePositions: number[] = []
  const pointPositions: number[] = []
  const constructionPointPositions: number[] = []
  let segmentCount = 0

  for (const entity of sketch.entities) {
    if (entity.type === "point") {
      const displayPoint = points.get(entity.id)
      if (displayPoint) {
        appendPoint(
          entity.construction ? constructionPointPositions : pointPositions,
          frame,
          displayPoint,
        )
      }
      continue
    }
    if (segmentCount >= MAX_SKETCH_DISPLAY_SEGMENTS) continue
    segmentCount += appendSegments(
      entity.construction ? constructionCurvePositions : curvePositions,
      frame,
      curveSamples(entity, points, radii),
      MAX_SKETCH_DISPLAY_SEGMENTS - segmentCount,
    )
  }

  return {
    sketchId: sketch.id,
    curvePositions: new Float32Array(curvePositions),
    constructionCurvePositions: new Float32Array(constructionCurvePositions),
    pointPositions: new Float32Array(pointPositions),
    constructionPointPositions: new Float32Array(constructionPointPositions),
  }
}
