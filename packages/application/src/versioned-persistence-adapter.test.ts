import {
  applyVersionedDocumentCommand,
  boxFeatureType,
  createEmptySketch,
  createLengthQuantity,
  type DocumentEvent,
  draftIdSchema,
  featureRecordSchema,
  projectDocumentSnapshotV1ToV0,
  type VersionedDocumentEvent,
} from "@vibeshape/domain"
import { expect, it } from "vitest"
import {
  createVersionedPersistenceAdapter,
  type VersionedDocumentRepositoryPort,
} from "./versioned-persistence-adapter"

const id = "0195b5ac-b250-7a2c-8c33-000000000001"
const actor = { type: "user", userId: "org.vibeshape.adapter-test" } as const
const currentMigration = {
  migrationProvenance: "current",
  migrationDiagnostic: null,
  unavailableRecords: [],
} as const
const createEvent = {
  schemaVersion: 1,
  kind: "org.vibeshape.document.create",
  commandId: "0195b5ac-b250-7a2c-8c33-000000000002",
  documentId: id,
  baseRevision: 0,
  issuedAt: "2026-09-01T08:00:00.000Z",
  actor,
  payload: { name: "Adapter test" },
}

function createSnapshot() {
  const result = applyVersionedDocumentCommand(null, createEvent)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

function insertedSnapshot() {
  const created = createSnapshot()
  const sketch = createEmptySketch({
    id: "0195b5ac-b250-7a2c-8c33-000000000010" as never,
    label: "Sketch",
    plane: "xy",
  })
  const inserted = applyVersionedDocumentCommand(created.snapshot, {
    ...createEvent,
    kind: "org.vibeshape.history.insert-sketch",
    commandId: "0195b5ac-b250-7a2c-8c33-000000000011",
    baseRevision: 1,
    payload: { sketch, historyAfter: null },
  })
  if (!inserted.ok) throw new Error(inserted.diagnostic.message)
  return { created, inserted }
}

function legacySketchEvent(event: DocumentEvent) {
  const { historyAfter: _historyAfter, ...legacy } = event as typeof event & {
    historyAfter?: unknown
  }
  return { ...legacy, type: "org.vibeshape.sketch.added" } as DocumentEvent
}

function boxFeature() {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b250-7a2c-8c33-000000000020",
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(15),
      height: createLengthQuantity(10),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
    label: "Box",
  })
}

function legacyFeatureEvent(event: VersionedDocumentEvent) {
  if (event.type !== "org.vibeshape.history.feature-inserted")
    throw new Error("Expected a History feature insertion event.")
  const { historyAfter: _historyAfter, feature, ...envelope } = event
  const { semanticInputs: _semanticInputs, ...legacyFeature } = feature
  return {
    ...envelope,
    type: "org.vibeshape.feature.added" as const,
    feature: { ...legacyFeature, schemaVersion: 0 as const },
  } as DocumentEvent
}

it("projects commit inputs and does not advance authority when v1 persistence fails", async () => {
  const created = createSnapshot()
  const projected = projectDocumentSnapshotV1ToV0(created.snapshot)
  if (!projected.ok) throw new Error(projected.diagnostic.message)
  let calls = 0
  const repository: VersionedDocumentRepositoryPort = {
    async commit() {
      calls += 1
      return { ok: false, diagnostic: { code: "quota", message: "full", retryable: true } }
    },
    async commitDraft() {
      return { ok: true, value: undefined }
    },
    async recover() {
      return {
        ok: true,
        value: {
          status: "clean",
          snapshot: created.snapshot,
          headRevision: 1,
          recoveredRevision: 1,
          lostRevisionCount: 0,
          corruptRecords: [],
          migration: currentMigration,
        },
      }
    },
    async closeCleanly() {
      return { ok: true, value: undefined }
    },
  }
  const adapter = createVersionedPersistenceAdapter(repository)
  const result = await adapter.commit({
    sessionId: "0195b5ac-b250-7a2c-8c33-000000000003" as never,
    lease: { epoch: 1, nowMs: 1 },
    storedAt: createEvent.issuedAt,
    baseSnapshot: null,
    event: created.event as DocumentEvent,
    snapshot: projected.snapshot,
  })
  expect(result).toMatchObject({ ok: false, diagnostic: { code: "quota" } })
  expect(calls).toBe(1)
  expect(adapter.currentV1Snapshot).toBeNull()
})

it("projects recovery without hiding snapshot-derived migration evidence", async () => {
  const created = createSnapshot()
  const repository: VersionedDocumentRepositoryPort = {
    async commit() {
      return { ok: true, value: undefined }
    },
    async commitDraft() {
      return { ok: true, value: undefined }
    },
    async recover() {
      return {
        ok: true,
        value: {
          status: "clean",
          snapshot: created.snapshot,
          headRevision: 1,
          recoveredRevision: 1,
          lostRevisionCount: 0,
          corruptRecords: [],
          migration: {
            migrationProvenance: "snapshot-derived",
            migrationDiagnostic: {
              code: "legacy-journal-unavailable",
              message: "The legacy journal prefix is unavailable.",
            },
            unavailableRecords: ["event:1"],
          },
        },
      }
    },
    async closeCleanly() {
      return { ok: true, value: undefined }
    },
  }
  const adapter = createVersionedPersistenceAdapter(repository)
  const recovered = await adapter.recover(id as never)
  expect(recovered).toMatchObject({
    ok: true,
    value: {
      snapshot: { schemaVersion: 0 },
      migration: {
        provenance: "snapshot-derived",
        diagnostic: { code: "legacy-journal-unavailable" },
        unavailableRecords: ["event:1"],
      },
    },
  })
  expect(adapter.currentV1Snapshot).toEqual(created.snapshot)
})

it("translates a legacy sketch add at the final History anchor", async () => {
  const { inserted } = insertedSnapshot()
  const sketch = createEmptySketch({
    id: "0195b5ac-b250-7a2c-8c33-000000000012" as never,
    label: "Second",
    plane: "xy",
  })
  const next = applyVersionedDocumentCommand(inserted.snapshot, {
    ...createEvent,
    kind: "org.vibeshape.history.insert-sketch",
    commandId: "0195b5ac-b250-7a2c-8c33-000000000013",
    baseRevision: 2,
    payload: { sketch, historyAfter: inserted.snapshot.history[0] },
  })
  if (!next.ok) throw new Error(next.diagnostic.message)
  const base = projectDocumentSnapshotV1ToV0(inserted.snapshot)
  const result = projectDocumentSnapshotV1ToV0(next.snapshot)
  if (!base.ok || !result.ok) throw new Error("Projection failed")
  let received: { event: DocumentEvent } | undefined
  const repository = {
    async commit(input: { event: DocumentEvent }) {
      received = input
      return { ok: true, value: undefined }
    },
    async commitDraft() {
      return { ok: true, value: undefined }
    },
    async recover() {
      return {
        ok: true,
        value: {
          status: "clean",
          snapshot: inserted.snapshot,
          headRevision: 2,
          recoveredRevision: 2,
          lostRevisionCount: 0,
          corruptRecords: [],
          migration: currentMigration,
        },
      }
    },
    async closeCleanly() {
      return { ok: true, value: undefined }
    },
  } as VersionedDocumentRepositoryPort
  const adapter = createVersionedPersistenceAdapter(repository, inserted.snapshot)
  await adapter.commit({
    sessionId: "s" as never,
    lease: null,
    storedAt: next.event.issuedAt,
    baseSnapshot: base.snapshot,
    event: legacySketchEvent(next.event as DocumentEvent),
    snapshot: result.snapshot,
  })
  expect(received?.event.type).toBe("org.vibeshape.history.sketch-inserted")
  expect(received).toMatchObject({
    event: {
      type: "org.vibeshape.history.sketch-inserted",
      historyAfter: inserted.snapshot.history[0],
    },
  })
})

it("translates a legacy feature add and derives its semantic inputs", async () => {
  const created = createSnapshot()
  const inserted = applyVersionedDocumentCommand(created.snapshot, {
    ...createEvent,
    kind: "org.vibeshape.history.insert-feature",
    commandId: "0195b5ac-b250-7a2c-8c33-000000000021",
    baseRevision: 1,
    payload: { feature: boxFeature(), historyAfter: null },
  })
  if (!inserted.ok) throw new Error(inserted.diagnostic.message)
  const base = projectDocumentSnapshotV1ToV0(created.snapshot)
  const result = projectDocumentSnapshotV1ToV0(inserted.snapshot)
  if (!base.ok || !result.ok) throw new Error("Projection failed")
  let received: VersionedDocumentEvent | undefined
  const repository = {
    async commit(input: { event: VersionedDocumentEvent }) {
      received = input.event
      return { ok: true, value: undefined }
    },
    async commitDraft() {
      return { ok: true, value: undefined }
    },
    async recover() {
      throw new Error("Not used")
    },
    async closeCleanly() {
      return { ok: true, value: undefined }
    },
  } as VersionedDocumentRepositoryPort
  const adapter = createVersionedPersistenceAdapter(repository, created.snapshot)
  const committed = await adapter.commit({
    sessionId: "s" as never,
    lease: null,
    storedAt: inserted.event.issuedAt,
    baseSnapshot: base.snapshot,
    event: legacyFeatureEvent(inserted.event),
    snapshot: result.snapshot,
  })
  expect(committed.ok).toBe(true)
  expect(received).toMatchObject({
    type: "org.vibeshape.history.feature-inserted",
    historyAfter: null,
    feature: { semanticInputs: [] },
  })
})

it("preserves one transaction identity across translated draft insertions", async () => {
  const { inserted } = insertedSnapshot()
  const transactionId = draftIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000030")
  const secondSketch = createEmptySketch({
    id: "0195b5ac-b250-7a2c-8c33-000000000031" as never,
    label: "Second",
    plane: "xy",
  })
  const second = applyVersionedDocumentCommand(
    inserted.snapshot,
    {
      ...createEvent,
      kind: "org.vibeshape.history.insert-sketch",
      commandId: "0195b5ac-b250-7a2c-8c33-000000000032",
      baseRevision: 2,
      payload: { sketch: secondSketch, historyAfter: inserted.snapshot.history.at(-1) ?? null },
    },
    { transactionId },
  )
  if (!second.ok) throw new Error(second.diagnostic.message)
  const thirdSketch = createEmptySketch({
    id: "0195b5ac-b250-7a2c-8c33-000000000033" as never,
    label: "Third",
    plane: "xy",
  })
  const third = applyVersionedDocumentCommand(
    second.snapshot,
    {
      ...createEvent,
      kind: "org.vibeshape.history.insert-sketch",
      commandId: "0195b5ac-b250-7a2c-8c33-000000000034",
      baseRevision: 3,
      payload: { sketch: thirdSketch, historyAfter: second.snapshot.history.at(-1) ?? null },
    },
    { transactionId },
  )
  if (!third.ok) throw new Error(third.diagnostic.message)
  const base = projectDocumentSnapshotV1ToV0(inserted.snapshot)
  const result = projectDocumentSnapshotV1ToV0(third.snapshot)
  if (!base.ok || !result.ok) throw new Error("Projection failed")
  let received: readonly VersionedDocumentEvent[] = []
  const repository = {
    async commit() {
      return { ok: true, value: undefined }
    },
    async commitDraft(input: { events: readonly VersionedDocumentEvent[] }) {
      received = input.events
      return { ok: true, value: undefined }
    },
    async recover() {
      throw new Error("Not used")
    },
    async closeCleanly() {
      return { ok: true, value: undefined }
    },
  } as VersionedDocumentRepositoryPort
  const adapter = createVersionedPersistenceAdapter(repository, inserted.snapshot)
  const committed = await adapter.commitDraft({
    sessionId: "s" as never,
    lease: { epoch: 1, nowMs: 1 },
    storedAt: third.event.issuedAt,
    transactionId: transactionId as never,
    baseSnapshot: base.snapshot,
    events: [
      legacySketchEvent(second.event as DocumentEvent),
      legacySketchEvent(third.event as DocumentEvent),
    ],
    snapshot: result.snapshot,
  })
  expect(committed.ok).toBe(true)
  expect(received).toHaveLength(2)
  expect(received.every((event) => event.transactionId === transactionId)).toBe(true)
  expect(received.map((event) => event.type)).toEqual([
    "org.vibeshape.history.sketch-inserted",
    "org.vibeshape.history.sketch-inserted",
  ])
  expect(adapter.currentV1Snapshot).toEqual(third.snapshot)
})

it("rejects canonical base mismatches before repository access", async () => {
  const created = createSnapshot()
  const projected = projectDocumentSnapshotV1ToV0(created.snapshot)
  if (!projected.ok) throw new Error("Projection failed")
  let called = false
  const repository = {
    async commit() {
      called = true
      return { ok: true, value: undefined }
    },
    async commitDraft() {
      return { ok: true, value: undefined }
    },
    async recover() {
      return {
        ok: true,
        value: {
          status: "clean",
          snapshot: created.snapshot,
          headRevision: 1,
          recoveredRevision: 1,
          lostRevisionCount: 0,
          corruptRecords: [],
          migration: currentMigration,
        },
      }
    },
    async closeCleanly() {
      return { ok: true, value: undefined }
    },
  } as VersionedDocumentRepositoryPort
  const adapter = createVersionedPersistenceAdapter(repository, created.snapshot)
  const result = await adapter.commit({
    sessionId: "s" as never,
    lease: null,
    storedAt: createEvent.issuedAt,
    baseSnapshot: { ...projected.snapshot, name: "wrong" },
    event: created.event as DocumentEvent,
    snapshot: projected.snapshot,
  })
  expect(result.ok).toBe(false)
  expect(called).toBe(false)
})
