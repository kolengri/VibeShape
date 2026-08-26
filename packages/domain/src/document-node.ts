import { z } from "zod"
import { featureIdSchema, sketchIdSchema } from "./identifiers"

export const documentNodeRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sketch"), id: sketchIdSchema }).strict(),
  z.object({ kind: z.literal("feature"), id: featureIdSchema }).strict(),
])

export type DocumentNodeRef = Readonly<z.infer<typeof documentNodeRefSchema>>
export type HistoryItemRef = DocumentNodeRef
export const historyItemRefSchema = documentNodeRefSchema
export const historyItemsSchema = z.array(historyItemRefSchema).max(100_256)
