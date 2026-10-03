import { z } from "zod"
import { sketchEntityIdSchema } from "./identifiers"
import {
  SKETCH_TEXT_MAX_POLES,
  SKETCH_TEXT_MAX_SEGMENTS,
  sketchTextParametersSchema,
} from "./sketch-text"

const coordinate = z.number().finite().min(-100_000).max(100_000)
export const sketchTextGroupSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: sketchEntityIdSchema,
    parameters: sketchTextParametersSchema,
    origin: z.tuple([coordinate, coordinate]),
    curveIds: z.array(sketchEntityIdSchema).min(1).max(SKETCH_TEXT_MAX_SEGMENTS),
    pointIds: z.array(sketchEntityIdSchema).min(1).max(SKETCH_TEXT_MAX_POLES),
    outlineDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
export type SketchTextGroup = z.infer<typeof sketchTextGroupSchema>

export function validateSketchTextGroups(
  sketch: {
    textGroups?: readonly SketchTextGroup[] | undefined
    entities: readonly { id: string; type: string }[]
  },
  context: z.RefinementCtx,
) {
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity.type]))
  const ids = new Set<string>()
  const owned = new Set<string>()
  for (const [index, group] of (sketch.textGroups ?? []).entries()) {
    const invalid =
      ids.has(group.id) ||
      entities.has(group.id) ||
      group.curveIds.some((id) => !["line", "cubic-bezier"].includes(entities.get(id) ?? "")) ||
      group.pointIds.some((id) => entities.get(id) !== "point") ||
      [...group.curveIds, ...group.pointIds].some((id) => owned.has(id)) ||
      new Set([...group.curveIds, ...group.pointIds]).size !==
        group.curveIds.length + group.pointIds.length
    if (invalid)
      context.addIssue({
        code: "custom",
        path: ["textGroups", index],
        message:
          "Text groups require distinct stable identities and exclusive existing outline entities.",
      })
    ids.add(group.id)
    for (const id of [...group.curveIds, ...group.pointIds]) owned.add(id)
  }
}
