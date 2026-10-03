import { z } from "zod"
import { assemblyMutationsSchema, capturedAssemblyMutationsSchema } from "./assembly-authority"
import { documentV2CommandEnvelopeSchema, documentV2EventSchema } from "./document-v2-command-core"
import { documentV3EventSchema } from "./document-v3-command-schemas"
import { draftIdSchema, revisionSchema } from "./identifiers"
import { sourceAssetsSchema } from "./source-assets"

export const documentV4CommandEnvelopeSchema = documentV2CommandEnvelopeSchema.extend({
  schemaVersion: z.literal(4),
})
export const documentV4EventEnvelopeSchema = documentV4CommandEnvelopeSchema.extend({
  transactionId: draftIdSchema.nullable(),
  revision: revisionSchema,
})
export const documentUpgradeV4CommandSchema = documentV4CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.upgrade-v4"),
  payload: z.object({}).strict(),
})
export const documentUpgradedV4EventSchema = documentV4EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.upgraded-v4"),
  assets: z.tuple([]),
})
export const documentV4AssetsCommandSchema = documentV4CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.add-source-assets"),
  payload: z.object({ assets: sourceAssetsSchema.refine((assets) => assets.length > 0) }).strict(),
})
export const documentV4AssetsEventSchema = documentV4EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.source-assets-added"),
  assets: sourceAssetsSchema.refine((assets) => assets.length > 0),
})
export const documentV4AuthoredEventSchema = documentV4EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.authored-changed"),
  authoredEvent: z.union([documentV2EventSchema, documentV3EventSchema]),
})
export const documentRestoredV4EventSchema = documentV4EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.restored"),
  direction: z.enum(["undo", "redo"]),
  targetRevision: revisionSchema,
})
export const documentV4AssemblyCommandSchema = documentV4CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.assembly-command"),
  payload: z.object({ changes: assemblyMutationsSchema }).strict(),
})
export const documentV4AssemblyEventSchema = documentV4EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.assembly-changed"),
  changes: capturedAssemblyMutationsSchema,
})
export const documentV4EventSchema = z.union([
  documentUpgradedV4EventSchema,
  documentV4AssetsEventSchema,
  documentV4AuthoredEventSchema,
  documentRestoredV4EventSchema,
  documentV4AssemblyEventSchema,
])
export type DocumentV4Event = Readonly<z.infer<typeof documentV4EventSchema>>
export const documentV4CommandSchema = z.union([
  documentUpgradeV4CommandSchema,
  documentV4AssetsCommandSchema,
  documentV4AssemblyCommandSchema,
])
