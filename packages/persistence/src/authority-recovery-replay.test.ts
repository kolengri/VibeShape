import { expect, it } from "bun:test"
import {
  canonicalJson,
  type DocumentAuthorityEvent,
  type DocumentAuthoritySnapshot,
  documentAuthorityEventSchema,
  documentIdSchema,
  documentSnapshotV3Schema,
  featureIdSchema,
  reduceDocumentAuthorityEvent,
  surfaceTextureLayerIdSchema,
} from "@vibeshape/domain"
import { sourceAssetsFixture } from "../../../scripts/source-assets-fixture"
import { surfaceTextureProjectFixture } from "../../../tests/fixtures/surface-texture-project"
import { storeAuthorityEvent, storeAuthoritySnapshot } from "./authority-records"
import { loadAuthorityRestoreTarget, recoverAuthoritySnapshot } from "./authority-recovery"
import {
  type EventAuthorityRecord,
  projectAuthorityRecordSchema,
  type SnapshotAuthorityRecord,
} from "./authority-schemas"
import type { VibeShapeDatabase } from "./database"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const timestamp = "2026-10-21T00:00:00Z"
const actor = { type: "user", userId: null } as const
const documentId = documentIdSchema.parse(id(1))

function envelope(snapshot: DocumentAuthoritySnapshot | null) {
  const baseRevision = snapshot?.revision ?? 0
  return {
    documentId: snapshot?.id ?? documentId,
    commandId: id(1000 + baseRevision),
    transactionId: null,
    baseRevision,
    revision: baseRevision + 1,
    issuedAt: new Date(Date.parse(timestamp) + baseRevision * 1000).toISOString(),
    actor,
  }
}
function reduced(
  before: DocumentAuthoritySnapshot | null,
  input: unknown,
  target?: DocumentAuthoritySnapshot,
) {
  const event = documentAuthorityEventSchema.parse(input)
  const result = reduceDocumentAuthorityEvent(before, event, target)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return { snapshot: result.snapshot, event }
}
function rename(before: DocumentAuthoritySnapshot, name: string) {
  const modelEvent = {
    ...envelope(before),
    schemaVersion: 1,
    type: "org.vibeshape.document.renamed",
    previousName: before.name,
    name,
  }
  if (before.schemaVersion === 1) return reduced(before, modelEvent)
  const authoredEvent = {
    ...envelope(before),
    schemaVersion: Math.min(before.schemaVersion, 3),
    type: "org.vibeshape.document.model-changed",
    modelEvent,
    partEffects: [],
  }
  return reduced(
    before,
    before.schemaVersion <= 3
      ? authoredEvent
      : {
          ...envelope(before),
          schemaVersion: before.schemaVersion,
          type: "org.vibeshape.document.authored-changed",
          authoredEvent,
        },
  )
}
function journalRoot(mixed: boolean, seed?: DocumentAuthoritySnapshot) {
  const events: DocumentAuthorityEvent[] = []
  let current: DocumentAuthoritySnapshot
  if (seed) current = seed
  else {
    const created = reduced(null, {
      ...envelope(null),
      schemaVersion: 1,
      type: "org.vibeshape.document.created",
      name: "Baseline",
    })
    events.push(created.event)
    current = created.snapshot
  }
  if (mixed) {
    for (const upgrade of [
      { schemaVersion: 2, type: "org.vibeshape.document.upgraded-v2", partEffects: [] },
      { schemaVersion: 3, type: "org.vibeshape.document.upgraded-v3", change: null },
      { schemaVersion: 4, type: "org.vibeshape.document.upgraded-v4", assets: [] },
    ]) {
      const next = reduced(current, { ...envelope(current), ...upgrade })
      events.push(next.event)
      current = next.snapshot
    }
  }
  return { events, current }
}

function nestedJournal(
  mixed: boolean,
  cycles: number,
  seed?: DocumentAuthoritySnapshot,
  precedingEdits = 0,
) {
  const root = journalRoot(mixed, seed)
  const events = root.events
  let current = root.current
  const baseline = current
  let recoverySeed = seed ?? null
  for (let index = 0; index < precedingEdits; index++) {
    const next = rename(current, `Prior ${index}`)
    events.push(next.event)
    current = next.snapshot
  }
  for (let index = 0; index < cycles; index++) {
    // Each cycle targets the preceding restored revision, rather than a fixed early revision.
    const target = index === 0 ? baseline : current
    const next = rename(current, `Edit ${index}`)
    events.push(next.event)
    current = next.snapshot
    if (index === 0 && !seed && !precedingEdits) recoverySeed = current
    const restored = reduced(
      current,
      {
        ...envelope(current),
        schemaVersion: current.schemaVersion,
        type: "org.vibeshape.document.restored",
        direction: "undo",
        targetRevision: target.revision,
      },
      target,
    )
    events.push(restored.event)
    current = restored.snapshot
  }
  return { events, head: current, seed: seed ?? null, recoverySeed }
}

async function databaseFixture(journal: ReturnType<typeof nestedJournal>, withSeed = false) {
  const events = new Map<number, EventAuthorityRecord>()
  for (const event of journal.events)
    events.set(event.revision, await storeAuthorityEvent(event, timestamp))
  const snapshots = new Map<number, SnapshotAuthorityRecord>()
  const seed = withSeed ? journal.recoverySeed : journal.seed
  if (seed) snapshots.set(seed.revision, await storeAuthoritySnapshot(seed, timestamp))
  const reads = { events: 0, snapshots: 0 }
  const blobs = new Map<string, { digest: string; bytes: Uint8Array }>()
  const database = {
    eventsV1: {
      async get(key: [string, number]) {
        reads.events++
        return events.get(key[1])
      },
    },
    snapshotsV1: {
      async get(key: [string, number]) {
        reads.snapshots++
        return snapshots.get(key[1])
      },
      where() {
        return {
          between(start: [string, number], end: [string, number]) {
            let reverse = false
            const collection = {
              reverse() {
                reverse = true
                return collection
              },
              async first() {
                reads.snapshots++
                const rows = [...snapshots.values()]
                  .filter((record) => record.revision >= start[1] && record.revision <= end[1])
                  .sort((left, right) => left.revision - right.revision)
                return reverse ? rows.at(-1) : rows[0]
              },
            }
            return collection
          },
        }
      },
    },
    assetBlobs: {
      async get(digest: string) {
        return blobs.get(digest)
      },
    },
  } as unknown as VibeShapeDatabase
  const project = projectAuthorityRecordSchema.parse({
    schemaVersion: journal.head.schemaVersion,
    documentId: journal.head.id,
    name: journal.head.name,
    headRevision: journal.head.revision,
    latestSnapshotRevision: journal.head.revision,
    cleanCloseRevision: null,
    createdAt: journal.head.createdAt,
    updatedAt: timestamp,
    lastExternalBackupAt: null,
    migrationProvenance: "current",
    migrationDiagnostic: null,
    unavailableRecords: [],
    ...(journal.head.schemaVersion >= 2 ? { upgradeRevision: 2 } : {}),
    ...(journal.head.schemaVersion >= 3 ? { textureUpgradeRevision: 3 } : {}),
    ...(journal.head.schemaVersion >= 4 ? { sourceUpgradeRevision: 4 } : {}),
  })
  return { database, events, snapshots, reads, blobs, project }
}

it.each([false, true])(
  "loads nested restore baselines in one forward context, mixed authority: %s",
  async (mixed) => {
    const journal = nestedJournal(mixed, 12)
    const fixture = await databaseFixture(journal)
    expect(
      await loadAuthorityRestoreTarget(fixture.database, journal.head.id, journal.head.revision),
    ).toEqual(journal.head)
    expect(fixture.reads.events).toBeLessThanOrEqual(journal.events.length + 1)
    console.info(
      JSON.stringify({
        case: mixed ? "mixed historical load" : "V1 historical load",
        journalEvents: journal.events.length,
        eventReads: fixture.reads.events,
      }),
    )
  },
)

it.each([false, true])(
  "recovers nested restore baselines across a later seed without recursive prefixes, mixed authority: %s",
  async (mixed) => {
    const journal = nestedJournal(mixed, 12)
    const fixture = await databaseFixture(journal, true)
    const recovered = await recoverAuthoritySnapshot(fixture.database, fixture.project)
    expect(recovered).toEqual({ snapshot: journal.head, corruptRecords: [] })
    expect(fixture.reads.events).toBeLessThanOrEqual(journal.events.length + 1)
    console.info(
      JSON.stringify({
        case: mixed ? "mixed seeded recovery" : "V1 seeded recovery",
        journalEvents: journal.events.length,
        eventReads: fixture.reads.events,
      }),
    )
  },
)

it("reconstructs evicted ordinary and restore targets without retaining every full snapshot", async () => {
  const journal = nestedJournal(false, 140, undefined, 150)
  const fixture = await databaseFixture(journal)
  expect(
    await loadAuthorityRestoreTarget(fixture.database, journal.head.id, journal.head.revision),
  ).toEqual(journal.head)
  expect(fixture.reads.events).toBeLessThanOrEqual(journal.events.length + 2)
  console.info(
    JSON.stringify({
      case: "evicted targets",
      journalEvents: journal.events.length,
      eventReads: fixture.reads.events,
    }),
  )
})

it("reconstructs an evicted cross-schema restore through the original verified domain event", async () => {
  const prefix = nestedJournal(true, 1)
  let target: DocumentAuthoritySnapshot | null = null
  for (const event of prefix.events.slice(0, 2)) target = reduced(target, event).snapshot
  if (!target) throw new Error("Missing V2 target")
  const changed = rename(prefix.head, "Before cross-schema restore")
  const restored = reduced(
    changed.snapshot,
    {
      ...envelope(changed.snapshot),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      direction: "undo",
      targetRevision: target.revision,
    },
    target,
  )
  const suffix = nestedJournal(false, 4, restored.snapshot, 150)
  const journal = {
    ...suffix,
    seed: null,
    events: [...prefix.events, changed.event, restored.event, ...suffix.events],
  }
  const fixture = await databaseFixture(journal)
  expect(
    await loadAuthorityRestoreTarget(fixture.database, journal.head.id, journal.head.revision),
  ).toEqual(journal.head)
  expect(fixture.reads.events).toBeLessThanOrEqual(journal.events.length + 9)
  console.info(
    JSON.stringify({
      case: "evicted cross-schema restore",
      journalEvents: journal.events.length,
      eventReads: fixture.reads.events,
    }),
  )
})

it.each(["missing", "checksum", "wrong-document"] as const)(
  "rejects a %s historical event and preserves recovered-loss reporting",
  async (damage) => {
    const journal = nestedJournal(false, 4)
    const fixture = await databaseFixture(journal)
    const revision = 4
    const event = fixture.events.get(revision)
    if (!event) throw new Error("Missing corruption fixture event")
    if (damage === "missing") fixture.events.delete(revision)
    else if (damage === "checksum")
      fixture.events.set(revision, { ...event, checksum: "0".repeat(64) })
    else fixture.events.set(revision, { ...event, documentId: documentIdSchema.parse(id(90)) })
    expect(
      await loadAuthorityRestoreTarget(fixture.database, journal.head.id, journal.head.revision),
    ).toBeNull()
    const recovered = await recoverAuthoritySnapshot(fixture.database, fixture.project)
    expect(recovered.snapshot.revision).toBe(revision - 1)
    expect(recovered.corruptRecords).toEqual([`event-authority:${revision}`])
  },
)

it.each(["intact", "missing", "checksum"] as const)(
  "validates %s source bytes while resolving restored V4 targets",
  async (damage) => {
    const source = await sourceAssetsFixture()
    const journal = nestedJournal(false, 4, source.added.snapshot)
    const fixture = await databaseFixture(journal)
    if (damage === "intact") {
      fixture.blobs.set(source.blob.digest, source.blob)
      expect(
        await loadAuthorityRestoreTarget(fixture.database, journal.head.id, journal.head.revision),
      ).toEqual(journal.head)
      return
    }
    if (damage === "checksum")
      fixture.blobs.set(source.blob.digest, {
        ...source.blob,
        bytes: new Uint8Array(source.blob.bytes.length),
      })
    await expect(
      loadAuthorityRestoreTarget(fixture.database, journal.head.id, journal.head.revision),
    ).rejects.toThrow("Required source bytes are missing or corrupt")
    await expect(recoverAuthoritySnapshot(fixture.database, fixture.project)).rejects.toThrow(
      "Required source bytes are missing or corrupt",
    )
  },
)

function oversizedSeed() {
  const f = surfaceTextureProjectFixture()
  const promoted = reduced(f.snapshot, {
    ...envelope(f.snapshot),
    schemaVersion: 3,
    type: "org.vibeshape.document.upgraded-v3",
    change: null,
  }).snapshot
  const originalFeature = promoted.features[0]
  const originalPart = promoted.schemaVersion !== 1 ? promoted.parts[0] : undefined
  if (!originalFeature || !originalPart) throw new Error("Missing textured body fixture")
  const features = Array.from({ length: 16 }, (_, index) => ({
    ...originalFeature,
    id: featureIdSchema.parse(id(200 + index)),
  }))
  const parts = features.map((feature, index) =>
    JSON.parse(
      JSON.stringify(originalPart)
        .replaceAll(originalFeature.id, feature.id)
        .replaceAll(originalPart.id, id(300 + index)),
    ),
  )
  const pixels = Array<number>(256 * 256).fill(255)
  return documentSnapshotV3Schema.parse({
    ...promoted,
    features,
    parts,
    history: features.map(({ id }) => ({ kind: "feature", id })),
    surfaceTextures: features.flatMap((feature, index) =>
      Array.from({ length: 4 }, (_, layer) => ({
        ...f.layer,
        id: surfaceTextureLayerIdSchema.parse(id(400 + index * 4 + layer)),
        featureId: feature.id,
        map: { kind: "custom", width: 256, height: 256, pixels },
      })),
    ),
  })
}

it("resolves nested baselines larger than the entire snapshot-cache budget without recursive replay", async () => {
  const seed = oversizedSeed()
  expect(canonicalJson(seed).length * 2 > 32 * 1024 * 1024).toBe(true)
  const journal = nestedJournal(false, 2, seed)
  const fixture = await databaseFixture(journal)
  const result = await loadAuthorityRestoreTarget(fixture.database, seed.id, journal.head.revision)
  expect(result?.revision).toBe(journal.head.revision)
  expect(result?.name).toBe(seed.name)
  expect(fixture.reads.events).toBeLessThanOrEqual(journal.events.length + 1)
  // The oversized seed cannot live in the 32 MiB cache, and is read again on demand.
  expect(fixture.reads.snapshots).toBeGreaterThan(3)
  console.info(
    JSON.stringify({
      case: "oversized nested targets",
      journalEvents: journal.events.length,
      eventReads: fixture.reads.events,
      snapshotReads: fixture.reads.snapshots,
    }),
  )
  // The real >32 MiB fixture exceeded 30 seconds alongside native suites in CI.
  // Read-count assertions above enforce replay work independently of this timeout.
}, 90000)

it("bridges a corrupt older journal segment with a later verified checkpoint without losing target availability", async () => {
  const journal = nestedJournal(false, 12)
  const fixture = await databaseFixture(journal)
  let checkpoint: DocumentAuthoritySnapshot | null = null
  let prior: DocumentAuthoritySnapshot | null = null
  const states = new Map<number, DocumentAuthoritySnapshot>()
  for (const event of journal.events.slice(0, 15)) {
    const target =
      event.type === "org.vibeshape.document.restored"
        ? states.get(event.targetRevision)
        : undefined
    prior = reduced(prior, event, target).snapshot
    states.set(prior.revision, prior)
    checkpoint = prior
  }
  if (!checkpoint) throw new Error("Missing later recovery checkpoint")
  fixture.snapshots.set(checkpoint.revision, await storeAuthoritySnapshot(checkpoint, timestamp))
  const damaged = fixture.events.get(4)
  if (!damaged) throw new Error("Missing earlier journal segment")
  fixture.events.set(4, { ...damaged, checksum: "0".repeat(64) })
  expect(
    await loadAuthorityRestoreTarget(fixture.database, journal.head.id, journal.head.revision),
  ).toEqual(journal.head)
  expect(fixture.reads.events).toBeLessThanOrEqual(journal.events.length + 2)
  expect(await loadAuthorityRestoreTarget(fixture.database, journal.head.id, 5)).toBeNull()
  expect(await recoverAuthoritySnapshot(fixture.database, fixture.project)).toEqual({
    snapshot: journal.head,
    corruptRecords: [],
  })
})
