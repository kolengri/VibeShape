import { expect, it } from "bun:test"
import { createHash } from "node:crypto"
import {
  applyVersionedDocumentCommand,
  canonicalJson,
  commandIdSchema,
  type DocumentAuthorityEvent,
} from "@vibeshape/domain"
import { storeAuthoritySnapshot } from "./authority-records"
import { loadAuthorityRestoreTarget, recoverDocumentAuthority } from "./authority-recovery"
import type { EventAuthorityRecord } from "./authority-schemas"
import type { VibeShapeDatabase } from "./database"
import { classifyPersistenceError } from "./diagnostics"
import { projectRecordV1Schema } from "./schemas"

const at = "2026-10-21T00:00:00Z"
const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const nameAt = (revision: number) => `Revision ${revision}`
const created = applyVersionedDocumentCommand(null, {
  schemaVersion: 1,
  kind: "org.vibeshape.document.create",
  documentId: id(1),
  commandId: id(2),
  baseRevision: 0,
  issuedAt: at,
  actor: { type: "user", userId: null },
  payload: { name: nameAt(1) },
})
if (!created.ok) throw new Error(created.diagnostic.message)
const first = created.snapshot
const creation = created.event

function envelope(revision: number) {
  return {
    schemaVersion: 1 as const,
    documentId: first.id,
    commandId: commandIdSchema.parse(id(1000 + revision)),
    transactionId: null,
    baseRevision: revision - 1,
    revision,
    issuedAt: at,
    actor: { type: "user", userId: null } as const,
  }
}

function renameAt(revision: number, previousRevision = revision - 1): DocumentAuthorityEvent {
  if (revision === 1) return creation
  return {
    ...envelope(revision),
    type: "org.vibeshape.document.renamed",
    previousName: nameAt(previousRevision),
    name: nameAt(revision),
  }
}

function restoreAt(revision: number, targetRevision: number): DocumentAuthorityEvent {
  return {
    ...envelope(revision),
    type: "org.vibeshape.document.restored",
    direction: "undo",
    targetRevision,
  }
}

function snapshotAt(revision: number) {
  return { ...first, revision, name: nameAt(revision) }
}

function storedEvent(event: DocumentAuthorityEvent): EventAuthorityRecord {
  const payload = canonicalJson(event)
  return {
    schemaVersion: event.schemaVersion,
    documentId: event.documentId,
    revision: event.revision,
    commandId: event.commandId,
    storedAt: at,
    payload,
    // Fixture construction is synchronous; the production reader independently verifies SHA-256.
    checksum: createHash("sha256").update(payload).digest("hex"),
  }
}

async function databaseFixture(
  headRevision: number,
  seedRevision = 0,
  eventAt: (revision: number) => DocumentAuthorityEvent | undefined = renameAt,
) {
  const seed = seedRevision ? await storeAuthoritySnapshot(snapshotAt(seedRevision), at) : null
  const project = projectRecordV1Schema.parse({
    schemaVersion: 1,
    documentId: first.id,
    name: nameAt(headRevision),
    headRevision,
    latestSnapshotRevision: seedRevision,
    cleanCloseRevision: null,
    createdAt: at,
    updatedAt: at,
    lastExternalBackupAt: null,
    migrationProvenance: "current",
    migrationDiagnostic: null,
    unavailableRecords: [],
  })
  const reads = { events: 0, creation: 0, second: 0, target: 0, lastRevision: 0 }
  // Generate only the requested event. Neither the shim nor production replay retains
  // a fixture-sized array of events or full snapshots.
  const database = {
    projectsV1: {
      async get() {
        return project
      },
    },
    recoveryV1: { async get() {} },
    eventsV1: {
      async get(key: [string, number]) {
        const revision = key[1]
        reads.events++
        reads.creation += Number(revision === 1)
        reads.second += Number(revision === 2)
        reads.target += Number(revision === 51)
        reads.lastRevision = revision
        const event = revision <= headRevision ? eventAt(revision) : undefined
        return event ? storedEvent(event) : undefined
      },
    },
    snapshotsV1: {
      async get(key: [string, number]) {
        return seed?.revision === key[1] ? seed : undefined
      },
      where() {
        return {
          between(start: [string, number], end: [string, number]) {
            const collection = {
              reverse() {
                return collection
              },
              async first() {
                return seed && seed.revision >= start[1] && seed.revision <= end[1]
                  ? seed
                  : undefined
              },
            }
            return collection
          },
        }
      },
    },
  } as unknown as VibeShapeDatabase
  return {
    historical: () => loadAuthorityRestoreTarget(database, first.id, headRevision),
    recover: () => recoverDocumentAuthority(database, first.id),
    reads,
  }
}

it("loads exactly 100,000 events without charging the creation peek twice", async () => {
  const fixture = await databaseFixture(100_000)
  expect(await fixture.historical()).toEqual(snapshotAt(100_000))
  expect(fixture.reads.events).toBe(100_000)
  expect(fixture.reads.creation).toBe(1)
  console.info(JSON.stringify({ case: "exact historical boundary", ...fixture.reads }))
}, 90000)

it("rejects overflowing recovery before querying a 100,001st event", async () => {
  const fixture = await databaseFixture(100_001)
  expect(await fixture.recover()).toMatchObject({
    ok: false,
    diagnostic: { code: "corrupt-history" },
  })
  expect(fixture.reads.events).toBe(100_000)
  expect(fixture.reads.lastRevision).toBe(100_000)
  console.info(JSON.stringify({ case: "contiguous recovery overflow", ...fixture.reads }))
}, 90000)

it("shares the read budget between a recovery suffix and nested historical loading", async () => {
  const fixture = await databaseFixture(100_002, 60_000, (revision) => {
    if (revision === 60_001) return restoreAt(revision, 59_999)
    return renameAt(revision, revision === 60_002 ? 59_999 : revision - 1)
  })
  expect(await fixture.recover()).toMatchObject({
    ok: false,
    diagnostic: { code: "corrupt-history" },
  })
  expect(fixture.reads.events).toBe(100_000)
  expect(fixture.reads.creation).toBe(1)
  expect(fixture.reads.second).toBe(1)
  expect(fixture.reads.lastRevision).toBe(100_001)
  console.info(JSON.stringify({ case: "nested prefix and suffix overflow", ...fixture.reads }))
}, 90000)

it("charges reconstruction rereads to the original historical request after cache eviction", async () => {
  const fixture = await databaseFixture(99_951, 0, (revision) =>
    revision === 99_951 ? restoreAt(revision, 51) : renameAt(revision),
  )
  const diagnostic = await fixture.historical().then(() => null, classifyPersistenceError)
  expect(diagnostic).toMatchObject({ code: "corrupt-history" })
  expect(fixture.reads.events).toBe(100_000)
  expect(fixture.reads.creation).toBe(1)
  expect(fixture.reads.second).toBe(2)
  expect(fixture.reads.target).toBe(1)
  expect(fixture.reads.lastRevision).toBe(50)
  console.info(JSON.stringify({ case: "evicted target reconstruction overflow", ...fixture.reads }))
}, 90000)

it("allows sparse verified seeds beyond the event budget's revision distance", async () => {
  const fixture = await databaseFixture(500_001, 500_000, (revision) =>
    revision === 1 ? undefined : renameAt(revision),
  )
  expect(await fixture.historical()).toEqual(snapshotAt(500_001))
  expect(fixture.reads.events).toBe(2)
  console.info(JSON.stringify({ case: "sparse historical seed", ...fixture.reads }))
})

it("preserves recovery with loss after a sparse verified seed", async () => {
  const fixture = await databaseFixture(500_003, 500_000, (revision) =>
    revision === 500_002 ? undefined : renameAt(revision),
  )
  expect(await fixture.recover()).toMatchObject({
    ok: true,
    value: {
      status: "recovered-with-loss",
      snapshot: snapshotAt(500_001),
      headRevision: 500_003,
      recoveredRevision: 500_001,
      lostRevisionCount: 2,
      corruptRecords: ["event-authority:500002"],
    },
  })
  expect(fixture.reads.events).toBe(2)
  console.info(JSON.stringify({ case: "sparse seed recovery with loss", ...fixture.reads }))
})
