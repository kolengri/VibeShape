import { z } from "zod"
import { commandActorSchema } from "./commands"
import { historyItemRefSchema } from "./document-node"
import { historyFolderSchema } from "./history-folders"
import {
  commandIdSchema,
  documentIdSchema,
  draftIdSchema,
  featureIdSchema,
  historyFolderIdSchema,
  partIdSchema,
  revisionSchema,
  timestampSchema,
} from "./identifiers"
import { authoredItemNameSchema, partAllocationsSchema, partEffectsSchema } from "./parts"
import { surfaceTextureLayersSchema } from "./surface-textures"
import {
  versionedDocumentCommandSchema,
  versionedDocumentEventSchema,
} from "./versioned-document-commands"

export const documentV2CommandEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
    commandId: commandIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()
export const documentV2EventEnvelopeSchema = documentV2CommandEnvelopeSchema.extend({
  transactionId: draftIdSchema.nullable(),
  revision: revisionSchema,
})

export const documentV2MetadataChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("part.rename"), partId: partIdSchema, name: authoredItemNameSchema })
    .strict(),
  z
    .object({ kind: z.literal("part.set-visibility"), partId: partIdSchema, visible: z.boolean() })
    .strict(),
  z.object({ kind: z.literal("folder.create"), folder: historyFolderSchema }).strict(),
  z
    .object({
      kind: z.literal("folder.rename"),
      folderId: historyFolderIdSchema,
      name: authoredItemNameSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("folder.set-items"),
      folderId: historyFolderIdSchema,
      items: z.array(historyItemRefSchema).min(1).max(100_256),
    })
    .strict(),
  z.object({ kind: z.literal("folder.remove"), folderId: historyFolderIdSchema }).strict(),
])
export type DocumentV2MetadataChange = Readonly<z.infer<typeof documentV2MetadataChangeSchema>>

export const documentV2ModelCommandSchema = documentV2CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.model-command"),
  payload: z
    .object({ command: versionedDocumentCommandSchema, partAllocations: partAllocationsSchema })
    .strict(),
})
export const documentV2MetadataCommandSchema = documentV2CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.metadata-command"),
  payload: documentV2MetadataChangeSchema,
})
export const documentUpgradeV2CommandSchema = documentV2CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.upgrade-v2"),
  payload: z.object({ partAllocations: partAllocationsSchema }).strict(),
})
export const documentV2CommandSchema = z.union([
  documentV2ModelCommandSchema,
  documentV2MetadataCommandSchema,
  documentUpgradeV2CommandSchema,
])
export type DocumentV2Command = Readonly<z.infer<typeof documentV2CommandSchema>>

export const documentV2ModelEventSchema = documentV2EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.model-changed"),
  modelEvent: versionedDocumentEventSchema,
  partEffects: partEffectsSchema,
})
export const documentV2MetadataEventSchema = documentV2EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.metadata-changed"),
  change: documentV2MetadataChangeSchema,
})
export const documentUpgradedV2EventSchema = documentV2EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.upgraded-v2"),
  partEffects: partEffectsSchema,
})
export const documentRestoredV2EventSchema = documentV2EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.restored"),
  direction: z.enum(["undo", "redo"]),
  targetRevision: revisionSchema,
})
export const documentV2EventSchema = z.union([
  documentV2ModelEventSchema,
  documentV2MetadataEventSchema,
  documentUpgradedV2EventSchema,
  documentRestoredV2EventSchema,
])
export type DocumentV2Event = Readonly<z.infer<typeof documentV2EventSchema>>

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

/** Mixed journals keep their original V1 prefix bytes and append explicitly versioned V2 events. */
export const documentAuthorityV2EventSchema = z.union([
  versionedDocumentEventSchema,
  documentV2EventSchema,
])
export type DocumentAuthorityV2Event = Readonly<z.infer<typeof documentAuthorityV2EventSchema>>
export const documentAuthorityEventSchema = z.union([
  documentAuthorityV2EventSchema,
  documentV3EventSchema,
])
export type DocumentAuthorityEvent = Readonly<z.infer<typeof documentAuthorityEventSchema>>
