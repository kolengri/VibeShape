import { z } from "zod"
import { bodyOutputRoleSchema } from "./body-reference"
import { sha256Schema } from "./feature-content-identity"
import type { FeatureRecord } from "./feature-graph"
import { documentIdSchema, revisionSchema } from "./identifiers"
import { type ModelMeasurementEntry, modelMeasurementEntrySchema } from "./model-measurements"
import { readDatumPlaneFeatureParameters } from "./reference-geometry"

const rootShapeSchema = modelMeasurementEntrySchema.options[0].shape.shape

export const modelBodyMeasurementEntrySchema = z
  .object({
    featureId: modelMeasurementEntrySchema.options[0].shape.featureId,
    outputRole: bodyOutputRoleSchema.optional(),
    contentHash: sha256Schema,
    shape: rootShapeSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.outputRole !== undefined &&
      (entry.shape.volume <= 0 || entry.shape.solidCount !== 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["shape"],
        message: "Named body measurements require a positive-volume single solid.",
      })
    }
  })

export type ModelBodyMeasurementEntry = Readonly<z.infer<typeof modelBodyMeasurementEntrySchema>>

function evidenceIssue(context: z.RefinementCtx, path: (string | number)[], message: string) {
  context.addIssue({ code: "custom", path, message })
}

function evidenceFeatures(features: readonly ModelMeasurementEntry[], context: z.RefinementCtx) {
  const byId = new Map<string, ModelMeasurementEntry>()
  for (const [index, feature] of features.entries()) {
    if (byId.has(feature.featureId))
      evidenceIssue(context, ["features", index, "featureId"], "Feature IDs must be unique.")
    byId.set(feature.featureId, feature)
  }
  return byId
}

function evidenceBodies(
  bodies: readonly ModelBodyMeasurementEntry[],
  features: ReadonlyMap<string, ModelMeasurementEntry>,
  context: z.RefinementCtx,
) {
  const byFeature = new Map<string, ModelBodyMeasurementEntry[]>()
  const keys = new Set<string>()
  for (const [index, body] of bodies.entries()) {
    const key = `${body.featureId}\u0000${body.outputRole ?? ""}`
    if (keys.has(key)) evidenceIssue(context, ["bodies", index], "Body keys must be unique.")
    keys.add(key)
    const feature = features.get(body.featureId)
    if (feature?.status !== "succeeded" || feature.contentHash !== body.contentHash) {
      evidenceIssue(context, ["bodies", index], "Body provenance must match a successful feature.")
      continue
    }
    const group = byFeature.get(body.featureId) ?? []
    group.push(body)
    byFeature.set(body.featureId, group)
  }
  return byFeature
}

function validateCatalogRoot(
  root: Extract<ModelMeasurementEntry, { status: "succeeded" }>,
  bodies: readonly ModelBodyMeasurementEntry[],
  context: z.RefinementCtx,
) {
  const namedCount = bodies.filter((body) => body.outputRole !== undefined).length
  if (namedCount > 0) {
    if (namedCount !== bodies.length)
      evidenceIssue(context, ["bodies"], "Named and unnamed body outputs cannot be mixed.")
    if (namedCount !== root.shape.solidCount)
      evidenceIssue(context, ["bodies"], "Named body outputs must cover every root solid.")
    return
  }
  if (JSON.stringify(bodies[0]?.shape) !== JSON.stringify(root.shape))
    evidenceIssue(context, ["bodies"], "Unnamed body metrics must equal the feature root.")
}

function validateCatalogs(
  features: ReadonlyMap<string, ModelMeasurementEntry>,
  bodies: ReadonlyMap<string, readonly ModelBodyMeasurementEntry[]>,
  context: z.RefinementCtx,
) {
  for (const [featureId, group] of bodies) {
    if (group.length > 256)
      evidenceIssue(context, ["bodies"], "A feature may have at most 256 body outputs.")
    const root = features.get(featureId)
    if (root?.status !== "succeeded") continue
    if (root.shape.solidCount === 0)
      evidenceIssue(context, ["bodies"], "Empty features cannot have body outputs.")
    validateCatalogRoot(root, group, context)
  }
}

export const modelBodyMeasurementEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
    features: z.array(modelMeasurementEntrySchema).max(100_000),
    bodies: z.array(modelBodyMeasurementEntrySchema).max(100_000),
  })
  .strict()
  .superRefine((evidence, context) => {
    const features = evidenceFeatures(evidence.features, context)
    const bodies = evidenceBodies(evidence.bodies, features, context)
    validateCatalogs(features, bodies, context)
  })

export type ModelBodyMeasurementEvidence = Readonly<
  z.infer<typeof modelBodyMeasurementEvidenceSchema>
>

function measurementFeatureCoverage(
  features: readonly FeatureRecord[],
  evidence: ModelBodyMeasurementEvidence,
) {
  const byId = new Map(evidence.features.map((entry) => [entry.featureId, entry]))
  return byId.size === features.length && features.every((feature) => byId.has(feature.id))
    ? byId
    : null
}

function groupedBodyMeasurements(bodies: readonly ModelBodyMeasurementEntry[]) {
  const groups = new Map<string, ModelBodyMeasurementEntry[]>()
  for (const body of bodies) {
    const group = groups.get(body.featureId) ?? []
    group.push(body)
    groups.set(body.featureId, group)
  }
  return groups
}

function expectsBodyMeasurements(feature: FeatureRecord, entry: ModelMeasurementEntry) {
  return (
    entry.status === "succeeded" &&
    entry.shape.solidCount > 0 &&
    !readDatumPlaneFeatureParameters(feature)
  )
}

function completeBodyOutputs(
  features: readonly FeatureRecord[],
  evidence: ModelBodyMeasurementEvidence,
): ReadonlyMap<string, readonly ModelBodyMeasurementEntry[]> | null {
  const byId = measurementFeatureCoverage(features, evidence)
  if (!byId) return null
  const bodies = groupedBodyMeasurements(evidence.bodies)
  const result = new Map<string, readonly ModelBodyMeasurementEntry[]>()
  for (const feature of features) {
    const entry = byId.get(feature.id)
    if (!entry) return null
    const outputs = bodies.get(feature.id) ?? []
    if (Boolean(outputs.length) !== expectsBodyMeasurements(feature, entry)) return null
    if (entry.status === "succeeded") result.set(feature.id, outputs)
  }
  return result
}

export function bodyMeasurementOutputs(
  features: readonly FeatureRecord[],
  evidence: ModelBodyMeasurementEvidence,
): ReadonlyMap<string, readonly ModelBodyMeasurementEntry[]> | null {
  const parsed = modelBodyMeasurementEvidenceSchema.safeParse(evidence)
  return parsed.success ? completeBodyOutputs(features, parsed.data) : null
}
