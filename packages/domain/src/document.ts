import { z } from "zod"
import { type FeatureRecord, featureRecordsSchema } from "./feature-graph"
import { documentIdSchema, revisionSchema, timestampSchema } from "./identifiers"
import { type VariableDefinition, variableDefinitionsSchema } from "./variables"

export const documentNameInputSchema = z.string().trim().min(1).max(120)
export const documentNameSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((name) => name.trim() === name, "Document names must be normalized.")

export const documentSnapshotSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: documentIdSchema,
    revision: revisionSchema,
    name: documentNameSchema,
    variables: variableDefinitionsSchema.default([]),
    features: featureRecordsSchema.default([]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

type ParsedDocumentSnapshot = z.infer<typeof documentSnapshotSchema>

export type DocumentSnapshot = Readonly<
  Omit<ParsedDocumentSnapshot, "features" | "variables"> & {
    variables: readonly VariableDefinition[]
    features: readonly FeatureRecord[]
  }
>
