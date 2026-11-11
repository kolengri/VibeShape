import { z } from "zod"

/**
 * Drawing views of a Z-up model. `normal` points from the model toward the viewer and `xAxis` is
 * the sheet's rightward direction; the sheet's upward direction is `normal × xAxis`.
 */
export const DRAWING_VIEW_IDS = [
  "front",
  "back",
  "top",
  "bottom",
  "right",
  "left",
  "isometric",
] as const
export const drawingViewIdSchema = z.enum(DRAWING_VIEW_IDS)
export type DrawingViewId = z.infer<typeof drawingViewIdSchema>

type Vector = readonly [number, number, number]
const isometricNormal = 1 / Math.sqrt(3)
const isometricAxis = 1 / Math.sqrt(2)
export const DRAWING_VIEW_FRAMES: Readonly<
  Record<DrawingViewId, Readonly<{ normal: Vector; xAxis: Vector }>>
> = {
  front: { normal: [0, -1, 0], xAxis: [1, 0, 0] },
  back: { normal: [0, 1, 0], xAxis: [-1, 0, 0] },
  top: { normal: [0, 0, 1], xAxis: [1, 0, 0] },
  bottom: { normal: [0, 0, -1], xAxis: [1, 0, 0] },
  right: { normal: [1, 0, 0], xAxis: [0, 1, 0] },
  left: { normal: [-1, 0, 0], xAxis: [0, -1, 0] },
  isometric: {
    normal: [isometricNormal, -isometricNormal, isometricNormal],
    xAxis: [isometricAxis, isometricAxis, 0],
  },
}

/** Absolute chordal deviation of display polylines from projected free-form curves. */
export const DRAWING_CHORD_TOLERANCE_MM = 0.01
export const DRAWING_ANGULAR_TOLERANCE_RAD = 0.05
/** Points per emitted polyline; longer sampled curves are split into chained polylines. */
export const MAX_DRAWING_CURVE_POINTS = 4_096
/** Samples one projected curve may need at the chordal tolerance before projection fails. */
export const MAX_DRAWING_CURVE_SAMPLES = 65_536
export const MAX_DRAWING_VIEW_EDGES = 50_000

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000)
const point = z.tuple([coordinate, coordinate])
const radius = z.number().finite().positive().max(1_000_000)
const angle = z
  .number()
  .finite()
  .min(-4 * Math.PI)
  .max(4 * Math.PI)

/** Exact lines and circles survive projection unchanged; other curves arrive as polylines. */
export const drawingCurveSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("line"), start: point, end: point }),
  z.strictObject({ kind: z.literal("circle"), center: point, radius }),
  z
    .strictObject({
      kind: z.literal("arc"),
      center: point,
      radius,
      startAngle: angle,
      endAngle: angle,
    })
    .refine(
      (arc) => arc.endAngle > arc.startAngle && arc.endAngle - arc.startAngle < 2 * Math.PI,
      "Arcs sweep counter-clockwise from start to end by less than a full turn.",
    ),
  z.strictObject({
    kind: z.literal("polyline"),
    points: z.array(point).min(2).max(MAX_DRAWING_CURVE_POINTS),
  }),
])
export type DrawingCurve = z.infer<typeof drawingCurveSchema>

/** `sharp` edges bound faces, `smooth` edges join tangent faces and `outline` edges are silhouettes. */
export const drawingEdgeClassSchema = z.enum(["sharp", "smooth", "outline"])
export const drawingEdgeSchema = z.strictObject({
  visibility: z.enum(["visible", "hidden"]),
  edgeClass: drawingEdgeClassSchema,
  curve: drawingCurveSchema,
})
export type DrawingEdge = z.infer<typeof drawingEdgeSchema>

const bounds2d = z
  .strictObject({ min: point, max: point })
  .refine(
    (value) => value.min[0] <= value.max[0] && value.min[1] <= value.max[1],
    "Bounds minimum must not exceed maximum.",
  )
export type DrawingBounds = z.infer<typeof bounds2d>

export const drawingViewProjectionSchema = z.strictObject({
  view: drawingViewIdSchema,
  bounds: bounds2d,
  edges: z.array(drawingEdgeSchema).max(MAX_DRAWING_VIEW_EDGES),
})
export type DrawingViewProjection = z.infer<typeof drawingViewProjectionSchema>

export const drawingProjectionSchema = z
  .strictObject({
    chordTolerance: z.literal(DRAWING_CHORD_TOLERANCE_MM),
    bodyCount: z.number().int().positive().max(4_096),
    views: z.array(drawingViewProjectionSchema).min(1).max(DRAWING_VIEW_IDS.length),
  })
  .refine(
    (value) => new Set(value.views.map(({ view }) => view)).size === value.views.length,
    "Each drawing view may be projected once.",
  )
export type DrawingProjection = z.infer<typeof drawingProjectionSchema>

export const drawingProjectionViewsSchema = z
  .array(drawingViewIdSchema)
  .min(1)
  .max(DRAWING_VIEW_IDS.length)
  .refine((views) => new Set(views).size === views.length, "Drawing views must be unique.")
