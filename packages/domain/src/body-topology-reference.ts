import { z } from "zod"
import { bodyOutputRoleSchema } from "./body-reference"
import { featureIdSchema } from "./identifiers"
import { topoRefContentSchema } from "./topology"

/** Stable references to one named body output; native candidate IDs never enter persistence. */
export const bodyTopoRefContentSchema = z
  .object({
    ...topoRefContentSchema.shape,
    schemaVersion: z.literal(1),
    outputRole: bodyOutputRoleSchema,
    kind: z.enum(["edge", "face"]),
  })
  .strict()
  .refine((reference) => reference.kind === reference.signature.kind, {
    message: "Body TopoRef kind must match its signature kind.",
    path: ["signature", "kind"],
  })
export const bodyTopoRefSchema = bodyTopoRefContentSchema.safeExtend({ featureId: featureIdSchema })
export const bodyFaceRefSchema = bodyTopoRefSchema.safeExtend({ kind: z.literal("face") })
export type BodyTopoRef = Readonly<z.infer<typeof bodyTopoRefSchema>>
export type BodyFaceRef = Readonly<z.infer<typeof bodyFaceRefSchema>>
