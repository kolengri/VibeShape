import {
  applyDocumentV4Command,
  canonicalJson,
  type DocumentSnapshotV4,
  documentRestoredV4EventSchema,
  type PinnedAssemblyDefinition,
  reduceDocumentV4Event,
  type SourceAssetBlob,
} from "../packages/domain/src/index"
import { readVShapeV5, writeVShapeV5 } from "../packages/formats/src/vshape"
import type { PortableProjectV5 } from "../packages/persistence/src/authority-schemas"
import { VibeShapeDatabase } from "../packages/persistence/src/database"
import { acquireDocumentLease } from "../packages/persistence/src/lease"
import {
  prepareSourceAssetBytes,
  readSourceAssetBytes,
} from "../packages/persistence/src/source-asset-store"
import { sourceAssetsMigrationEvidence } from "../packages/persistence/src/source-assets-migration-fixture"
import { VersionedLocalDocumentRepository } from "../packages/persistence/src/versioned-repository"
import {
  authorityEnvelope,
  authorityId,
  authorityTimestamp,
  evidenceValue,
} from "./authority-persistence-fixture"
import { changedLibraryPinFixture, sourceAssetsFixture } from "./source-assets-fixture"
import { sourceAssetsTransactionEvidence } from "./source-assets-transaction-evidence"

function requireEvidence(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const documentId = authorityId(1)
const sessionId = authorityId(900)
const lease = { epoch: 1, nowMs: 1 }
const common = { sessionId, lease, storedAt: authorityTimestamp }
async function identity(database: VibeShapeDatabase) {
  return canonicalJson({
    head: await database.projectsV1.toArray(),
    events: await database.eventsV1.toArray(),
    snapshots: await database.snapshotsV1.toArray(),
    recovery: await database.recoveryV1.toArray(),
    leases: await database.leases.toArray(),
    blobs: (await database.assetBlobs.toArray()).map(({ digest, bytes }) => ({
      digest,
      bytes: Array.from(bytes),
    })),
  })
}

function pinChange(snapshot: DocumentSnapshotV4, changes: readonly unknown[]) {
  return evidenceValue(
    applyDocumentV4Command(snapshot, {
      ...authorityEnvelope(snapshot.revision),
      schemaVersion: 4,
      kind: "org.vibeshape.document.assembly-command",
      payload: { changes },
    }),
  )
}

async function rejectHistoricalPinReplacement(
  database: VibeShapeDatabase,
  repository: VersionedLocalDocumentRepository,
  snapshot: DocumentSnapshotV4,
  definition: PinnedAssemblyDefinition,
  blob: SourceAssetBlob,
) {
  const before = await identity(database)
  const prepared = evidenceValue(
    await prepareSourceAssetBytes(definition.pinnedModels[0]?.assets[0], blob.bytes),
  ).value
  const changes = [
    { kind: "definition.insert-pinned", definition },
    {
      kind: "definition.relink-pinned",
      definition: { ...definition, id: authorityId(750), pinRevision: 2 },
    },
  ]
  for (const change of changes) {
    const changed = pinChange(snapshot, [change])
    const rejected = await repository.commitAuthority({
      ...common,
      baseSnapshot: snapshot,
      snapshot: changed.snapshot,
      event: changed.event,
      assetBlobs: [prepared],
    })
    requireEvidence(
      !rejected.ok &&
        rejected.diagnostic.code === "invalid-input" &&
        (await identity(database)) === before,
      `${change.kind} reassigned an undone library asset/output identity or changed atomic storage.`,
    )
  }
}

async function verifyHistoricalPinBackup(
  repository: VersionedLocalDocumentRepository,
  snapshot: DocumentSnapshotV4,
  originalDigest: string,
  replacementDigest: string,
) {
  const portable = evidenceValue(await repository.exportPortableProjectV5(documentId)).value
  requireEvidence(
    canonicalJson(portable.snapshot) === canonicalJson(snapshot) &&
      portable.assetBlobs.some(({ digest }) => digest === originalDigest) &&
      portable.assetBlobs.every(({ digest }) => digest !== replacementDigest),
    "Rejected pin replacements changed the complete portable source closure.",
  )
  const archive = evidenceValue(
    await writeVShapeV5({
      ...portable,
      exportedAt: authorityTimestamp,
      createdBy: { application: "VibeShape", version: "0.0.0", build: null },
    }),
  ).value
  const native = evidenceValue(await readVShapeV5(archive)).value
  requireEvidence(
    canonicalJson(native.snapshot) === canonicalJson(snapshot) &&
      native.assetBlobs.some(({ digest }) => digest === originalDigest),
    "The original library asset/pin history became invalid after a rejected publication.",
  )
}

async function historicalLibraryPinEvidence(name: string, portable: PortableProjectV5) {
  const database = new VibeShapeDatabase(name)
  const repository = new VersionedLocalDocumentRepository(database)
  try {
    evidenceValue(
      await repository.importPortableProjectV5({
        ...portable,
        importedAt: authorityTimestamp,
        exportedAt: authorityTimestamp,
      }),
    )
    evidenceValue(
      await acquireDocumentLease(database, {
        documentId,
        ownerId: sessionId,
        nowMs: 0,
        durationMs: 60_000,
      }),
    )
    const baseline = pinChange(portable.snapshot, [
      {
        kind: "definition.create",
        definition: {
          schemaVersion: 1,
          id: authorityId(750),
          name: "Surviving untextured source",
          sources: [
            {
              kind: "part",
              partId: authorityId(100),
              body: { schemaVersion: 0, featureId: authorityId(200), outputRole: "result" },
              contentHash: "a".repeat(64),
            },
          ],
          sourceFrame: { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        },
      },
    ])
    evidenceValue(
      await repository.commitAuthority({
        ...common,
        baseSnapshot: portable.snapshot,
        snapshot: baseline.snapshot,
        event: baseline.event,
      }),
    )
    const replacement = changedLibraryPinFixture()
    const original = replacement.original
    const inserted = pinChange(baseline.snapshot, [
      { kind: "definition.insert-pinned", definition: original.definition },
    ])
    evidenceValue(
      await repository.commitAuthority({
        ...common,
        baseSnapshot: baseline.snapshot,
        snapshot: inserted.snapshot,
        event: inserted.event,
        assetBlobs: [original.blob],
      }),
    )
    const undo = documentRestoredV4EventSchema.parse({
      ...authorityEnvelope(inserted.snapshot.revision),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: inserted.snapshot.revision + 1,
      direction: "undo",
      targetRevision: baseline.snapshot.revision,
    })
    const undone = evidenceValue(
      reduceDocumentV4Event(inserted.snapshot, undo, baseline.snapshot),
    ).snapshot
    evidenceValue(
      await repository.commitAuthority({
        ...common,
        baseSnapshot: inserted.snapshot,
        snapshot: undone,
        event: undo,
      }),
    )
    requireEvidence(
      undone.assets.length === 0 && undone.assembly.definitions.length === 1,
      "The pin collision fixture must retain only the asset-free relink target after Undo.",
    )
    await rejectHistoricalPinReplacement(
      database,
      repository,
      undone,
      replacement.definition,
      replacement.blob,
    )
    await verifyHistoricalPinBackup(
      repository,
      undone,
      original.asset.digest,
      replacement.asset.digest,
    )
    const identical = pinChange(undone, [
      { kind: "definition.insert-pinned", definition: original.definition },
    ])
    evidenceValue(
      await repository.commitAuthority({
        ...common,
        baseSnapshot: undone,
        snapshot: identical.snapshot,
        event: identical.event,
      }),
    )
  } finally {
    await database.delete()
  }
}

export async function runSourceAssetsPersistenceEvidence(name: string) {
  const f = await sourceAssetsFixture()
  let database = new VibeShapeDatabase(name)
  const importedDatabase = new VibeShapeDatabase(`${name}-import`)
  let repository = new VersionedLocalDocumentRepository(database)
  try {
    evidenceValue(
      await repository.commit({
        ...common,
        lease: null,
        baseSnapshot: null,
        snapshot: f.authored.created.snapshot,
        event: f.authored.created.event,
      }),
    )
    evidenceValue(
      await acquireDocumentLease(database, {
        documentId,
        ownerId: sessionId,
        nowMs: 0,
        durationMs: 60_000,
      }),
    )
    evidenceValue(
      await repository.commit({
        ...common,
        baseSnapshot: f.authored.created.snapshot,
        snapshot: f.authored.added.snapshot,
        event: f.authored.added.event,
      }),
    )
    evidenceValue(
      await repository.commitAuthority({
        ...common,
        baseSnapshot: f.authored.added.snapshot,
        snapshot: f.authored.upgraded.snapshot,
        event: f.authored.upgraded.event,
      }),
    )
    evidenceValue(
      await repository.commitAuthority({
        ...common,
        baseSnapshot: f.authored.upgraded.snapshot,
        snapshot: f.textureUpgraded.snapshot,
        event: f.textureUpgraded.event,
      }),
    )
    const oldEvents = canonicalJson(await database.eventsV1.toArray())
    evidenceValue(
      await repository.commitAuthority({
        ...common,
        baseSnapshot: f.textureUpgraded.snapshot,
        snapshot: f.upgraded.snapshot,
        event: f.upgraded.event,
      }),
    )
    requireEvidence(
      canonicalJson((await database.eventsV1.toArray()).slice(0, 4)) === oldEvents,
      "V4 upgrade rewrote the old event prefix.",
    )
    const before = await identity(database)
    const commit = {
      ...common,
      baseSnapshot: f.upgraded.snapshot,
      snapshot: f.added.snapshot,
      event: f.added.event,
    }
    const missing = await repository.commitAuthority(commit)
    requireEvidence(
      !missing.ok &&
        missing.diagnostic.code === "corrupt-history" &&
        (await identity(database)) === before,
      "Missing source bytes escaped atomic validation.",
    )
    const mismatch = await repository.commitAuthority({
      ...commit,
      assetBlobs: [{ ...f.blob, bytes: new Uint8Array(f.blob.bytes.length) }],
    })
    requireEvidence(
      !mismatch.ok &&
        mismatch.diagnostic.code === "invalid-input" &&
        (await identity(database)) === before,
      "A mismatched digest changed authority.",
    )
    const quota = () => {
      throw new DOMException("Forced source asset quota failure", "QuotaExceededError")
    }
    database.snapshotsV1.hook("creating", quota)
    const quotaResult = await repository.commitAuthority({ ...commit, assetBlobs: [f.blob] })
    database.snapshotsV1.hook("creating").unsubscribe(quota)
    requireEvidence(
      !quotaResult.ok &&
        quotaResult.diagnostic.code === "quota-exceeded" &&
        (await identity(database)) === before,
      "Source bytes or events survived quota rollback.",
    )
    evidenceValue(await repository.commitAuthority({ ...commit, assetBlobs: [f.blob] }))
    const published = await identity(database)
    const stale = await repository.commitAuthority({ ...commit, assetBlobs: [f.blob] })
    requireEvidence(
      !stale.ok &&
        stale.diagnostic.code === "stale-revision" &&
        (await identity(database)) === published,
      "A stale source publication changed authority.",
    )
    const read = evidenceValue(await readSourceAssetBytes(database, f.blob.digest)).value
    read.fill(0)
    requireEvidence(
      evidenceValue(await readSourceAssetBytes(database, f.blob.digest)).value.some(
        (byte) => byte !== 0,
      ),
      "Readback exposed stored mutable bytes.",
    )
    database.close()
    database = new VibeShapeDatabase(name)
    repository = new VersionedLocalDocumentRepository(database)
    requireEvidence(
      evidenceValue(await repository.recoverAuthority(documentId)).value.snapshot.schemaVersion ===
        4,
      "Source authority did not survive a database restart.",
    )
    const undo = documentRestoredV4EventSchema.parse({
      ...authorityEnvelope(6),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: 7,
      direction: "undo",
      targetRevision: 5,
    })
    const restored = evidenceValue(
      reduceDocumentV4Event(f.added.snapshot, undo, f.upgraded.snapshot),
    ).snapshot
    evidenceValue(
      await repository.commitAuthority({
        ...common,
        baseSnapshot: f.added.snapshot,
        snapshot: restored,
        event: undo,
      }),
    )
    requireEvidence(
      restored.assets.length === 0 && (await database.assetBlobs.count()) === 1,
      "Undo deleted immutable historical source bytes.",
    )
    const restoredIdentity = await identity(database)
    const changedAsset = evidenceValue(
      applyDocumentV4Command(restored, {
        ...authorityEnvelope(7),
        schemaVersion: 4,
        kind: "org.vibeshape.document.add-source-assets",
        payload: { assets: [{ ...f.asset, filename: "Replacement.step" }] },
      }),
    )
    const reused = await repository.commitAuthority({
      ...common,
      baseSnapshot: restored,
      snapshot: changedAsset.snapshot,
      event: changedAsset.event,
    })
    requireEvidence(
      !reused.ok &&
        reused.diagnostic.code === "invalid-input" &&
        (await identity(database)) === restoredIdentity,
      "An undone source identity was reassigned to another descriptor.",
    )
    const portable = evidenceValue(await repository.exportPortableProjectV5(documentId)).value
    requireEvidence(
      portable.assetBlobs.length === 1,
      "Portable backup omitted the Redo source closure.",
    )
    await historicalLibraryPinEvidence(`${name}-pins`, portable)
    const archive = evidenceValue(
      await writeVShapeV5({
        ...portable,
        exportedAt: authorityTimestamp,
        createdBy: { application: "VibeShape", version: "0.0.0", build: null },
      }),
    ).value
    const native = evidenceValue(await readVShapeV5(archive)).value
    const imported = new VersionedLocalDocumentRepository(importedDatabase)
    evidenceValue(
      await imported.importPortableProjectV5({
        ...portable,
        snapshot: native.snapshot,
        seed: native.seed,
        versionedEvents: native.versionedEvents,
        assetBlobs: native.assetBlobs,
        importedAt: authorityTimestamp,
        exportedAt: authorityTimestamp,
      }),
    )
    evidenceValue(
      await acquireDocumentLease(importedDatabase, {
        documentId,
        ownerId: sessionId,
        nowMs: 0,
        durationMs: 60_000,
      }),
    )
    const redo = documentRestoredV4EventSchema.parse({
      ...authorityEnvelope(7),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: 8,
      direction: "redo",
      targetRevision: 6,
    })
    const redone = evidenceValue(reduceDocumentV4Event(restored, redo, f.added.snapshot)).snapshot
    evidenceValue(
      await imported.commitAuthority({
        ...common,
        baseSnapshot: restored,
        snapshot: redone,
        event: redo,
      }),
    )
    requireEvidence(
      evidenceValue(await imported.recoverAuthority(documentId)).value.snapshot.revision === 8 &&
        evidenceValue(await readSourceAssetBytes(importedDatabase, f.blob.digest)).value
          .byteLength === f.blob.bytes.length,
      "Native reopen Redo lost its source asset.",
    )
    await importedDatabase.assetBlobs.put({ ...f.blob, bytes: new Uint8Array(f.blob.bytes.length) })
    const corrupt = await imported.recoverAuthority(documentId)
    requireEvidence(
      !corrupt.ok && corrupt.diagnostic.code === "corrupt-history",
      "A corrupt blob became recoverable source authority.",
    )
    const head = await database.projectsV1.get(documentId)
    requireEvidence(head !== undefined, "Missing source head.")
    await database.projectsV1.put({ ...head, schemaVersion: 99 } as unknown as typeof head)
    const unsupported = await repository.recoverAuthority(documentId)
    requireEvidence(
      !unsupported.ok && unsupported.diagnostic.code === "unsupported-version",
      "Future authority fell back to an old snapshot.",
    )
    return {
      authoredTransaction: await sourceAssetsTransactionEvidence(`${name}-transaction`),
      publication: true,
      quotaRollback: true,
      staleRejected: true,
      restarted: true,
      nativeUndoRedo: true,
      corruptRejected: true,
      unsupportedRejected: true,
      migration: await sourceAssetsMigrationEvidence(
        `${name}-migration`,
        f.authored.upgraded.snapshot,
        [f.authored.created.event, f.authored.added.event, f.authored.upgraded.event],
        authorityTimestamp,
      ),
      schemaVersion: database.verno,
    }
  } finally {
    await database.delete()
    await importedDatabase.delete()
  }
}
