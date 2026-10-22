import { z } from "zod"
import {
  documentV5CommandEnvelopeSchema,
  documentV5EventEnvelopeSchema,
  documentV5EventSchema,
} from "./document-v5-command-schemas"
import { setPartAppearanceChangeSchema } from "./part-appearance"

export const documentV6CommandEnvelopeSchema = documentV5CommandEnvelopeSchema.extend({
  schemaVersion: z.literal(6),
})
export const documentV6EventEnvelopeSchema = documentV5EventEnvelopeSchema.extend({
  schemaVersion: z.literal(6),
})
export const documentV6MetadataCommandSchema = documentV6CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.metadata-command"),
  payload: setPartAppearanceChangeSchema,
})
export const documentV6MetadataEventSchema = documentV6EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.metadata-changed"),
  change: setPartAppearanceChangeSchema,
})
export const documentV6AuthoredEventSchema = documentV6EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.authored-changed"),
  authoredEvent: documentV5EventSchema,
})
export const documentRestoredV6EventSchema = documentV6EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.restored"),
  direction: z.enum(["undo", "redo"]),
  targetRevision: documentV6EventEnvelopeSchema.shape.revision,
})
export const documentV6EventSchema = z.union([
  documentV6MetadataEventSchema,
  documentV6AuthoredEventSchema,
  documentRestoredV6EventSchema,
])
export type DocumentV6Event = Readonly<z.infer<typeof documentV6EventSchema>>
