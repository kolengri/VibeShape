import { z } from "zod"
import { documentNodeRefSchema } from "./document-node"
import {
  documentV4CommandEnvelopeSchema,
  documentV4EventEnvelopeSchema,
  documentV4EventSchema,
} from "./document-v4-command-schemas"
import { featureRecordSchema } from "./feature-graph"
import { partAllocationsSchema } from "./parts"
import { sketchRecordSchema } from "./sketch"

export const documentV5CommandEnvelopeSchema = documentV4CommandEnvelopeSchema.extend({
  schemaVersion: z.literal(5),
})
export const documentV5EventEnvelopeSchema = documentV4EventEnvelopeSchema.extend({
  schemaVersion: z.literal(5),
})
export const historyRemoveRetainingDependentsCommandSchema = documentV5CommandEnvelopeSchema.extend(
  {
    kind: z.literal("org.vibeshape.history.remove-retaining-dependents"),
    payload: z.object({ target: documentNodeRefSchema }).strict(),
  },
)
export const historyRemovedRetainingDependentsEventSchema = documentV5EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.history.removed-retaining-dependents"),
  target: documentNodeRefSchema,
})
export const historyRepairItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("feature"), feature: featureRecordSchema }).strict(),
  z.object({ kind: z.literal("sketch"), sketch: sketchRecordSchema }).strict(),
])
export type HistoryRepairItem = z.infer<typeof historyRepairItemSchema>
export const historyRepairCommandSchema = documentV5CommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.history.repair"),
  payload: z.object({ item: historyRepairItemSchema }).strict(),
})
export const historyRepairedEventSchema = documentV5EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.history.repaired"),
  item: historyRepairItemSchema,
  partAllocations: partAllocationsSchema,
})
export const documentV5AuthoredEventSchema = documentV5EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.authored-changed"),
  authoredEvent: documentV4EventSchema,
})
export const documentRestoredV5EventSchema = documentV5EventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.restored"),
  direction: z.enum(["undo", "redo"]),
  targetRevision: documentV5EventEnvelopeSchema.shape.revision,
})
export const documentV5EventSchema = z.union([
  historyRemovedRetainingDependentsEventSchema,
  historyRepairedEventSchema,
  documentV5AuthoredEventSchema,
  documentRestoredV5EventSchema,
])
export type DocumentV5Event = z.infer<typeof documentV5EventSchema>
