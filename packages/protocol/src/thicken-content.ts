import { z } from "zod"
import { shellOpeningContentSchema } from "./geometry-worker"

/** Inclusive thickness bounds shared by the authored Thicken feature and its worker content. */
export const THICKEN_MIN_THICKNESS = 0.001
export const THICKEN_MAX_THICKNESS = 10_000

/** Worker content for Thicken: body-bound faces without document UUIDs, in selection order. */
export const thickenFeatureContentParametersSchema = z
  .object({
    faces: z.array(shellOpeningContentSchema).min(1).max(256),
    thickness: z.number().finite().gte(THICKEN_MIN_THICKNESS).lte(THICKEN_MAX_THICKNESS),
    side: z.enum(["outward", "inward", "symmetric"]),
    operation: z.enum(["new", "add", "remove"]),
  })
  .strict()
export type ThickenFeatureContentParameters = z.infer<typeof thickenFeatureContentParametersSchema>
