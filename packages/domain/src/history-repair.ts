import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import { documentNodeRefSchema } from "./document-node"
import { type FeatureRecordV1, featureRecordV1Schema, featureTypeSchema } from "./feature-graph"
import { featureTypeKey } from "./feature-type-contracts"
import { type SketchRecord, sketchRecordSchema } from "./sketch"

export const missingInputFeatureType = featureTypeSchema.parse({
  moduleId: "org.vibeshape.history-repair",
  moduleVersion: "1.0.0",
  typeId: "org.vibeshape.feature.history.missing-input",
  schemaVersion: 1,
})

const missingInputsSchema = z
  .array(documentNodeRefSchema)
  .min(1)
  .max(1_024)
  .superRefine((inputs, context) => {
    if (new Set(inputs.map(nodeKey)).size !== inputs.length)
      context.addIssue({ code: "custom", message: "Missing input declarations must be unique." })
  })
export const missingInputFeatureParametersSchema = z
  .object({ missingInputs: missingInputsSchema })
  .strict()

export const historyRepairIntentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("feature"),
      authored: featureRecordV1Schema,
      missingInputs: missingInputsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("sketch"),
      authored: sketchRecordSchema,
      missingInputs: missingInputsSchema,
    })
    .strict(),
])
export type HistoryRepairIntent = Readonly<z.infer<typeof historyRepairIntentSchema>>
export const historyRepairIntentsSchema = z
  .array(historyRepairIntentSchema)
  .max(100_256)
  .superRefine((intents, context) => {
    if (
      new Set(intents.map((intent) => `${intent.kind}:${intent.authored.id}`)).size !==
      intents.length
    )
      context.addIssue({
        code: "custom",
        message: "Each History item may have only one repair intent.",
      })
    if (intents.reduce((count, intent) => count + intent.missingInputs.length, 0) > 1_000_000)
      context.addIssue({
        code: "custom",
        message: "History repair declarations exceed their budget.",
      })
  })

export function nodeKey(node: { kind: "sketch" | "feature"; id: string }) {
  return `${node.kind}:${node.id}`
}
export function isMissingInputFeature(feature: Pick<FeatureRecordV1, "type">) {
  return featureTypeKey(feature.type) === featureTypeKey(missingInputFeatureType)
}

/** Authored records are editor input; their disconnected links never become evaluation authority. */
export function authoredHistoryFeature(
  snapshot: {
    repairIntents?: readonly HistoryRepairIntent[]
    features: readonly FeatureRecordV1[]
  },
  id: string,
) {
  const intent = snapshot.repairIntents?.find(
    (item) => item.kind === "feature" && item.authored.id === id,
  )
  return intent?.kind === "feature"
    ? intent.authored
    : snapshot.features.find((item) => item.id === id)
}
export function authoredHistorySketch(
  snapshot: { repairIntents?: readonly HistoryRepairIntent[]; sketches: readonly SketchRecord[] },
  id: string,
) {
  const intent = snapshot.repairIntents?.find(
    (item) => item.kind === "sketch" && item.authored.id === id,
  )
  return intent?.kind === "sketch"
    ? intent.authored
    : snapshot.sketches.find((item) => item.id === id)
}

export function detachedHistoryFeature(
  intent: Extract<HistoryRepairIntent, { kind: "feature" }>,
  featureIds: ReadonlySet<string>,
): FeatureRecordV1 {
  return featureRecordV1Schema.parse({
    ...intent.authored,
    type: missingInputFeatureType,
    parameters: { missingInputs: intent.missingInputs },
    dependencies: intent.authored.dependencies.filter((id) => featureIds.has(id)),
    references: [],
    semanticInputs: [],
  })
}
export function detachedHistorySketch(
  intent: Extract<HistoryRepairIntent, { kind: "sketch" }>,
): SketchRecord {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: intent.authored.id,
    label: intent.authored.label,
    plane: intent.authored.plane,
    entities: [],
    constraints: [],
  })
}

export function validateHistoryRepairIntents(snapshot: {
  repairIntents: readonly HistoryRepairIntent[]
  features: readonly FeatureRecordV1[]
  sketches: readonly SketchRecord[]
}) {
  const featureIds = new Set(snapshot.features.map((feature) => feature.id))
  const intentIds = new Set(
    snapshot.repairIntents
      .filter((intent) => intent.kind === "feature")
      .map((intent) => intent.authored.id),
  )
  for (const intent of snapshot.repairIntents) {
    const current =
      intent.kind === "feature"
        ? snapshot.features.find((feature) => feature.id === intent.authored.id)
        : snapshot.sketches.find((sketch) => sketch.id === intent.authored.id)
    const detached =
      intent.kind === "feature"
        ? detachedHistoryFeature(intent, featureIds)
        : detachedHistorySketch(intent)
    if (!current || canonicalJson(current) !== canonicalJson(detached))
      return "Repair intent must match its disconnected active History item."
  }
  if (
    snapshot.features.some(
      (feature) => isMissingInputFeature(feature) && !intentIds.has(feature.id),
    )
  )
    return "A missing-input feature requires typed authored repair intent."
  return null
}
