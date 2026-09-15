import { z } from "zod"
import { featureIdSchema } from "./identifiers"

const outputRolePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

export const bodyOutputRoleSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(outputRolePattern, "Body output roles must use normalized lowercase identifiers.")

export const bodyReferenceSchema = z
  .object({
    schemaVersion: z.literal(0),
    featureId: featureIdSchema,
    outputRole: bodyOutputRoleSchema,
  })
  .strict()

export type BodyReference = Readonly<z.infer<typeof bodyReferenceSchema>>
