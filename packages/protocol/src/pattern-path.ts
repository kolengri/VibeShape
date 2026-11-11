import { isError } from "is-what"
import { z } from "zod"
import {
  extrusionFeatureContentParametersSchema,
  extrusionFrameSchema,
  extrusionProfileSegmentSchema,
} from "./geometry-worker"
import { analyticalPathSegmentTangents } from "./sweep-loft"

const profileFields = extrusionFeatureContentParametersSchema.shape
const [
  lineSegmentSchema,
  arcSegmentSchema,
  circleSegmentSchema,
  ,
  ellipticalArcSchema,
  cubicSchema,
] = extrusionProfileSegmentSchema.options
const chainSegmentSchema = z.discriminatedUnion("type", [
  lineSegmentSchema,
  arcSegmentSchema,
  ellipticalArcSchema,
  cubicSchema,
])
const entityIdSchema = lineSegmentSchema.shape.entityId
const PATH_LINEAR_TOLERANCE = 1e-6
const PATH_TANGENT_TOLERANCE = 1e-8
const WORKSPACE_LIMIT_MM = 100_000
export const MAX_PATTERN_PATH_CURVES = 2_000

type ChainSegment = z.infer<typeof chainSegmentSchema>
type Point2 = readonly [number, number]

function distance(left: Point2, right: Point2) {
  return Math.hypot(left[0] - right[0], left[1] - right[1])
}

type Tangents = Readonly<{ start: Point2; end: Point2 }>
type CubicSegment = Extract<ChainSegment, { type: "cubic-bezier" }>
/** Speeds below this fraction of the control polygon scale count as a cusp. */
const CUSP_RELATIVE_TOLERANCE = 1e-6

function difference(from: Point2, to: Point2): Point2 {
  return [to[0] - from[0], to[1] - from[1]]
}

/** Real roots in t of A t² + 2B t + C, plus the vertex for near-double roots. */
function quadraticCandidates(A: number, B: number, C: number) {
  if (A === 0) return B === 0 ? [] : [-C / (2 * B)]
  const root = Math.sqrt(Math.max(0, B * B - A * C))
  return [(-B - root) / A, (-B + root) / A, -B / A]
}

/**
 * A cubic Bezier's derivative is 3[(1-t)²a + 2(1-t)t b + t²c] for its control-polygon legs a, b
 * and c. A cusp is an interior t where both coordinates vanish, so it is a root of each one.
 */
function hasInteriorCusp(segment: CubicSegment) {
  const legs = [
    difference(segment.start, segment.control1),
    difference(segment.control1, segment.control2),
    difference(segment.control2, segment.end),
  ] as const
  const [a, b, c] = legs
  const coefficient = (axis: 0 | 1) =>
    [a[axis] - 2 * b[axis] + c[axis], b[axis] - a[axis], a[axis]] as const
  const speed = (t: number) =>
    Math.hypot(
      ...([0, 1] as const).map((axis) => {
        const [A, B, C] = coefficient(axis)
        return A * t * t + 2 * B * t + C
      }),
    )
  const scale = Math.max(...legs.map((leg) => Math.hypot(...leg)))
  return ([0, 1] as const)
    .flatMap((axis) => quadraticCandidates(...coefficient(axis)))
    .some((t) => t > 0 && t < 1 && speed(t) <= CUSP_RELATIVE_TOLERANCE * scale)
}

/** Every curve needs a defined tangent along its whole length for the follow frame. */
function segmentTangents(segment: ChainSegment): Tangents {
  if (distance(segment.start, segment.end) <= PATH_LINEAR_TOLERANCE)
    throw new Error("Pattern path curve endpoints must be distinct.")
  let tangents: Tangents
  try {
    tangents = analyticalPathSegmentTangents(segment)
  } catch {
    throw new Error(
      `Pattern path curve ${segment.entityId} has no tangent at an endpoint; move its handle off that endpoint.`,
    )
  }
  if (segment.type === "cubic-bezier" && hasInteriorCusp(segment))
    throw new Error(
      `Pattern path curve ${segment.entityId} has a cusp where its tangent is undefined.`,
    )
  return tangents
}

function validateJoin(
  previous: ChainSegment,
  incoming: Tangents,
  next: ChainSegment,
  outgoing: Tangents,
) {
  if (distance(previous.end, next.start) > PATH_LINEAR_TOLERANCE)
    throw new Error("Pattern path curves must form one connected directed chain.")
  if (
    incoming.end[0] * outgoing.start[0] + incoming.end[1] * outgoing.start[1] <
    1 - PATH_TANGENT_TOLERANCE
  )
    throw new Error("Pattern path joins must be G1 tangent continuous.")
}

function validateEndpointsDoNotBranch(segments: readonly ChainSegment[]) {
  const endpoints = segments.flatMap(({ start, end }) => [start, end])
  for (const endpoint of endpoints)
    if (endpoints.filter((other) => distance(endpoint, other) <= PATH_LINEAR_TOLERANCE).length > 2)
      throw new Error("Pattern paths must not branch or revisit a joined endpoint.")
}

/**
 * A chain is directed from its first curve. It is closed only when its last end meets its first
 * start; that seam must also be G1. Translated and followed copies share this one rule, so every
 * curve has a defined tangent at its ends and, for cubic Beziers, no interior cusp.
 */
export function validatePatternPathChain(segments: readonly ChainSegment[], closed: boolean) {
  const first = segments[0]
  const last = segments[segments.length - 1]
  if (!first || !last) throw new Error("A pattern path requires at least one curve.")
  const tangents = segments.map(segmentTangents)
  validateEndpointsDoNotBranch(segments)
  for (let index = 1; index < segments.length; index += 1)
    validateJoin(
      segments[index - 1] as ChainSegment,
      tangents[index - 1] as Tangents,
      segments[index] as ChainSegment,
      tangents[index] as Tangents,
    )
  const meets = distance(last.end, first.start) <= PATH_LINEAR_TOLERANCE
  if (meets !== closed)
    throw new Error(
      closed ? "A closed pattern path must end at its start." : "An open pattern path is closed.",
    )
  if (closed)
    validateJoin(last, tangents[tangents.length - 1] as Tangents, first, tangents[0] as Tangents)
}

const patternPathGeometrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("chain"),
      closed: z.boolean(),
      segments: z.array(chainSegmentSchema).min(1).max(MAX_PATTERN_PATH_CURVES),
    })
    .strict(),
  z
    .object({
      kind: z.literal("circle"),
      circle: circleSegmentSchema,
      /** Counterclockwise angle about the sketch normal from the sketch X axis to the start. */
      startAngle: z
        .number()
        .finite()
        .min(0)
        .lt(2 * Math.PI),
    })
    .strict(),
])

function sourceIdsMatch(
  path: Readonly<{
    sourceEntityIds: readonly string[]
    geometry: z.infer<typeof patternPathGeometrySchema>
  }>,
) {
  const ids =
    path.geometry.kind === "circle"
      ? [path.geometry.circle.entityId]
      : path.geometry.segments.map(({ entityId }) => entityId)
  const sorted = [...new Set(ids)].sort()
  return (
    sorted.length === ids.length &&
    sorted.length === path.sourceEntityIds.length &&
    sorted.every((id, index) => id === path.sourceEntityIds[index])
  )
}

export const patternPathContentSchema = z
  .object({
    sketchId: profileFields.sketchId,
    supportFeatureId: profileFields.supportFeatureId,
    frame: extrusionFrameSchema,
    sourceEntityIds: z.array(entityIdSchema).min(1).max(MAX_PATTERN_PATH_CURVES),
    startPointId: entityIdSchema,
    geometry: patternPathGeometrySchema,
  })
  .strict()
  .superRefine((path, context) => {
    if (!sourceIdsMatch(path))
      context.addIssue({
        code: "custom",
        path: ["sourceEntityIds"],
        message: "Every selected path curve must appear exactly once.",
      })
    if (path.geometry.kind === "circle") return
    if (path.geometry.segments[0]?.startPointId !== path.startPointId)
      context.addIssue({
        code: "custom",
        path: ["startPointId"],
        message: "The path start must match its first directed curve.",
      })
    try {
      validatePatternPathChain(path.geometry.segments, path.geometry.closed)
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["geometry"],
        message: isError(error) ? error.message : "Invalid pattern path.",
      })
    }
  })
export type PatternPathContent = z.infer<typeof patternPathContentSchema>

export const patternFeatureContentParametersV3Schema = z
  .object({
    kind: z.literal("path"),
    count: z.number().int().min(2).max(256),
    path: patternPathContentSchema,
    spacing: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("equal") }).strict(),
      z
        .object({
          mode: z.literal("fixed"),
          distance: z.number().finite().positive().max(WORKSPACE_LIMIT_MM),
        })
        .strict(),
    ]),
    startOffset: z.number().finite().min(0).max(WORKSPACE_LIMIT_MM),
    orientation: z.enum(["translate", "follow"]),
    reverse: z.boolean(),
  })
  .strict()
export type PatternFeatureContentParametersV3 = z.infer<
  typeof patternFeatureContentParametersV3Schema
>
