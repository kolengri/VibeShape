import { z } from "zod"
import { shellOpeningContentSchema } from "./geometry-worker"

/** Inclusive lower bound; OCCT silently leaves faces untouched at or below 1e-4 rad. */
export const DRAFT_MIN_ANGLE_RADIANS = (0.01 * Math.PI) / 180
/** Exclusive upper bound shared by the authored Draft angle and its worker content. */
export const DRAFT_MAX_ANGLE_RADIANS = (89 * Math.PI) / 180
export const SCALE_MIN_FACTOR = 0.001
export const SCALE_MAX_FACTOR = 1000

const coordinate = z.number().finite().min(-100_000).max(100_000)
const point = z.tuple([coordinate, coordinate, coordinate])
const unitDirection = point.refine(
  (value) => Math.abs(Math.hypot(...value) - 1) <= 1e-8,
  "Draft directions must be normalized.",
)

/** Worker content for Draft after the neutral plane and pull direction are resolved. */
export const draftFeatureContentParametersSchema = z
  .object({
    faces: z.array(shellOpeningContentSchema).min(1).max(256),
    planeOrigin: point,
    planeNormal: unitDirection,
    pullDirection: unitDirection,
    angle: z.number().finite().gte(DRAFT_MIN_ANGLE_RADIANS).lt(DRAFT_MAX_ANGLE_RADIANS),
    supportInputIndex: z.union([z.literal(0), z.literal(1)]).optional(),
  })
  .strict()
export type DraftFeatureContentParameters = z.infer<typeof draftFeatureContentParametersSchema>

export const scaleCenterContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("origin") }).strict(),
  z.object({ kind: z.literal("bounding-box-center") }).strict(),
  z.object({ kind: z.literal("point"), point }).strict(),
])
export const scaleFeatureContentParametersSchema = z
  .object({
    factor: z.number().finite().min(SCALE_MIN_FACTOR).max(SCALE_MAX_FACTOR),
    center: scaleCenterContentSchema,
  })
  .strict()
export type ScaleFeatureContentParameters = z.infer<typeof scaleFeatureContentParametersSchema>
