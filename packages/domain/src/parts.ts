import { z } from "zod"
import { type BodyReference, bodyReferenceSchema } from "./body-reference"
import { featureIdSchema, type PartId, partIdSchema } from "./identifiers"

export const authoredItemNameSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((name) => name.trim() === name, "Authored names must be normalized.")

export const partOriginSchema = z.enum(["independent", "fork"])
export type PartOrigin = z.infer<typeof partOriginSchema>

/** Bindings are authored semantic roles, never native solid enumeration indices. */
export const partRecordSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: partIdSchema,
    name: authoredItemNameSchema,
    visible: z.boolean(),
    origin: partOriginSchema,
    bodyHistory: z.array(bodyReferenceSchema).min(1).max(100_000),
    consumedBy: featureIdSchema.nullable(),
  })
  .strict()
  .superRefine((part, context) => {
    const ids = part.bodyHistory.map((body) => body.featureId)
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        path: ["bodyHistory"],
        message: "A part cannot bind the same producer twice.",
      })
    if (part.consumedBy !== null && ids.includes(part.consumedBy))
      context.addIssue({
        code: "custom",
        path: ["consumedBy"],
        message: "A part cannot consume itself.",
      })
  })
export type PartRecord = Readonly<
  Omit<z.infer<typeof partRecordSchema>, "bodyHistory"> & {
    bodyHistory: readonly BodyReference[]
  }
>
export const partRecordsSchema = z
  .array(partRecordSchema)
  .max(4_096)
  .superRefine((parts, context) => {
    if (new Set(parts.map((part) => part.id)).size !== parts.length)
      context.addIssue({ code: "custom", message: "Part IDs must be unique." })
    if (parts.reduce((count, part) => count + part.bodyHistory.length, 0) > 100_000)
      context.addIssue({ code: "custom", message: "Part bindings exceed the document budget." })
    const bindings = parts.flatMap((part) =>
      part.bodyHistory.map((body) => `${body.featureId}:${body.outputRole}`),
    )
    if (new Set(bindings).size !== bindings.length)
      context.addIssue({ code: "custom", message: "A semantic body can belong to only one part." })
  })

export function partBodyReference(part: PartRecord): BodyReference {
  const body = part.bodyHistory.at(-1)
  if (!body) throw new Error("A validated part must have a body binding.")
  return body
}

/** Allocate once when preparing a command; replay never generates IDs or default names. */
export const partAllocationSchema = z
  .object({
    id: partIdSchema,
    body: bodyReferenceSchema,
    name: authoredItemNameSchema,
    origin: partOriginSchema,
  })
  .strict()
export type PartAllocation = Readonly<z.infer<typeof partAllocationSchema>>
export const partAllocationsSchema = z.array(partAllocationSchema).max(4_096)

export const partEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), part: partRecordSchema }).strict(),
  z.object({ kind: z.literal("replace"), part: partRecordSchema }).strict(),
  z.object({ kind: z.literal("remove"), partId: partIdSchema }).strict(),
])
export const partEffectsSchema = z
  .array(partEffectSchema)
  .max(8_192)
  .superRefine((effects, context) => {
    const ids = effects.map((effect) => (effect.kind === "remove" ? effect.partId : effect.part.id))
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "An atomic event may affect each part only once.",
      })
    const bindings = effects.reduce(
      (count, effect) => count + (effect.kind === "remove" ? 0 : effect.part.bodyHistory.length),
      0,
    )
    if (bindings > 100_000)
      context.addIssue({
        code: "custom",
        message: "Part effects exceed the atomic binding budget.",
      })
  })
export type PartEffect =
  | Readonly<{ kind: "create" | "replace"; part: PartRecord }>
  | Readonly<{ kind: "remove"; partId: PartId }>
