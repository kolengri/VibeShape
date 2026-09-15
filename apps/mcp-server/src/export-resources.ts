import { localExportSchema } from "@vibeshape/automation-api/local-tools"
import { z } from "zod"

export const exportResourceViewSchema = localExportSchema.omit({ base64: true }).extend({
  uri: z.string().regex(/^vibeshape:\/\/exports\/[0-9a-f-]{36}$/),
  expiresAt: z.number().int().positive(),
})

type ExportFile = z.infer<typeof localExportSchema>

export function createExportResources(now = Date.now) {
  const files = new Map<string, { file: ExportFile; expiresAt: number }>()
  function purge() {
    for (const [uri, entry] of files) if (entry.expiresAt <= now()) files.delete(uri)
  }
  return {
    add(input: unknown) {
      purge()
      // At most four 6 MiB files, with no ambient filesystem access.
      if (files.size >= 4) files.delete(files.keys().next().value ?? "")
      const file = localExportSchema.parse(input)
      const uri = `vibeshape://exports/${crypto.randomUUID()}`
      const expiresAt = now() + 5 * 60_000
      files.set(uri, { file, expiresAt })
      const { base64: _base64, ...metadata } = file
      return exportResourceViewSchema.parse({ ...metadata, uri, expiresAt })
    },
    read(uri: string) {
      purge()
      const file = files.get(uri)?.file
      return file ? { uri, mimeType: file.mimeType, blob: file.base64 } : null
    },
    clear() {
      files.clear()
    },
  }
}
