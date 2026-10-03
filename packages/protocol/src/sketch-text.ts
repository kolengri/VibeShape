import { z } from "zod"

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const finite = z.number().finite()
const fontSchema = z
  .object({
    immutableId: z.literal("noto-sans-regular-2.008-v1"),
    digest: z.literal("b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5"),
    faceIndex: z.literal(0),
    byteLength: z.literal(569208),
    family: z.literal("Noto Sans"),
    style: z.literal("Regular"),
    revision: z.literal("2.008"),
    unitsPerEm: z.literal(1000),
    capHeight: z.literal(714),
    xHeight: z.literal(536),
    ascender: z.literal(1069),
    descender: z.literal(-293),
  })
  .strict()
const text = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) =>
      [...value].length <= 64 &&
      value.normalize("NFC") === value &&
      !/[\p{C}\p{M}\p{Zl}\p{Zp}]/u.test(value) &&
      /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}]+$/u.test(value),
  )
export const sketchTextGroupWireSchema = z
  .object({
    schemaVersion: z.literal(0),
    id,
    parameters: z
      .object({
        schemaVersion: z.literal(0),
        text,
        font: fontSchema,
        layoutEngine: z.literal("unicode-scalar-kerning-v1"),
        outlineSdk: z.literal("opentype.js@2.0.0"),
        heightMm: finite.min(0.01).max(1000),
        alignment: z
          .object({
            horizontal: z.enum(["left", "center", "right"]),
            vertical: z.enum(["baseline", "bottom", "center", "top"]),
          })
          .strict(),
        trackingMm: finite.min(-1000).max(1000),
        kerning: z.boolean(),
      })
      .strict(),
    origin: z.tuple([finite.min(-100000).max(100000), finite.min(-100000).max(100000)]),
    curveIds: z.array(id).min(1).max(2000),
    pointIds: z.array(id).min(1).max(2000),
    outlineDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

export function validateTextGroupWireReferences(
  sketch: {
    textGroups?: readonly z.infer<typeof sketchTextGroupWireSchema>[] | undefined
    entities: readonly { id: string; type: string }[]
  },
  context: z.RefinementCtx,
) {
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity.type]))
  const identities = new Set<string>()
  const outlineIds = new Set<string>()
  for (const [index, group] of (sketch.textGroups ?? []).entries()) {
    const ids = [...group.curveIds, ...group.pointIds]
    if (
      identities.has(group.id) ||
      entities.has(group.id) ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => outlineIds.has(id)) ||
      group.pointIds.some((id) => entities.get(id) !== "point") ||
      group.curveIds.some((id) => !["line", "cubic-bezier"].includes(entities.get(id) ?? ""))
    )
      context.addIssue({
        code: "custom",
        path: ["textGroups", index],
        message: "Text outline references must be exclusive, existing typed entities.",
      })
    identities.add(group.id)
    for (const id of ids) outlineIds.add(id)
  }
}
