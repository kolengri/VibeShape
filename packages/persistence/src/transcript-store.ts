import { documentIdSchema } from "@vibeshape/domain/identifiers"
import Dexie, { type Table } from "dexie"
import { z } from "zod"
import { persistenceInvariantError } from "./diagnostics"

type JsonValue = z.infer<ReturnType<typeof z.json>>
const headSchema = z.strictObject({
  version: z.literal(1),
  projectId: documentIdSchema,
  revision: z.number().int().nonnegative(),
  session: z.json().optional(),
})
const entrySchema = z.strictObject({
  version: z.literal(1),
  projectId: documentIdSchema,
  id: z.uuid(),
  position: z.number().int().nonnegative(),
  value: z.json(),
})
type Head = z.infer<typeof headSchema>
type Entry = z.infer<typeof entrySchema>
export type TranscriptSnapshot = {
  revision: number
  entries: readonly { id: string; position: number; value: JsonValue }[]
  session?: JsonValue | undefined
}
export type TranscriptPatch = {
  projectId: string
  expectedRevision: number
  upserts: readonly { id: string; position: number; value: JsonValue }[]
  deletedIds: readonly string[]
  session?: JsonValue | undefined
}
export interface TranscriptStore {
  load(projectId: string): Promise<TranscriptSnapshot | null>
  commit(patch: TranscriptPatch): Promise<number>
  reset(projectId: string, expectedRevision: number, assertCurrent?: () => void): Promise<number>
}

/** Separate from CAD authority: display transcripts have their own migration and reset lifecycle. */
export class TranscriptDatabase extends Dexie {
  heads!: Table<Head, string>
  entries!: Table<Entry, [string, string]>
  constructor(name = "vibeshape-assistant-transcripts") {
    super(name)
    this.version(1).stores({
      heads: "projectId",
      entries: "[projectId+id], [projectId+position], projectId",
    })
  }
}

export class IndexedDbTranscriptStore implements TranscriptStore {
  constructor(private readonly database = new TranscriptDatabase()) {}

  async load(projectId: string): Promise<TranscriptSnapshot | null> {
    documentIdSchema.parse(projectId)
    return this.database.transaction("r", this.database.heads, this.database.entries, async () => {
      const raw = await this.database.heads.get(projectId)
      if (!raw) return null
      const head = headSchema.parse(raw)
      const entries: Entry[] = []
      let after = -1
      // Bound individual IndexedDB reads without imposing a transcript retention ceiling.
      while (true) {
        const page = await this.database.entries
          .where("[projectId+position]")
          .between([projectId, after], [projectId, Infinity], false, true)
          .limit(64)
          .toArray()
        if (!page.length) break
        for (const value of page) {
          const entry = entrySchema.parse(value)
          if (entry.projectId !== projectId || entry.position <= after)
            throw persistenceInvariantError("corrupt-history", "The transcript order is invalid.")
          entries.push(entry)
          after = entry.position
        }
      }
      if (
        entries.length !==
        (await this.database.entries.where("projectId").equals(projectId).count())
      )
        throw persistenceInvariantError(
          "corrupt-history",
          "The transcript contains unreadable positions.",
        )
      return { revision: head.revision, session: head.session, entries }
    })
  }

  private async nextHead(projectId: string, expectedRevision: number, session?: JsonValue) {
    const previous = await this.database.heads.get(projectId)
    const revision = previous ? headSchema.parse(previous).revision : 0
    if (revision !== expectedRevision)
      throw persistenceInvariantError("stale-revision", "The transcript changed in another writer.")
    return headSchema.parse({ version: 1, projectId, revision: revision + 1, session })
  }

  async commit(patch: TranscriptPatch) {
    const headInput = headSchema.parse({
      version: 1,
      projectId: patch.projectId,
      revision: patch.expectedRevision,
      session: patch.session,
    })
    const upserts = patch.upserts.map((entry) =>
      entrySchema.parse({ ...entry, version: 1, projectId: headInput.projectId }),
    )
    const deletes = patch.deletedIds.map((id) => z.uuid().parse(id))
    return this.database.transaction("rw", this.database.heads, this.database.entries, async () => {
      const head = await this.nextHead(headInput.projectId, headInput.revision, headInput.session)
      await this.database.entries.bulkDelete(deletes.map((id) => [head.projectId, id]))
      await this.database.entries.bulkPut(upserts)
      await this.database.heads.put(head)
      return head.revision
    })
  }

  async reset(projectId: string, expectedRevision: number, assertCurrent: () => void = () => {}) {
    documentIdSchema.parse(projectId)
    return this.database.transaction("rw", this.database.heads, this.database.entries, async () => {
      const head = await this.nextHead(projectId, expectedRevision)
      assertCurrent()
      await this.database.entries.where("projectId").equals(projectId).delete()
      assertCurrent()
      // Keep a tombstone so a failed legacy-key cleanup cannot resurrect a reset conversation.
      await this.database.heads.put(head)
      assertCurrent()
      return head.revision
    })
  }
}
