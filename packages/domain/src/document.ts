import { z } from "zod"
import { createDocumentDependencyGraph } from "./document-graph"
import { type HistoryItemRef, historyItemsSchema } from "./document-node"
import {
  type FeatureRecord,
  type FeatureRecordV1,
  featureRecordsSchema,
  featureRecordsV1Schema,
} from "./feature-graph"
import { documentIdSchema, revisionSchema, timestampSchema } from "./identifiers"
import {
  isOrphanedModelReference,
  isSketchExternalModelReference,
  type SketchExternalReference,
  type SketchRecord,
  sketchRecordsSchema,
} from "./sketch"
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
  features: readonly Pick<FeatureRecord, "id">[]
  sketches: readonly SketchRecord[]
  history?: readonly HistoryItemRef[]
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
  sketchOrder: number | undefined
  source: SketchRecord
  sourceOrder: number | undefined
}>

function externalReferencePath(
  input: Pick<ExternalReferenceValidationInput, "referenceIndex" | "sketchIndex">,
) {
  return ["sketches", input.sketchIndex, "externalReferences", input.referenceIndex] as const
}

function validateExternalReferenceOrder(input: ExternalReferenceValidationInput) {
  if (
    input.source.id !== input.sketch.id &&
    input.sourceOrder !== undefined &&
    input.sketchOrder !== undefined &&
    input.sourceOrder < input.sketchOrder
  )
    return
  addDocumentIssue(
    input.context,
    [...externalReferencePath(input), "sourceSketchId"],
    "An external sketch reference must reference an earlier sketch.",
  )
}

function validateExternalSketchReference(input: {
  context: z.RefinementCtx
  reference: SketchExternalReference
  referenceIndex: number
  sketch: SketchRecord
  sketchIndex: number
  sketchOrder: number | undefined
  source: SketchRecord | undefined
  sourceOrder: number | undefined
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
}

function validateExternalModelReference(input: {
  context: z.RefinementCtx
  featureIds: ReadonlySet<string>
  reference: Extract<SketchExternalReference, { kind: `model-${string}` }>
  referenceIndex: number
  sketchIndex: number
}) {
  const { context, featureIds, reference, referenceIndex, sketchIndex } = input
  const featureExists = featureIds.has(reference.reference.featureId)
  if (isOrphanedModelReference(reference)) {
    if (!featureExists) return
    addDocumentIssue(
      context,
      [
        "sketches",
        sketchIndex,
        "externalReferences",
        referenceIndex,
        "orphanedSource",
        "featureId",
      ],
      "An orphaned model reference cannot target an existing feature.",
    )
    return
  }
  if (featureExists) return
  addDocumentIssue(
    context,
    ["sketches", sketchIndex, "externalReferences", referenceIndex, "reference", "featureId"],
    "An external model reference must reference an existing feature.",
  )
}

function validateDocumentSketchReferences(
  document: DocumentReferenceValidationInput,
  context: z.RefinementCtx,
) {
  const featureIds = new Set(document.features.map(({ id }) => id))
  const sketchesById = new Map(document.sketches.map((sketch) => [sketch.id, sketch]))
  const sketchOrderById = new Map(
    document.history
      ? document.history
          .filter(
            (item): item is Extract<HistoryItemRef, { kind: "sketch" }> => item.kind === "sketch",
          )
          .map((item, index) => [item.id, index] as const)
      : document.sketches.map((sketch, index) => [sketch.id, index] as const),
  )
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
      if (isSketchExternalModelReference(reference)) {
        validateExternalModelReference({
          context,
          featureIds,
          reference,
          referenceIndex,
          sketchIndex,
        })
        continue
      }
      validateExternalSketchReference({
        context,
        reference,
        referenceIndex,
        sketch,
        sketchIndex,
        sketchOrder: sketchOrderById.get(sketch.id),
        source: sketchesById.get(reference.sourceSketchId),
        sourceOrder: sketchOrderById.get(reference.sourceSketchId),
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

export const documentSnapshotV0Schema = documentSnapshotSchema

export const documentSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: documentIdSchema,
    revision: revisionSchema,
    name: documentNameSchema,
    displayUnits: documentDisplayUnitsSchema,
    variables: variableDefinitionsSchema,
    sketches: sketchRecordsSchema,
    features: featureRecordsV1Schema,
    history: historyItemsSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((document, context) => {
    validateDocumentSketchReferences(document, context)
    const graph = createDocumentDependencyGraph(document)
    if (graph.ok) return
    context.addIssue({
      code: "custom",
      path: ["history"],
      message: graph.diagnostic.message,
    })
    for (const issue of graph.diagnostic.issues.slice(0, 8))
      context.addIssue({
        code: "custom",
        path: issue.path.split(".").filter(Boolean),
        message: issue.message,
      })
  })

type ParsedDocumentSnapshotV1 = z.infer<typeof documentSnapshotV1Schema>
export type DocumentSnapshotV1 = Readonly<
  Omit<ParsedDocumentSnapshotV1, "features" | "sketches" | "variables" | "history"> & {
    variables: readonly VariableDefinition[]
    sketches: readonly SketchRecord[]
    features: readonly FeatureRecordV1[]
    history: ParsedDocumentSnapshotV1["history"]
  }
>
export const versionedDocumentSnapshotSchema = z.union([
  documentSnapshotSchema,
  documentSnapshotV1Schema,
])
export type VersionedDocumentSnapshot = DocumentSnapshot | DocumentSnapshotV1
