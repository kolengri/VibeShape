import { commandIdSchema, documentIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { serializedQueryBytes } from "./query-byte-budget"

const navigationArguments = z
  .object({
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    commandId: commandIdSchema,
    targetRevision: revisionSchema.optional(),
  })
  .strict()
export const historyToolInputs = {
  model_history_state: z
    .object({ documentId: documentIdSchema, revision: revisionSchema })
    .strict(),
  undo_model: navigationArguments,
  redo_model: navigationArguments,
} as const
export const historyStateViewSchema = z
  .object({
    documentId: documentIdSchema,
    revision: revisionSchema,
    canUndo: z.boolean(),
    canRedo: z.boolean(),
  })
  .strict()
export const historyCommitViewSchema = z
  .object({
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    commandId: commandIdSchema,
    direction: z.enum(["undo", "redo"]),
    targetRevision: revisionSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.revision === value.baseRevision + 1 && value.targetRevision <= value.baseRevision,
    "History publication must advance the base once and restore an existing revision.",
  )
export const historyOperations = [
  z
    .object({
      tool: z.literal("model_history_state"),
      arguments: historyToolInputs.model_history_state,
    })
    .strict(),
  z.object({ tool: z.literal("undo_model"), arguments: historyToolInputs.undo_model }).strict(),
  z.object({ tool: z.literal("redo_model"), arguments: historyToolInputs.redo_model }).strict(),
] as const
export const historyOperationSchema = z.discriminatedUnion("tool", historyOperations)
export type HistoryOperation = z.infer<typeof historyOperationSchema>
export type HistoryCommitView = z.infer<typeof historyCommitViewSchema>

export function historyResultContextMatches(
  input: unknown,
  result: { ok: boolean; value?: unknown },
  documentId?: string,
): boolean | null {
  const operation = historyOperationSchema.safeParse(input)
  if (!operation.success) return null
  if (serializedQueryBytes(result) > 128 * 1024) return false
  if (!result.ok) return true
  if (operation.data.tool === "model_history_state") {
    const value = historyStateViewSchema.safeParse(result.value)
    return (
      value.success &&
      (documentId === undefined || value.data.documentId === documentId) &&
      value.data.documentId === operation.data.arguments.documentId &&
      value.data.revision === operation.data.arguments.revision
    )
  }
  const value = historyCommitViewSchema.safeParse(result.value)
  return (
    value.success &&
    (documentId === undefined || value.data.documentId === documentId) &&
    value.data.documentId === operation.data.arguments.documentId &&
    value.data.baseRevision === operation.data.arguments.baseRevision &&
    value.data.commandId === operation.data.arguments.commandId &&
    value.data.direction === (operation.data.tool === "undo_model" ? "undo" : "redo") &&
    (operation.data.arguments.targetRevision === undefined ||
      value.data.targetRevision === operation.data.arguments.targetRevision)
  )
}
