import {
  applyDocumentCommand,
  canonicalJson,
  type DocumentSnapshotV1,
  projectDocumentSnapshotV1ToV0,
  replayVersionedDocumentEvents,
  sessionIdSchema,
  type VersionedDocumentEvent,
} from "@vibeshape/domain"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import {
  createPersistentDocumentSession,
  type DocumentRebuildPort,
  openPersistentDocumentSession,
  type PersistentDocumentSessionDependencies,
} from "./persistent-document-session"
import {
  createVersionedPersistenceAdapter,
  type VersionedDocumentRepositoryPort,
} from "./versioned-persistence-adapter"

const id = (value: number) => `0195b5ac-b250-7a2c-8c33-${String(value).padStart(12, "0")}`
const documentId = id(1)
const timestamp = "2026-09-04T12:00:00Z"
const mesh = { chordTolerance: 0.05, angularTolerance: 0.1 }
const fail = (code: string) => ({
  ok: false as const,
  diagnostic: { code, message: code, retryable: true },
})

async function harness() {
  let saved: DocumentSnapshotV1 | null = null
  const journal: VersionedDocumentEvent[] = []
  const control = { failSave: false, throwSave: false, failRebuild: false, leaseLost: false }
  let sequence = 10
  const repository: VersionedDocumentRepositoryPort = {
    async commit(input) {
      if (control.throwSave) throw new Error("Synthetic persistence exception")
      if (control.failSave) return fail("quota")
      expect(canonicalJson(saved)).toBe(canonicalJson(input.baseSnapshot))
      const replayed = replayVersionedDocumentEvents([...journal, input.event])
      if (!replayed.ok) throw new Error(replayed.diagnostic.message)
      expect(replayed.snapshot).toEqual(input.snapshot)
      saved = replayed.snapshot
      journal.push(input.event)
      return { ok: true, value: undefined }
    },
    async commitDraft(input) {
      if (control.failSave) return fail("quota")
      const replayed = replayVersionedDocumentEvents(saved, input.events)
      if (!replayed.ok) throw new Error(replayed.diagnostic.message)
      expect(replayed.snapshot).toEqual(input.snapshot)
      saved = replayed.snapshot
      journal.push(...input.events)
      return { ok: true, value: undefined }
    },
    async recover() {
      if (!saved) return fail("document-not-found")
      return {
        ok: true,
        value: {
          status: "clean",
          snapshot: saved,
          headRevision: saved.revision,
          recoveredRevision: saved.revision,
          lostRevisionCount: 0,
          corruptRecords: [],
          migration: {
            migrationProvenance: "current",
            migrationDiagnostic: null,
            unavailableRecords: [],
          },
        },
      }
    },
    async closeCleanly() {
      return { ok: true, value: undefined }
    },
  }
  const rebuilds: number[] = []
  const worker: DocumentRebuildPort = {
    async rebuild({ document }) {
      rebuilds.push(document.revision)
      if (control.failRebuild) throw new Error("Synthetic worker failure")
      return {
        protocolVersion: DOCUMENT_PROTOCOL_VERSION,
        requestId: id(2),
        documentId: document.id,
        revision: document.revision,
        generation: 1,
        type: "documentRebuilt",
        evaluation: {
          records: [],
          dirtyFeatureIds: [],
          evaluatedFeatureIds: [],
          reusedFeatureIds: [],
        },
        geometry: [],
        sketches: [],
        modelReferenceEvidence: [],
      }
    },
    async solveSketch(): Promise<never> {
      throw new Error("Not used")
    },
    async exportDocument(): Promise<never> {
      throw new Error("Not used")
    },
    async dispose() {},
    terminate() {},
  }
  const dependencies: PersistentDocumentSessionDependencies = {
    repository: createVersionedPersistenceAdapter(repository),
    commandDispatcher: { dispatch: applyDocumentCommand },
    createRebuildPort: () => worker,
    now: () => 1000,
    leases: {
      async acquire() {
        return control.leaseLost
          ? fail("lease-lost")
          : { ok: true, value: { lease: { epoch: 1, expiresAt: 31000 } } }
      },
      async release() {
        return { ok: true, value: undefined }
      },
    },
  }
  function command(kind: string, baseRevision: number, payload: unknown) {
    return {
      kind,
      schemaVersion: 1,
      commandId: id(sequence++),
      documentId,
      baseRevision,
      issuedAt: timestamp,
      actor: { type: "user", userId: null },
      payload,
    }
  }
  const opened = await createPersistentDocumentSession(dependencies, {
    sessionId: sessionIdSchema.parse(id(3)),
    mesh,
    command: command("org.vibeshape.document.create", 0, { name: "Original" }),
  })
  if (!opened.ok) throw new Error(opened.diagnostic.message)
  const session = opened.session
  const navigate = (direction: "undo" | "redo", baseRevision = session.snapshot.revision) =>
    session.navigateHistory({
      direction,
      commandId: id(sequence++),
      documentId,
      baseRevision,
      issuedAt: timestamp,
      actor: { type: "user", userId: null },
    })
  const rename = (name: string) =>
    session.commit(command("org.vibeshape.document.rename", session.snapshot.revision, { name }))
  return {
    session,
    control,
    journal,
    rebuilds,
    command,
    navigate,
    rename,
    async reopen() {
      await session.close()
      return openPersistentDocumentSession(
        { ...dependencies, repository: createVersionedPersistenceAdapter(repository) },
        {
          documentId: session.snapshot.id,
          sessionId: sessionIdSchema.parse(id(3)),
          mesh,
        },
      )
    },
  }
}

describe("committed document undo", () => {
  it("does not add an unusable undo step for a transaction with no net semantic change", async () => {
    const h = await harness()
    await h.rename("Saved")
    const result = await h.session.commitDraft({
      draftId: id(100),
      commands: [
        h.command("org.vibeshape.document.rename", 2, { name: "Temporary" }),
        h.command("org.vibeshape.document.rename", 3, { name: "Saved" }),
      ],
    })
    expect(result.ok).toBe(true)
    expect((await h.navigate("undo")).ok).toBe(true)
    expect(h.session.snapshot.name).toBe("Original")
    expect(h.session.history.canUndo).toBe(false)
    const revision = h.session.snapshot.revision
    expect(
      (
        await h.session.commitDraft({
          draftId: id(102),
          commands: [
            h.command("org.vibeshape.document.rename", revision, { name: "Temporary" }),
            h.command("org.vibeshape.document.rename", revision + 1, { name: "Original" }),
          ],
        })
      ).ok,
    ).toBe(true)
    expect(h.session.history.canRedo).toBe(true)
    expect((await h.navigate("redo")).ok).toBe(true)
    expect(h.session.snapshot.name).toBe("Saved")
  })
  it("persists undo and redo at increasing revisions and resets navigation on reopen", async () => {
    const h = await harness()
    expect(h.session.history).toEqual({ canUndo: false, canRedo: false })
    expect((await h.rename("Changed")).ok).toBe(true)
    expect((await h.navigate("undo")).ok).toBe(true)
    expect(h.session.snapshot).toMatchObject({ name: "Original", revision: 3 })
    expect(h.session.history).toEqual({ canUndo: false, canRedo: true })
    expect((await h.navigate("redo")).ok).toBe(true)
    expect(h.session.snapshot).toMatchObject({ name: "Changed", revision: 4 })
    expect((await h.navigate("undo")).ok).toBe(true)
    const replayed = replayVersionedDocumentEvents(h.journal)
    if (!replayed.ok) throw new Error(replayed.diagnostic.message)
    expect(projectDocumentSnapshotV1ToV0(replayed.snapshot)).toEqual({
      ok: true,
      snapshot: h.session.snapshot,
    })
    const reopened = await h.reopen()
    expect(reopened).toMatchObject({
      ok: true,
      report: { snapshot: { name: "Original", revision: 5 } },
    })
    if (reopened.ok) expect(reopened.session.history).toEqual({ canUndo: false, canRedo: false })
  })

  it("groups multi-command transactions and truncates redo only after a successful edit", async () => {
    const h = await harness()
    const result = await h.session.commitDraft({
      draftId: id(100),
      commands: [
        h.command("org.vibeshape.document.rename", 1, { name: "Draft name" }),
        h.command("org.vibeshape.variable.add", 2, {
          variable: { schemaVersion: 0, id: id(101), name: "width", expression: "20 mm" },
        }),
      ],
    })
    expect(result.ok).toBe(true)
    expect((await h.navigate("undo")).ok).toBe(true)
    expect(h.session.snapshot).toMatchObject({ name: "Original", variables: [] })
    expect(h.session.history).toEqual({ canUndo: false, canRedo: true })
    h.control.failSave = true
    expect((await h.rename("Failed edit")).ok).toBe(false)
    expect(h.session.history.canRedo).toBe(true)
    h.control.failSave = false
    expect((await h.navigate("redo")).ok).toBe(true)
    expect(h.session.snapshot.variables).toHaveLength(1)
    await h.navigate("undo")
    await h.rename("New branch")
    expect(h.session.history.canRedo).toBe(false)
    expect((await h.navigate("redo")).ok).toBe(false)
    expect(h.session.snapshot.name).toBe("New branch")
  })

  it.each(["failSave", "throwSave", "leaseLost"] as const)(
    "preserves state and retries after %s during undo",
    async (failure) => {
      const h = await harness()
      await h.rename("Changed")
      const before = h.session.snapshot
      h.control[failure] = true
      expect((await h.navigate("undo")).ok).toBe(false)
      expect(h.session.snapshot).toEqual(before)
      expect(h.journal).toHaveLength(2)
      h.control[failure] = false
      expect((await h.navigate("undo")).ok).toBe(true)
      expect(h.session.snapshot.name).toBe("Original")
    },
  )

  it("serializes competing requests and rejects stale revisions without moving history", async () => {
    const h = await harness()
    await h.rename("First")
    await h.rename("Second")
    const results = await Promise.all([h.navigate("undo", 3), h.navigate("undo", 3)])
    expect(results.map(({ ok }) => ok)).toEqual([true, false])
    expect(h.session.snapshot).toMatchObject({ name: "First", revision: 4 })
    expect(h.session.history).toEqual({ canUndo: true, canRedo: true })
  })

  it("keeps a persisted undo authoritative when rebuilding fails", async () => {
    const h = await harness()
    await h.rename("Changed")
    h.control.failRebuild = true
    expect(await h.navigate("undo")).toMatchObject({ ok: true, rebuild: { ok: false } })
    expect(h.session.snapshot.name).toBe("Original")
    expect(h.session.history.canRedo).toBe(true)
    h.control.failRebuild = false
    expect((await h.session.retryRebuild()).ok).toBe(true)
    expect((await h.navigate("redo")).ok).toBe(true)
  })

  it("bounds retained checkpoints while keeping all durable events replayable", async () => {
    const h = await harness()
    for (let i = 0; i < 102; i++) await h.rename(`Name ${i}`)
    for (let i = 0; i < 100; i++) expect((await h.navigate("undo")).ok).toBe(true)
    expect(h.session.history.canUndo).toBe(false)
    expect(h.session.snapshot.name).toBe("Name 1")
    const replayed = replayVersionedDocumentEvents(h.journal)
    if (!replayed.ok) throw new Error(replayed.diagnostic.message)
    expect(projectDocumentSnapshotV1ToV0(replayed.snapshot)).toEqual({
      ok: true,
      snapshot: h.session.snapshot,
    })
  })
})
