import { z } from "zod"
import { type HistoryItemRef, historyItemRefSchema } from "./document-node"
import { historyFolderIdSchema } from "./identifiers"
import { authoredItemNameSchema } from "./parts"

export const historyFolderSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: historyFolderIdSchema,
    name: authoredItemNameSchema,
    items: z.array(historyItemRefSchema).min(1).max(100_256),
  })
  .strict()
export type HistoryFolder = Readonly<
  Omit<z.infer<typeof historyFolderSchema>, "items"> & {
    items: readonly HistoryItemRef[]
  }
>
export const historyFoldersSchema = z
  .array(historyFolderSchema)
  .max(1_024)
  .superRefine((folders, context) => {
    if (new Set(folders.map((folder) => folder.id)).size !== folders.length)
      context.addIssue({ code: "custom", message: "History folder IDs must be unique." })
    if (folders.reduce((count, folder) => count + folder.items.length, 0) > 100_256)
      context.addIssue({ code: "custom", message: "Folder membership exceeds the history budget." })
  })

export function historyItemKey(item: HistoryItemRef): string {
  return `${item.kind}:${item.id}`
}

/** Folders organize a contiguous slice; they neither reorder nor add dependency graph nodes. */
export function validateHistoryFolders(
  folders: readonly HistoryFolder[],
  history: readonly HistoryItemRef[],
): string | null {
  const positions = new Map(history.map((item, index) => [historyItemKey(item), index]))
  const assigned = new Set<string>()
  for (const folder of folders) {
    let previous: number | undefined
    for (const item of folder.items) {
      const key = historyItemKey(item)
      const position = positions.get(key)
      if (position === undefined) return "A folder member must exist in History."
      if (assigned.has(key)) return "History folders cannot overlap or repeat a member."
      if (previous !== undefined && position !== previous + 1)
        return "Folder members must be contiguous and follow History order."
      assigned.add(key)
      previous = position
    }
  }
  return null
}
