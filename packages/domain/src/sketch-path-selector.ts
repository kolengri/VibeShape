import { z } from "zod"
import { sketchEntityIdSchema, sketchIdSchema } from "./identifiers"

const MAX_SKETCH_PATH_ENTITIES = 2_000

/** The start point owns direction; persisted entity IDs describe selection, not traversal order. */
export const sketchPathSelectorSchema = z
  .object({
    schemaVersion: z.literal(0),
    sketchId: sketchIdSchema,
    entityIds: z
      .array(sketchEntityIdSchema)
      .min(1)
      .max(MAX_SKETCH_PATH_ENTITIES)
      .refine(
        (ids) => ids.every((id, index) => index === 0 || (ids[index - 1] ?? "") < id),
        "Path entity IDs must be unique and sorted.",
      ),
    startPointId: sketchEntityIdSchema,
  })
  .strict()

export type SketchPathSelector = Readonly<z.infer<typeof sketchPathSelectorSchema>>

export function sketchPathSelectorKey(selector: SketchPathSelector) {
  return JSON.stringify([selector.sketchId, selector.entityIds, selector.startPointId])
}
