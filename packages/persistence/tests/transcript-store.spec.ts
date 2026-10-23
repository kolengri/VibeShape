import { expect, test } from "@playwright/test"
import type { AgentChatSession, ChatMessage } from "../../../apps/web/src/assistant/chat-history"
import type * as CoordinatorModule from "../../../apps/web/src/assistant/chat-history-coordinator"
import type * as TranscriptModule from "../src/transcript-store"

const modulePath = `/@fs${new URL("../src/transcript-store.ts", import.meta.url).pathname}`
const coordinatorPath = `/@fs${new URL("../../../apps/web/src/assistant/chat-history-coordinator.ts", import.meta.url).pathname}`
const projectId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ac"
const otherProjectId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ad"

test.beforeEach(async ({ page }) => {
  await page.route("**/transcript-evidence.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Transcript persistence evidence</title>",
    }),
  )
  await page.goto("/transcript-evidence.html")
})

test("migrates v1 transcripts without loss and preserves archives across reopen", async ({
  page,
}) => {
  const report = await page.evaluate(
    async ({ path, projectId }) => {
      const { TranscriptDatabase, IndexedDbTranscriptStore }: typeof TranscriptModule =
        await import(path)
      const name = `transcript-v1-${crypto.randomUUID()}`
      const entries = Array.from({ length: 137 }, (_, position) => ({
        version: 1 as const,
        projectId,
        id: crypto.randomUUID(),
        position: position * 2,
        value: { role: position % 2 ? "assistant" : "user", text: `Message ${position}` },
      }))
      const session = {
        provider: "native",
        sessionId: "retained-session",
        context: [1, true, null],
      }
      await new Promise<void>((resolve, reject) => {
        // Dexie schema v1 uses native IndexedDB version 10.
        const request = indexedDB.open(name, 10)
        request.onupgradeneeded = () => {
          request.result.createObjectStore("heads", { keyPath: "projectId" })
          const store = request.result.createObjectStore("entries", {
            keyPath: ["projectId", "id"],
          })
          store.createIndex("[projectId+position]", ["projectId", "position"])
          store.createIndex("projectId", "projectId")
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const old = request.result
          const transaction = old.transaction(["heads", "entries"], "readwrite")
          transaction.objectStore("heads").put({ version: 1, projectId, revision: 9, session })
          for (const entry of entries) transaction.objectStore("entries").put(entry)
          transaction.onabort = () => reject(transaction.error)
          transaction.oncomplete = () => {
            old.close()
            resolve()
          }
        }
      })
      let database = new TranscriptDatabase(name)
      let store = new IndexedDbTranscriptStore(database)
      try {
        const migrated = await store.load(projectId)
        const migrationPreserved =
          JSON.stringify(migrated) ===
          JSON.stringify({ revision: 9, conversationId: projectId, session, entries })
        const secondDatabase = new TranscriptDatabase(name)
        const secondIdentity = (await new IndexedDbTranscriptStore(secondDatabase).load(projectId))
          ?.conversationId
        secondDatabase.close()
        const legacyHeadUnchanged =
          JSON.stringify(await database.heads.get(projectId)) ===
          JSON.stringify({ version: 1, projectId, revision: 9, session })
        const initiallyEmpty = await store.listArchives(projectId)
        const blank = await store.switchConversation(projectId, 9, null, "Original prompt")
        const [archive] = await store.listArchives(projectId)
        if (!archive) throw new Error("Expected an inactive transcript")
        database.close()
        database = new TranscriptDatabase(name)
        store = new IndexedDbTranscriptStore(database)
        const reopenedArchives = await store.listArchives(projectId)
        const reopenedBlank = await store.load(projectId)
        const restored = await store.switchConversation(projectId, 10, archive.id, "Unused")
        return {
          migrationPreserved,
          legacyHeadUnchanged,
          clientsAgreeOnLegacyIdentity: secondIdentity === projectId,
          initiallyEmpty,
          schemaVersion: database.verno,
          blankRevision: blank.revision,
          reopenedBlank,
          blankIdentityPreserved:
            blank.conversationId !== projectId &&
            reopenedBlank?.conversationId === blank.conversationId,
          archiveIdentity: archive.id,
          archivePreserved: JSON.stringify(reopenedArchives) === JSON.stringify([archive]),
          restoredEntries: JSON.stringify(restored.entries) === JSON.stringify(entries),
          restoredSession: restored.session,
          restoredRevision: restored.revision,
          restoredIdentity: restored.conversationId,
          remainingArchives: await store.listArchives(projectId),
        }
      } finally {
        await database.delete()
      }
    },
    { path: modulePath, projectId },
  )
  expect(report).toEqual({
    migrationPreserved: true,
    legacyHeadUnchanged: true,
    clientsAgreeOnLegacyIdentity: true,
    initiallyEmpty: [],
    schemaVersion: 2,
    blankRevision: 10,
    reopenedBlank: { revision: 10, conversationId: expect.any(String), entries: [] },
    blankIdentityPreserved: true,
    archiveIdentity: projectId,
    archivePreserved: true,
    restoredEntries: true,
    restoredSession: {
      provider: "native",
      sessionId: "retained-session",
      context: [1, true, null],
    },
    restoredRevision: 11,
    restoredIdentity: projectId,
    remainingArchives: [],
  })
})

test("exchanges inactive snapshots, isolates projects, and retains reset tombstones", async ({
  page,
}) => {
  const report = await page.evaluate(
    async ({ path, projectId, otherProjectId }) => {
      const { TranscriptDatabase, IndexedDbTranscriptStore }: typeof TranscriptModule =
        await import(path)
      const database = new TranscriptDatabase(`transcript-exchange-${crypto.randomUUID()}`)
      const store = new IndexedDbTranscriptStore(database)
      const first = { id: crypto.randomUUID(), position: 0, value: { text: "First prompt" } }
      const second = { id: crypto.randomUUID(), position: 3, value: { text: "Second prompt" } }
      try {
        const missing = await store.load(projectId)
        await store.commit({
          projectId,
          expectedRevision: 0,
          upserts: [first],
          deletedIds: [],
          session: { sessionId: "first" },
        })
        await store.commit({
          projectId: otherProjectId,
          expectedRevision: 0,
          upserts: [first],
          deletedIds: [],
        })
        await store.switchConversation(otherProjectId, 1, null, "Other project")
        const [otherArchive] = await store.listArchives(otherProjectId)
        if (!otherArchive) throw new Error("Expected the other project's archive")
        const otherBefore = await store.load(otherProjectId)
        const secondBlank = await store.switchConversation(projectId, 1, null, "First prompt")
        // Pre-identity archives already have unique IDs and need no record rewrite on load.
        const [legacyArchive] = await database.archives.toArray()
        if (!legacyArchive) throw new Error("Expected a legacy archive fixture")
        const legacyId = crypto.randomUUID()
        await database.archives.delete([projectId, legacyArchive.id])
        await database.archives.add({ ...legacyArchive, id: legacyId })
        const legacyBefore = JSON.stringify(await database.archives.toArray())
        const [firstArchive] = await store.listArchives(projectId)
        if (!firstArchive) throw new Error("Expected the first archive")
        const legacyArchiveUnchanged =
          JSON.stringify(await database.archives.toArray()) === legacyBefore
        await store.commit({
          projectId,
          expectedRevision: 2,
          upserts: [second],
          deletedIds: [],
          session: { sessionId: "second" },
        })
        const secondActive = await store.load(projectId)
        const crossProjectRejected = await store
          .switchConversation(projectId, 3, otherArchive.id, "Second prompt")
          .then(
            () => false,
            () => true,
          )
        const selected = await store.switchConversation(
          projectId,
          3,
          firstArchive.id,
          "Second prompt",
        )
        const [secondArchive] = await store.listArchives(projectId)
        if (!secondArchive) throw new Error("Expected the outgoing second transcript")
        const firstRemoved = !(await database.archives.get([projectId, firstArchive.id]))
        const selectedSecond = await store.switchConversation(
          projectId,
          4,
          secondArchive.id,
          "First again",
        )
        const [firstAgain] = await store.listArchives(projectId)
        const reset = await store.reset(projectId, 5)
        const tombstone = await store.load(projectId)
        const archivesAfterReset = await store.listArchives(projectId)
        const empty = await store.switchConversation(projectId, 6, null, "Empty")
        return {
          missing,
          legacyArchiveUnchanged,
          legacyIdentityAdopted: selected.conversationId === legacyId,
          normalCommitPreservedIdentity:
            secondActive?.conversationId === secondBlank.conversationId,
          crossProjectRejected,
          selected: {
            revision: selected.revision,
            values: selected.entries.map((e) => e.value),
            session: selected.session,
          },
          outgoingTitle: secondArchive.title,
          firstRemoved,
          selectedSecond: {
            revision: selectedSecond.revision,
            values: selectedSecond.entries.map((e) => e.value),
            session: selectedSecond.session,
          },
          stableArchiveId: firstAgain?.id === firstArchive.id,
          firstAgainTitle: firstAgain?.title,
          resetRevision: reset.revision,
          tombstone,
          resetChangedIdentity: reset.conversationId !== selectedSecond.conversationId,
          resetResultMatchesHead: JSON.stringify(reset) === JSON.stringify(tombstone),
          emptyChatChangedIdentity: empty.conversationId !== tombstone?.conversationId,
          resetPreservedArchive:
            JSON.stringify(archivesAfterReset) === JSON.stringify([firstAgain]),
          blankDidNotArchive:
            JSON.stringify(await store.listArchives(projectId)) ===
            JSON.stringify(archivesAfterReset),
          otherUnchanged:
            JSON.stringify(await store.load(otherProjectId)) === JSON.stringify(otherBefore),
          otherArchivesUnchanged:
            JSON.stringify(await store.listArchives(otherProjectId)) ===
            JSON.stringify([otherArchive]),
        }
      } finally {
        await database.delete()
      }
    },
    { path: modulePath, projectId, otherProjectId },
  )
  expect(report).toEqual({
    missing: null,
    legacyArchiveUnchanged: true,
    legacyIdentityAdopted: true,
    normalCommitPreservedIdentity: true,
    crossProjectRejected: true,
    selected: { revision: 4, values: [{ text: "First prompt" }], session: { sessionId: "first" } },
    outgoingTitle: "Second prompt",
    firstRemoved: true,
    selectedSecond: {
      revision: 5,
      values: [{ text: "Second prompt" }],
      session: { sessionId: "second" },
    },
    stableArchiveId: true,
    firstAgainTitle: "First again",
    resetRevision: 6,
    tombstone: { revision: 6, conversationId: expect.any(String), entries: [] },
    resetChangedIdentity: true,
    resetResultMatchesHead: true,
    emptyChatChangedIdentity: true,
    resetPreservedArchive: true,
    blankDidNotArchive: true,
    otherUnchanged: true,
    otherArchivesUnchanged: true,
  })
})

test("rolls back late write failures and cancellation and rejects stale switches and commits", async ({
  page,
}) => {
  const report = await page.evaluate(
    async ({ path, projectId }) => {
      const { TranscriptDatabase, IndexedDbTranscriptStore }: typeof TranscriptModule =
        await import(path)
      const database = new TranscriptDatabase(`transcript-rollback-${crypto.randomUUID()}`)
      const store = new IndexedDbTranscriptStore(database)
      try {
        const entry = { id: crypto.randomUUID(), position: 0, value: "archived" }
        await store.commit({ projectId, expectedRevision: 0, upserts: [entry], deletedIds: [] })
        await store.switchConversation(projectId, 1, null, "Archived")
        await store.commit({
          projectId,
          expectedRevision: 2,
          upserts: [{ ...entry, value: "active" }],
          deletedIds: [],
          session: { id: "active-session" },
        })
        const [target] = await store.listArchives(projectId)
        if (!target) throw new Error("Expected a switch target")
        const before = JSON.stringify({
          active: await store.load(projectId),
          archives: await database.archives.toArray(),
        })
        const outcomes: { rejected: boolean; unchanged: boolean }[] = []
        const attempt = async (operation: () => Promise<unknown>) => {
          const rejected = await operation().then(
            () => false,
            () => true,
          )
          const after = JSON.stringify({
            active: await store.load(projectId),
            archives: await database.archives.toArray(),
          })
          outcomes.push({ rejected, unchanged: before === after })
        }
        await attempt(() => store.switchConversation(projectId, 2, target.id, "Active"))
        await attempt(() =>
          store.commit({ projectId, expectedRevision: 2, upserts: [], deletedIds: [entry.id] }),
        )
        await attempt(() => store.switchConversation(projectId, 3, crypto.randomUUID(), "Active"))
        await attempt(() =>
          store.switchConversation(projectId, 3, target.id, "Active", () => {
            throw new Error("Cancelled before writing")
          }),
        )
        const quotaFailure = () => {
          throw new DOMException("Injected quota failure", "QuotaExceededError")
        }
        database.heads.hook("updating", quotaFailure)
        await attempt(() => store.switchConversation(projectId, 3, target.id, "Active"))
        await attempt(() => store.switchConversation(projectId, 3, null, "Active"))
        database.heads.hook("updating").unsubscribe(quotaFailure)
        let cancelled = false
        const cancelAfterWrite = () => {
          cancelled = true
        }
        database.heads.hook("updating", cancelAfterWrite)
        await attempt(() =>
          store.switchConversation(projectId, 3, target.id, "Active", () => {
            if (cancelled) throw new Error("Cancelled during replacement")
          }),
        )
        database.heads.hook("updating").unsubscribe(cancelAfterWrite)
        database.close()
        await database.open()
        return {
          outcomes,
          cancellationReachedWrite: cancelled,
          reopenUnchanged:
            before ===
            JSON.stringify({
              active: await store.load(projectId),
              archives: await database.archives.toArray(),
            }),
        }
      } finally {
        await database.delete()
      }
    },
    { path: modulePath, projectId },
  )
  expect(report).toEqual({
    outcomes: Array.from({ length: 7 }, () => ({ rejected: true, unchanged: true })),
    cancellationReachedWrite: true,
    reopenUnchanged: true,
  })
})

test("validates persisted archives and rejects corruption before replacing the active transcript", async ({
  page,
}) => {
  const report = await page.evaluate(
    async ({ path, projectId, otherProjectId }) => {
      const { TranscriptDatabase, IndexedDbTranscriptStore }: typeof TranscriptModule =
        await import(path)
      const database = new TranscriptDatabase(`transcript-corrupt-${crypto.randomUUID()}`)
      const store = new IndexedDbTranscriptStore(database)
      try {
        const entry = { id: crypto.randomUUID(), position: 0, value: { text: "Saved" } }
        await store.commit({ projectId, expectedRevision: 0, upserts: [entry], deletedIds: [] })
        await store.switchConversation(projectId, 1, null, "Saved")
        await store.commit({
          projectId,
          expectedRevision: 2,
          upserts: [{ ...entry, value: { text: "Current" } }],
          deletedIds: [],
        })
        const [archive] = await database.archives.toArray()
        if (!archive) throw new Error("Expected an archive")
        const before = JSON.stringify(await store.load(projectId))
        const corruptions: unknown[] = [
          { ...archive, version: 99 },
          { ...archive, title: 42 },
          { ...archive, updatedAt: Number.NaN },
          { ...archive, session: new Date() },
          { ...archive, entries: [{ ...archive.entries[0], value: new Map() }] },
          { ...archive, entries: [{ ...archive.entries[0], projectId: otherProjectId }] },
          { ...archive, entries: [archive.entries[0], archive.entries[0]] },
          { ...archive, entries: [archive.entries[0], { ...archive.entries[0], position: 1 }] },
          { ...archive, entries: [] },
        ]
        const outcomes = []
        for (const corrupt of corruptions) {
          // Bypass typed writes to reproduce untrusted persisted data.
          await new Promise<void>((resolve, reject) => {
            const transaction = database.backendDB().transaction("archives", "readwrite")
            transaction.objectStore("archives").put(corrupt)
            transaction.oncomplete = () => resolve()
            transaction.onabort = () => reject(transaction.error)
          })
          const corruptBefore = JSON.stringify(await database.archives.toArray())
          const listRejected = await store.listArchives(projectId).then(
            () => false,
            () => true,
          )
          const switchRejected = await store
            .switchConversation(projectId, 3, archive.id, "Current")
            .then(
              () => false,
              () => true,
            )
          outcomes.push({
            listRejected,
            switchRejected,
            activeUnchanged: JSON.stringify(await store.load(projectId)) === before,
            archiveUnchanged: JSON.stringify(await database.archives.toArray()) === corruptBefore,
          })
        }
        const invalidProjectRejected = await store.listArchives("not-a-project").then(
          () => false,
          () => true,
        )
        return { outcomes, invalidProjectRejected }
      } finally {
        await database.delete()
      }
    },
    { path: modulePath, projectId, otherProjectId },
  )
  expect(report).toEqual({
    outcomes: Array.from({ length: 9 }, () => ({
      listRejected: true,
      switchRejected: true,
      activeUnchanged: true,
      archiveUnchanged: true,
    })),
    invalidProjectRejected: true,
  })
})

test("lists every archive newest first with an ascending ID tie breaker", async ({ page }) => {
  const report = await page.evaluate(
    async ({ path, projectId }) => {
      const { TranscriptDatabase, IndexedDbTranscriptStore }: typeof TranscriptModule =
        await import(path)
      const database = new TranscriptDatabase(`transcript-order-${crypto.randomUUID()}`)
      const store = new IndexedDbTranscriptStore(database)
      try {
        await store.commit({
          projectId,
          expectedRevision: 0,
          upserts: [{ id: crypto.randomUUID(), position: 0, value: "Original" }],
          deletedIds: [],
        })
        await store.switchConversation(projectId, 1, null, "Original")
        const [template] = await database.archives.toArray()
        if (!template) throw new Error("Expected an archive")
        await database.archives.clear()
        const archives = Array.from({ length: 137 }, (_, index) => ({
          ...template,
          id: `10000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          title: `Prompt ${index}`,
          updatedAt: index < 2 ? 100 : index,
        }))
        await database.archives.bulkAdd(archives.reverse())
        const summaries = await store.listArchives(projectId)
        return {
          count: summaries.length,
          first: summaries[0],
          tied: summaries
            .filter((summary) => summary.updatedAt === 100)
            .map((summary) => summary.title),
          last: summaries.at(-1),
          onlySummaryFields: summaries.every(
            (summary) => Object.keys(summary).sort().join(",") === "id,title,updatedAt",
          ),
        }
      } finally {
        await database.delete()
      }
    },
    { path: modulePath, projectId },
  )
  expect(report).toEqual({
    count: 137,
    first: { id: "10000000-0000-4000-8000-000000000136", title: "Prompt 136", updatedAt: 136 },
    tied: ["Prompt 0", "Prompt 1", "Prompt 100"],
    last: { id: "10000000-0000-4000-8000-000000000002", title: "Prompt 2", updatedAt: 2 },
    onlySummaryFields: true,
  })
})

test("rolls back consumer validation failures before archiving or replacing either conversation", async ({
  page,
}) => {
  const report = await page.evaluate(
    async ({ path, projectId }) => {
      const { TranscriptDatabase, IndexedDbTranscriptStore }: typeof TranscriptModule =
        await import(path)
      const database = new TranscriptDatabase(
        `transcript-consumer-validation-${crypto.randomUUID()}`,
      )
      const store = new IndexedDbTranscriptStore(database)
      try {
        const invalid = {
          id: crypto.randomUUID(),
          position: 0,
          value: { role: "invalid", text: "Malformed display message" },
        }
        await store.commit({ projectId, expectedRevision: 0, upserts: [invalid], deletedIds: [] })
        await store.switchConversation(projectId, 1, null, "Invalid display")
        const current = {
          id: crypto.randomUUID(),
          position: 0,
          value: { role: "user", text: "Keep current" },
        }
        await store.commit({ projectId, expectedRevision: 2, upserts: [current], deletedIds: [] })
        const [archive] = await store.listArchives(projectId)
        if (!archive) throw new Error("Expected an archived conversation")
        const before = JSON.stringify(await store.load(projectId))
        const archivesBefore = JSON.stringify(await database.archives.toArray())
        let currentValidated = false,
          targetValidated = false
        const rejected = await store
          .switchConversation(projectId, 3, archive.id, "Current", undefined, (snapshot) => {
            if (snapshot.entries.some(({ id }) => id === current.id)) currentValidated = true
            if (snapshot.entries.some(({ id }) => id === invalid.id)) {
              targetValidated = true
              throw new Error("The consumer rejected this display message")
            }
          })
          .then(
            () => false,
            () => true,
          )
        const activeUnchanged = JSON.stringify(await store.load(projectId)) === before
        const archivesUnchanged =
          JSON.stringify(await database.archives.toArray()) === archivesBefore
        const revision = await store.commit({
          projectId,
          expectedRevision: 3,
          upserts: [{ ...current, value: { role: "user", text: "Still writable" } }],
          deletedIds: [],
        })
        return {
          rejected,
          currentValidated,
          targetValidated,
          activeUnchanged,
          archivesUnchanged,
          revision,
        }
      } finally {
        await database.delete()
      }
    },
    { path: modulePath, projectId },
  )
  expect(report).toEqual({
    rejected: true,
    currentValidated: true,
    targetValidated: true,
    activeUnchanged: true,
    archivesUnchanged: true,
    revision: 4,
  })
})

test("serializes a competing commit and conversation switch at the project revision", async ({
  page,
}) => {
  const report = await page.evaluate(
    async ({ path, projectId }) => {
      const { TranscriptDatabase, IndexedDbTranscriptStore }: typeof TranscriptModule =
        await import(path)
      const database = new TranscriptDatabase(`transcript-race-${crypto.randomUUID()}`)
      const secondDatabase = new TranscriptDatabase(database.name)
      const store = new IndexedDbTranscriptStore(database)
      const secondStore = new IndexedDbTranscriptStore(secondDatabase)
      try {
        const entry = { id: crypto.randomUUID(), position: 0, value: "Original" }
        await store.commit({ projectId, expectedRevision: 0, upserts: [entry], deletedIds: [] })
        const results = await Promise.allSettled([
          store.switchConversation(projectId, 1, null, "Original"),
          secondStore.commit({
            projectId,
            expectedRevision: 1,
            upserts: [{ ...entry, value: "Edited" }],
            deletedIds: [],
          }),
        ])
        const active = await store.load(projectId)
        const archives = await database.archives.toArray()
        return {
          outcomes: results.map((result) => result.status),
          revision: active?.revision,
          activeValues: active?.entries.map((entry) => entry.value),
          archivedValues: archives.map((archive) => archive.entries.map((entry) => entry.value)),
        }
      } finally {
        secondDatabase.close()
        await database.delete()
      }
    },
    { path: modulePath, projectId },
  )
  expect([
    {
      outcomes: ["fulfilled", "rejected"],
      revision: 2,
      activeValues: [],
      archivedValues: [["Original"]],
    },
    {
      outcomes: ["rejected", "fulfilled"],
      revision: 2,
      activeValues: ["Edited"],
      archivedValues: [],
    },
  ]).toContainEqual(report)
})

test("fences cross-conversation retries across IndexedDB clients and recovers the original identity", async ({
  page,
}) => {
  const report = await page.evaluate(
    async ({ path, coordinatorPath, projectId }) => {
      const { TranscriptDatabase, IndexedDbTranscriptStore }: typeof TranscriptModule =
        await import(path)
      const { createChatHistoryCoordinator }: typeof CoordinatorModule = await import(
        coordinatorPath
      )
      const database = new TranscriptDatabase(`transcript-identity-${crypto.randomUUID()}`)
      const secondDatabase = new TranscriptDatabase(database.name)
      const firstStore = new IndexedDbTranscriptStore(database)
      const secondStore = new IndexedDbTranscriptStore(secondDatabase)
      function client(store: TranscriptModule.TranscriptStore) {
        const state: {
          messages: readonly ChatMessage[]
          agentSession?: AgentChatSession | undefined
        } = { messages: [] }
        let failed = false
        const history = createChatHistoryCoordinator({
          projectId,
          store,
          storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
          current: () => state,
          restored: (saved) => {
            state.messages = saved.messages
            state.agentSession = saved.agentSession
          },
          failed: (value) => {
            failed = value
          },
        })
        return {
          state,
          history,
          get failed() {
            return failed
          },
        }
      }
      const message = (text: string): ChatMessage => ({
        id: crypto.randomUUID(),
        role: "user",
        text,
      })
      try {
        const first = client(firstStore)
        await first.history.ready
        first.state.messages = [message("Conversation A")]
        first.state.agentSession = {
          agent: { command: "/fixture/acp", args: [] },
          sessionId: "session-a",
        }
        await first.history.save()
        const stale = client(secondStore)
        await stale.history.ready
        if (!(await first.history.switchConversation(null))) throw new Error("Switch failed")
        first.state.messages = [message("Conversation B")]
        first.state.agentSession = {
          agent: { command: "/fixture/acp", args: [] },
          sessionId: "session-b",
        }
        await first.history.save()
        const activeBefore = JSON.stringify(await firstStore.load(projectId))
        const archivesBefore = JSON.stringify(await database.archives.toArray())
        stale.state.messages = [...stale.state.messages, message("Local A continuation")]
        const localBefore = JSON.stringify(stale.state)
        await stale.history.save()
        const staleSaveFailed = stale.failed
        await stale.history.retry()
        await stale.history.flush()
        const rejected = {
          staleSaveFailed,
          retryFailed: stale.failed,
          localUnchanged: JSON.stringify(stale.state) === localBefore,
          activeUnchanged: JSON.stringify(await firstStore.load(projectId)) === activeBefore,
          archivesUnchanged: JSON.stringify(await database.archives.toArray()) === archivesBefore,
        }
        const [archive] = await firstStore.listArchives(projectId)
        if (!archive || !(await first.history.switchConversation(archive.id)))
          throw new Error("Original conversation could not be reactivated")
        await stale.history.retry()
        const recovered = await secondStore.load(projectId)
        return {
          ...rejected,
          recovered: !stale.failed,
          recoveredIdentity: recovered?.conversationId,
          recoveredMessages: stale.state.messages.map(({ text }) => text),
          recoveredSession: stale.state.agentSession?.sessionId,
          savedMatchesLocal:
            JSON.stringify(recovered?.entries.map(({ value }) => value)) ===
            JSON.stringify(stale.state.messages),
        }
      } finally {
        secondDatabase.close()
        await database.delete()
      }
    },
    { path: modulePath, coordinatorPath, projectId },
  )
  expect(report).toEqual({
    staleSaveFailed: true,
    retryFailed: true,
    localUnchanged: true,
    activeUnchanged: true,
    archivesUnchanged: true,
    recovered: true,
    recoveredIdentity: projectId,
    recoveredMessages: ["Conversation A", "Local A continuation"],
    recoveredSession: "session-a",
    savedMatchesLocal: true,
  })
})
