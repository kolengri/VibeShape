import { isError } from "is-what"
import { z } from "zod"
import {
  extrusionFeatureContentParametersSchema,
  extrusionFrameSchema,
  extrusionProfileLoopSchema,
  extrusionProfileSegmentSchema,
} from "./geometry-worker"

const profileFields = extrusionFeatureContentParametersSchema.shape
const [lineSegmentSchema, arcSegmentSchema] = extrusionProfileSegmentSchema.options

export const analyticalProfileSchema = z
  .object({
    sketchId: profileFields.sketchId,
    supportFeatureId: profileFields.supportFeatureId,
    frame: extrusionFrameSchema,
    outer: extrusionProfileLoopSchema,
    holes: profileFields.holes,
  })
  .strict()
  .superRefine(({ outer, holes }, context) => {
    const loops = [outer, ...holes]
    const segmentIds = loops.flatMap((loop) => loop.segments.map(({ entityId }) => entityId))
    if (segmentIds.length > 2_000)
      context.addIssue({
        code: "custom",
        message: "An analytical profile exceeds the curve budget.",
      })
    if (new Set(segmentIds).size !== segmentIds.length)
      context.addIssue({ code: "custom", message: "Every profile curve must appear exactly once." })
  })

export const analyticalSweepPathSchema = extrusionProfileLoopSchema
  .safeExtend({
    sketchId: profileFields.sketchId,
    supportFeatureId: profileFields.supportFeatureId,
    frame: extrusionFrameSchema,
    startPointId: lineSegmentSchema.shape.startPointId,
    segments: z
      .array(z.discriminatedUnion("type", [lineSegmentSchema, arcSegmentSchema]))
      .min(1)
      .max(2_000),
  })
  .superRefine((path, context) => {
    if (new Set(path.segments.map(({ entityId }) => entityId)).size !== path.segments.length)
      context.addIssue({
        code: "custom",
        path: ["segments"],
        message: "Every path curve must appear exactly once.",
      })
    if (path.segments[0]?.startPointId !== path.startPointId)
      context.addIssue({
        code: "custom",
        path: ["startPointId"],
        message: "The path start must match its first directed curve.",
      })
    try {
      validateAnalyticalPath(path)
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["segments"],
        message: isError(error) ? error.message : "Invalid analytical path.",
      })
    }
  })

export const loftFeatureContentParametersSchema = z
  .object({ sections: z.array(analyticalProfileSchema).min(2).max(8), ruled: z.boolean() })
  .strict()
  .superRefine(({ sections }, context) => {
    if (sections.some(({ holes }) => holes.length > 0))
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Loft v1 requires hole-free sections.",
      })
    if (sections.reduce((total, section) => total + section.outer.segments.length, 0) > 2_000)
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Loft sections exceed the aggregate curve budget.",
      })
    const keys = sections.map(({ sketchId, outer, holes }) =>
      JSON.stringify([
        sketchId,
        outer.sourceEntityIds,
        holes.map(({ sourceEntityIds }) => sourceEntityIds),
      ]),
    )
    if (new Set(keys).size !== keys.length)
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Loft sections must have unique source selectors.",
      })
  })

export const sweepFeatureContentParametersSchema = z
  .object({ profile: analyticalProfileSchema, path: analyticalSweepPathSchema })
  .strict()
  .superRefine(({ profile, path }, context) => {
    try {
      validateAnalyticalSweepGeometry(profile, path)
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: isError(error) ? error.message : "Invalid analytical sweep.",
      })
    }
  })

export type AnalyticalProfileContent = z.infer<typeof analyticalProfileSchema>
export type AnalyticalSweepPathContent = z.infer<typeof analyticalSweepPathSchema>
export type LoftFeatureContentParameters = z.infer<typeof loftFeatureContentParametersSchema>
export type SweepFeatureContentParameters = z.infer<typeof sweepFeatureContentParametersSchema>

const ANALYTICAL_LINEAR_TOLERANCE = 1e-6

export function circularArcParameters(segment: z.infer<typeof arcSegmentSchema>) {
  const [a, b, c] = [segment.start, segment.middle, segment.end]
  const [bx, by, cx, cy] = [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]]
  const cross = bx * cy - by * cx
  if (
    Math.abs(cross) <=
    ANALYTICAL_LINEAR_TOLERANCE * Math.max(Math.hypot(bx, by), Math.hypot(cx, cy))
  )
    throw new Error("Circular arcs require three distinct non-collinear points.")
  const bSquared = bx * bx + by * by
  const cSquared = cx * cx + cy * cy
  const center: [number, number] = [
    a[0] + (bSquared * cy - cSquared * by) / (2 * cross),
    a[1] + (bx * cSquared - cx * bSquared) / (2 * cross),
  ]
  const startRadius = [a[0] - center[0], a[1] - center[1]] as const
  const endRadius = [c[0] - center[0], c[1] - center[1]] as const
  const sign = Math.sign(cross)
  const radius = Math.hypot(...startRadius)
  let sweep = Math.atan2(
    sign * (startRadius[0] * endRadius[1] - startRadius[1] * endRadius[0]),
    startRadius[0] * endRadius[0] + startRadius[1] * endRadius[1],
  )
  if (sweep <= 0) sweep += 2 * Math.PI
  return { center, sign, radius, sweep }
}

export function analyticalPathSegmentTangents(
  segment: z.infer<typeof lineSegmentSchema> | z.infer<typeof arcSegmentSchema>,
) {
  const normalized = ([x, y]: readonly [number, number]) => {
    const length = Math.hypot(x, y)
    if (!Number.isFinite(length) || length <= ANALYTICAL_LINEAR_TOLERANCE)
      throw new Error("An analytical path curve is degenerate.")
    return [x / length, y / length] as const
  }
  if (segment.type === "line") {
    const tangent = normalized([
      segment.end[0] - segment.start[0],
      segment.end[1] - segment.start[1],
    ])
    return { start: tangent, end: tangent }
  }
  const { center, sign } = circularArcParameters(segment)
  const tangent = (point: readonly [number, number]) =>
    normalized([sign * (center[1] - point[1]), sign * (point[0] - center[0])])
  return { start: tangent(segment.start), end: tangent(segment.end) }
}

type Point2 = readonly [number, number]
type AnalyticalPathGeometry = Readonly<{
  frame: AnalyticalSweepPathContent["frame"]
  segments: readonly AnalyticalSweepPathContent["segments"][number][]
}>

function pointDistance(left: Point2, right: Point2) {
  return Math.hypot(left[0] - right[0], left[1] - right[1])
}

function validatePathTopology(segments: AnalyticalPathGeometry["segments"]) {
  if (segments.length > 2_000) throw new Error("Sweep paths exceed the analytical curve budget.")
  if (new Set(segments.map(({ entityId }) => entityId)).size !== segments.length)
    throw new Error("Sweep paths must use every selected curve exactly once.")
  const first = segments[0]
  const last = segments[segments.length - 1]
  if (!first || !last || pointDistance(first.start, last.end) <= ANALYTICAL_LINEAR_TOLERANCE)
    throw new Error("Sweep requires a directed open path.")
  const endpoints = segments.flatMap((segment) => [segment.start, segment.end])
  for (const endpoint of endpoints) {
    if (
      endpoints.filter((other) => pointDistance(endpoint, other) <= ANALYTICAL_LINEAR_TOLERANCE)
        .length > 2
    )
      throw new Error("Sweep paths must not branch or revisit a joined endpoint.")
  }
  return first
}

function validatePathJoin(
  previous: { end: Point2; tangent: Point2 },
  start: Point2,
  startTangent: Point2,
) {
  if (pointDistance(previous.end, start) > ANALYTICAL_LINEAR_TOLERANCE)
    throw new Error("Sweep path curves must form one connected directed chain.")
  if (previous.tangent[0] * startTangent[0] + previous.tangent[1] * startTangent[1] < 1 - 1e-8)
    throw new Error("Sweep path joins must be G1 tangent continuous.")
}

function validateAnalyticalPath(path: Pick<AnalyticalPathGeometry, "segments">) {
  const first = validatePathTopology(path.segments)
  let previous: { end: Point2; tangent: Point2 } | null = null
  for (const segment of path.segments) {
    if (pointDistance(segment.start, segment.end) <= ANALYTICAL_LINEAR_TOLERANCE)
      throw new Error("Sweep path endpoints must be distinct.")
    const tangents = analyticalPathSegmentTangents(segment)
    if (previous) validatePathJoin(previous, segment.start, tangents.start)
    previous = { end: segment.end, tangent: tangents.end }
  }
  return { start: first.start, startTangent: analyticalPathSegmentTangents(first).start }
}

/** Validate authored placement without moving the section or replacing the analytical spine. */
export function validateAnalyticalSweepGeometry(
  profile: Readonly<{ frame: AnalyticalProfileContent["frame"] }>,
  path: AnalyticalPathGeometry,
) {
  const { start, startTangent } = validateAnalyticalPath(path)
  const worldStart = path.frame.origin.map(
    (coordinate, axis) =>
      coordinate +
      (path.frame.xAxis[axis] ?? 0) * start[0] +
      (path.frame.yAxis[axis] ?? 0) * start[1],
  )
  const planeDistance = profile.frame.normal.reduce(
    (total, coordinate, axis) =>
      total + coordinate * ((worldStart[axis] ?? 0) - (profile.frame.origin[axis] ?? 0)),
    0,
  )
  const [tx, ty] = startTangent
  const tangent = path.frame.xAxis.map(
    (coordinate, axis) => coordinate * tx + (path.frame.yAxis[axis] ?? 0) * ty,
  )
  const parallel = Math.abs(
    profile.frame.normal.reduce(
      (total, coordinate, axis) => total + coordinate * (tangent[axis] ?? 0),
      0,
    ),
  )
  if (Math.abs(planeDistance) > ANALYTICAL_LINEAR_TOLERANCE || parallel < 1 - 1e-8)
    throw new Error(
      "Sweep profile plane must pass through the path start and be normal to its tangent.",
    )
}
