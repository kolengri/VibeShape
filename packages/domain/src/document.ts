import { z } from "zod"
import { type FeatureRecord, featureRecordsSchema } from "./feature-graph"
import { documentIdSchema, revisionSchema, timestampSchema } from "./identifiers"
import { type SketchExternalReference, type SketchRecord, sketchRecordsSchema } from "./sketch"
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

type DocumentReferenceValidationInput = Readonly<{
  features: readonly FeatureRecord[]
  sketches: readonly SketchRecord[]
}>

function addDocumentIssue(context: z.RefinementCtx, path: readonly PropertyKey[], message: string) {
  context.addIssue({ code: "custom", path: [...path], message })
}

type ExternalReferenceValidationInput = Readonly<{
  context: z.RefinementCtx
  reference: SketchExternalReference
  referenceIndex: number
  sketch: SketchRecord
  sketchIndex: number
  source: SketchRecord
  sourceIndex: number
}>

function externalReferencePath(
  input: Pick<ExternalReferenceValidationInput, "referenceIndex" | "sketchIndex">,
) {
  return ["sketches", input.sketchIndex, "externalReferences", input.referenceIndex] as const
}

function validateExternalReferenceOrder(input: ExternalReferenceValidationInput) {
  if (input.source.id !== input.sketch.id && input.sourceIndex < input.sketchIndex) return
  addDocumentIssue(
    input.context,
    [...externalReferencePath(input), "sourceSketchId"],
    "An external sketch reference must reference an earlier sketch.",
  )
}

function externalReferenceSourceSelector(reference: SketchExternalReference) {
  if (reference.kind === "model-point" || reference.kind === "model-line") return null
  if (reference.kind === "line") {
    return { entityId: reference.sourceLineId, entityType: "line", path: "sourceLineId" } as const
  }
  if (reference.kind === "curve") {
    return {
      entityId: reference.sourceEntityId,
      entityType: reference.sourceType,
      path: "sourceEntityId",
    } as const
  }
  return { entityId: reference.sourcePointId, entityType: "point", path: "sourcePointId" } as const
}

function validateExternalReferenceSource(input: ExternalReferenceValidationInput) {
  const path = externalReferencePath(input)
  const selector = externalReferenceSourceSelector(input.reference)
  if (!selector) return
  const sourceEntity = input.source.entities.find(({ id }) => id === selector.entityId)
  if (sourceEntity?.type === selector.entityType) return
  addDocumentIssue(
    input.context,
    [...path, selector.path],
    `An external sketch reference must target a source ${selector.entityType}.`,
  )
}

function validateExternalSketchReference(input: {
  context: z.RefinementCtx
  reference: SketchExternalReference
  referenceIndex: number
  sketch: SketchRecord
  sketchIndex: number
  source: SketchRecord | undefined
  sourceIndex: number
}) {
  const path = ["sketches", input.sketchIndex, "externalReferences", input.referenceIndex] as const
  if (!input.source) {
    addDocumentIssue(
      input.context,
      [...path, "sourceSketchId"],
      "An external sketch reference must reference an existing source sketch.",
    )
    return
  }
  const resolved = { ...input, source: input.source }
  validateExternalReferenceOrder(resolved)
  validateExternalReferenceSource(resolved)
}

function validateDocumentSketchReferences(
  document: DocumentReferenceValidationInput,
  context: z.RefinementCtx,
) {
  const featureIds = new Set(document.features.map(({ id }) => id))
  const sketchesById = new Map(document.sketches.map((sketch) => [sketch.id, sketch]))
  for (const [sketchIndex, sketch] of document.sketches.entries()) {
    const supportFeatureId = sketch.support?.reference.featureId
    if (supportFeatureId && !featureIds.has(supportFeatureId)) {
      addDocumentIssue(
        context,
        ["sketches", sketchIndex, "support", "reference", "featureId"],
        "A sketch support must reference an existing feature.",
      )
    }
    for (const [referenceIndex, reference] of (sketch.externalReferences ?? []).entries()) {
      if (reference.kind === "model-point" || reference.kind === "model-line") {
        if (!featureIds.has(reference.reference.featureId)) {
          addDocumentIssue(
            context,
            [
              "sketches",
              sketchIndex,
              "externalReferences",
              referenceIndex,
              "reference",
              "featureId",
            ],
            "An external model reference must reference an existing feature.",
          )
        }
        continue
      }
      validateExternalSketchReference({
        context,
        reference,
        referenceIndex,
        sketch,
        sketchIndex,
        source: sketchesById.get(reference.sourceSketchId),
        sourceIndex: document.sketches.findIndex(
          (candidate) => candidate.id === reference.sourceSketchId,
        ),
      })
    }
  }
}

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
  .superRefine(validateDocumentSketchReferences)

type ParsedDocumentSnapshot = z.infer<typeof documentSnapshotSchema>

export type DocumentSnapshot = Readonly<
  Omit<ParsedDocumentSnapshot, "features" | "sketches" | "variables"> & {
    variables: readonly VariableDefinition[]
    sketches: readonly SketchRecord[]
    features: readonly FeatureRecord[]
  }
>
