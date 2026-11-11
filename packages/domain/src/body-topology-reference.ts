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

/** A stable vertex of one named body output; vertex evidence is derived from edge endpoints. */
export const bodyVertexRefSchema = z
  .object({
    ...topoRefContentSchema.shape,
    schemaVersion: z.literal(1),
    featureId: featureIdSchema,
    outputRole: bodyOutputRoleSchema,
    kind: z.literal("vertex"),
  })
  .strict()
  .refine(({ signature }) => signature.kind === "vertex" && signature.geometryClass === "POINT", {
    message: "Body vertex references require a POINT vertex signature.",
    path: ["signature"],
  })
export type BodyVertexRef = Readonly<z.infer<typeof bodyVertexRefSchema>>
