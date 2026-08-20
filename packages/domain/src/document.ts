import { z } from "zod"
import { type FeatureRecord, featureRecordsSchema } from "./feature-graph"
import { documentIdSchema, revisionSchema, timestampSchema } from "./identifiers"
import { type SketchRecord, sketchRecordsSchema } from "./sketch"
import { angleInputUnitSchema, lengthInputUnitSchema } from "./units"
import { type VariableDefinition, variableDefinitionsSchema } from "./variables"

export const documentNameInputSchema = z.string().trim().min(1).max(120)
export const documentNameSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((name) => name.trim() === name, "Document names must be normalized.")

export const defaultDocumentDisplayUnits = {
  length: "mm",
  angle: "deg",
} as const

export const documentDisplayUnitsSchema = z
  .object({
    length: lengthInputUnitSchema,
    angle: angleInputUnitSchema,
  })
  .strict()

export type DocumentDisplayUnits = Readonly<z.infer<typeof documentDisplayUnitsSchema>>

export const documentSnapshotSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: documentIdSchema,
    revision: revisionSchema,
    name: documentNameSchema,
    displayUnits: documentDisplayUnitsSchema.default(defaultDocumentDisplayUnits),
    variables: variableDefinitionsSchema.default([]),
    sketches: sketchRecordsSchema.default([]),
    features: featureRecordsSchema.default([]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((document, context) => {
    const featureIds = new Set(document.features.map(({ id }) => id))
    for (const [index, sketch] of document.sketches.entries()) {
      const supportFeatureId = sketch.support?.reference.featureId
      if (!supportFeatureId || featureIds.has(supportFeatureId)) continue
      context.addIssue({
        code: "custom",
        path: ["sketches", index, "support", "reference", "featureId"],
        message: "A sketch support must reference an existing feature.",
      })
    }
  })

type ParsedDocumentSnapshot = z.infer<typeof documentSnapshotSchema>

export type DocumentSnapshot = Readonly<
  Omit<ParsedDocumentSnapshot, "features" | "sketches" | "variables"> & {
    variables: readonly VariableDefinition[]
    sketches: readonly SketchRecord[]
    features: readonly FeatureRecord[]
  }
>
