import { z } from "zod"
import {
  documentV2CommandEnvelopeSchema,
  documentV2MetadataChangeSchema,
  documentV2ModelCommandSchema,
} from "./document-v2-command-core"
import { draftIdSchema, featureIdSchema, revisionSchema } from "./identifiers"
import { partEffectsSchema } from "./parts"
import { surfaceTextureLayersSchema } from "./surface-textures"
import { versionedDocumentEventSchema } from "./versioned-document-commands"
export const replaceSurfaceTextureLayersSchema = z
  .object({
    kind: z.literal("textures.replace-layers"),
    featureId: featureIdSchema,
    layers: surfaceTextureLayersSchema,
  })
  .strict()
  .refine((change) => change.layers.every((layer) => layer.featureId === change.featureId), {
    path: ["layers"],
    message: "A texture replacement may only contain layers of its target feature.",
  })
export const documentV3MetadataChangeSchema = z.union([
  documentV2MetadataChangeSchema,
  replaceSurfaceTextureLayersSchema,
])
export const documentV3CommandEnvelopeSchema = documentV2CommandEnvelopeSchema.extend({
  schemaVersion: z.literal(3),
})
export const documentV3EventEnvelopeSchema = documentV3CommandEnvelopeSchema.extend({
  transactionId: draftIdSchema.nullable(),
  revision: revisionSchema,
})
export const documentV3ModelCommandSchema = documentV3CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.model-command"),
  payload: documentV2ModelCommandSchema.shape.payload,
})
export const documentV3MetadataCommandSchema = documentV3CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.metadata-command"),
  payload: documentV3MetadataChangeSchema,
})
export const documentUpgradeV3CommandSchema = documentV3CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.upgrade-v3"),
  payload: z.object({ change: replaceSurfaceTextureLayersSchema.nullable() }).strict(),
})
export const documentV3CommandSchema = z.union([
  documentV3ModelCommandSchema,
  documentV3MetadataCommandSchema,
  documentUpgradeV3CommandSchema,
])
export type DocumentV3Command = Readonly<z.infer<typeof documentV3CommandSchema>>
export const documentV3ModelEventSchema = documentV3EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.model-changed"),
  modelEvent: versionedDocumentEventSchema,
  partEffects: partEffectsSchema,
})
export const documentV3MetadataEventSchema = documentV3EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.metadata-changed"),
  change: documentV3MetadataChangeSchema,
})
export const documentUpgradedV3EventSchema = documentV3EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.upgraded-v3"),
  change: replaceSurfaceTextureLayersSchema.nullable(),
})
export const documentRestoredV3EventSchema = documentV3EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.restored"),
  direction: z.enum(["undo", "redo"]),
  targetRevision: revisionSchema,
})
export const documentV3EventSchema = z.union([
  documentV3ModelEventSchema,
  documentV3MetadataEventSchema,
  documentUpgradedV3EventSchema,
  documentRestoredV3EventSchema,
])
export type DocumentV3Event = Readonly<z.infer<typeof documentV3EventSchema>>
