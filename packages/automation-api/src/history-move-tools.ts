import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { historyItemRefSchema } from "@vibeshape/domain/document-node"
import { commandIdSchema, documentIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { serializedQueryBytes } from "./query-byte-budget"

export const historyMoveArgumentsSchema = z
  .object({
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    commandId: commandIdSchema,
    item: historyItemRefSchema,
    historyAfter: historyItemRefSchema.nullable(),
  })
  .strict()
export const historyMoveToolInputs = { move_history_item: historyMoveArgumentsSchema } as const
export const historyMoveOperationSchema = z
  .object({ tool: z.literal("move_history_item"), arguments: historyMoveArgumentsSchema })
  .strict()
export const historyMoveCommitViewSchema = historyMoveArgumentsSchema
  .extend({ revision: revisionSchema })
  .refine(
    (value) => value.revision === value.baseRevision + 1,
    "A history move advances one revision.",
  )
export type HistoryMoveOperation = z.infer<typeof historyMoveOperationSchema>
export type HistoryMoveCommitView = z.infer<typeof historyMoveCommitViewSchema>

export function historyMoveResultContextMatches(
  input: unknown,
  result: { ok: boolean; value?: unknown },
  documentId?: string,
): boolean | null {
  const operation = historyMoveOperationSchema.safeParse(input)
  if (!operation.success) return null
  if (serializedQueryBytes(result) > 128 * 1024) return false
  if (!result.ok) return true
  const value = historyMoveCommitViewSchema.safeParse(result.value)
  if (!value.success) return false
  const { revision: _revision, ...intent } = value.data
  return (
    (documentId === undefined || value.data.documentId === documentId) &&
    canonicalJson(intent) === canonicalJson(operation.data.arguments)
  )
}
