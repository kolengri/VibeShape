import {
  applyDocumentV2Command,
  applyVersionedDocumentCommand,
  canonicalJson,
  copyCompleteDocumentAuthorityHistory,
  documentRestoredV2EventSchema,
  projectDocumentSnapshotV2ToV1,
  reduceDocumentV2Event,
} from "../packages/domain/src/index"
import { readVShapeV3, writeVShapeV3 } from "../packages/formats/src/index"
import { portableProjectV3PayloadSchema } from "../packages/persistence/src/authority-schemas"
import { VibeShapeDatabase } from "../packages/persistence/src/database"
import { acquireDocumentLease, releaseDocumentLease } from "../packages/persistence/src/lease"
import type { PersistenceResult } from "../packages/persistence/src/repository"
import { VersionedLocalDocumentRepository } from "../packages/persistence/src/versioned-repository"
import { verifyLegacyAuthorityBridge } from "./authority-legacy-evidence"
import {
  authorityEnvelope,
  authorityFixture,
  authorityId,
  authorityTimestamp,
  evidenceValue,
} from "./authority-persistence-fixture"

const documentId = authorityId(1)
const sessionId = authorityId(900)
const secondSessionId = authorityId(901)
const lease = { epoch: 1, nowMs: 1 }
const storedAt = authorityTimestamp
function requireEvidence(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function diagnostic(result: PersistenceResult<unknown>, code: string) {
  requireEvidence(
    !result.ok && result.diagnostic.code === code,
    `Expected ${code}: ${JSON.stringify(result)}`,
  )
  return code
}
async function storedIdentity(database: VibeShapeDatabase) {
  return canonicalJson(
    await Promise.all([
      database.projectsV1.toArray(),
      database.snapshotsV1.toArray(),
      database.eventsV1.toArray(),
      database.recoveryV1.toArray(),
    ]),
  )
}
async function createAuthority(database: VibeShapeDatabase) {
  const fixture = authorityFixture()
  const repository = new VersionedLocalDocumentRepository(database)
  const { ok: _created, ...created } = fixture.created
  evidenceValue(
    await repository.commit({ sessionId, lease: null, storedAt, baseSnapshot: null, ...created }),
  )
  evidenceValue(
    await acquireDocumentLease(database, {
      documentId,
      ownerId: sessionId,
      nowMs: 0,
      durationMs: 60_000,
    }),
  )
  const { ok: _ok, ...added } = fixture.added
  evidenceValue(
    await repository.commit({
      sessionId,
      lease,
      storedAt,
      baseSnapshot: fixture.created.snapshot,
      ...added,
    }),
  )
  const original = await database.eventsV1.toArray()
  const { ok: _upgraded, ...upgraded } = fixture.upgraded
  evidenceValue(
    await repository.commitAuthority({
      sessionId,
      lease,
      storedAt,
      baseSnapshot: fixture.added.snapshot,
      ...upgraded,
    }),
  )
  requireEvidence(
    canonicalJson((await database.eventsV1.toArray()).slice(0, 2)) === canonicalJson(original),
    "Upgrade rewrote old journal bytes.",
  )
  return { repository, fixture }
}
async function verifyRollback(
  database: VibeShapeDatabase,
  repository: VersionedLocalDocumentRepository,
) {
  const fixture = authorityFixture()
  const before = await storedIdentity(database)
  const fail = () => {
    throw new DOMException("Controlled quota failure", "QuotaExceededError")
  }
  database.snapshotsV1.hook("creating", fail)
  try {
    const { ok: _ok, ...renamed } = fixture.renamed
    diagnostic(
      await repository.commitAuthority({
        sessionId,
        lease,
        storedAt,
        baseSnapshot: fixture.upgraded.snapshot,
        ...renamed,
      }),
      "quota-exceeded",
    )
  } finally {
    database.snapshotsV1.hook("creating").unsubscribe(fail)
  }
  requireEvidence(
    (await storedIdentity(database)) === before,
    "Failed publication left partial journal or metadata.",
  )
  return true
}
async function verifyDowngrade(
  database: VibeShapeDatabase,
  repository: VersionedLocalDocumentRepository,
) {
  const fixture = authorityFixture()
  const projection = projectDocumentSnapshotV2ToV1(fixture.upgraded.snapshot)
  const old = evidenceValue(
    applyVersionedDocumentCommand(projection, {
      ...authorityEnvelope(3),
      schemaVersion: 1,
      kind: "org.vibeshape.document.rename",
      payload: { name: "Downgrade" },
    }),
  )
  const before = await storedIdentity(database)
  const { ok: _ok, ...event } = old
  diagnostic(
    await repository.commit({ sessionId, lease, storedAt, baseSnapshot: projection, ...event }),
    "corrupt-history",
  )
  requireEvidence(
    (await storedIdentity(database)) === before,
    "An old writer changed V2 authority.",
  )
  evidenceValue(await releaseDocumentLease(database, { documentId, ownerId: sessionId, nowMs: 1 }))
  evidenceValue(
    await acquireDocumentLease(database, {
      documentId,
      ownerId: sessionId,
      nowMs: 1,
      durationMs: 60_000,
    }),
  )
  return true
}
async function verifyRecovery(
  database: VibeShapeDatabase,
  repository: VersionedLocalDocumentRepository,
) {
  const fixture = authorityFixture()
  const { ok: _ok, ...renamed } = fixture.renamed
  evidenceValue(
    await repository.commitAuthority({
      sessionId,
      lease,
      storedAt,
      baseSnapshot: fixture.upgraded.snapshot,
      ...renamed,
    }),
  )
  const record = await database.snapshotsV1.get([documentId, 4])
  const event = await database.eventsV1.get([documentId, 4])
  requireEvidence(record !== undefined && event !== undefined, "Missing authored commit records.")
  await database.snapshotsV1.update([documentId, 4], { checksum: "0".repeat(64) })
  const replayed = evidenceValue(await repository.recoverAuthority(documentId)).value
  requireEvidence(
    canonicalJson(replayed.snapshot) === canonicalJson(fixture.renamed.snapshot),
    "Recovery did not replay part metadata.",
  )
  await database.eventsV1.update([documentId, 4], { checksum: "0".repeat(64) })
  const bounded = evidenceValue(await repository.recoverAuthority(documentId)).value
  requireEvidence(
    bounded.recoveredRevision === 3 && bounded.lostRevisionCount === 1,
    "Recovery did not bound loss at V2 revision.",
  )
  await database.snapshotsV1.put(record)
  await database.eventsV1.put(event)
  return true
}
async function verifyUnknownHead(
  database: VibeShapeDatabase,
  repository: VersionedLocalDocumentRepository,
) {
  const head = await database.projectsV1.get(documentId)
  requireEvidence(head !== undefined, "Missing authored project head.")
  const previousLease = canonicalJson(await database.leases.get(documentId))
  const future = { ...head }
  Reflect.set(future, "schemaVersion", 99)
  await database.projectsV1.put(future)
  diagnostic(await repository.recoverAuthority(documentId), "unsupported-version")
  diagnostic(
    await acquireDocumentLease(database, {
      documentId,
      ownerId: sessionId,
      nowMs: 1,
      durationMs: 60_000,
    }),
    "unsupported-version",
  )
  requireEvidence(
    canonicalJson(await database.leases.get(documentId)) === previousLease,
    "Future authority changed a lease.",
  )
  await database.projectsV1.put(head)
  return true
}

async function verifyDraftAndRace(name: string) {
  const database = new VibeShapeDatabase(`${name}-draft`)
  const other = new VibeShapeDatabase(database.name)
  try {
    const { repository, fixture } = await createAuthority(database)
    const transactionId = authorityId(950)
    const first = { ...fixture.renamed.event, transactionId }
    const second = evidenceValue(
      applyDocumentV2Command(
        fixture.renamed.snapshot,
        {
          ...authorityEnvelope(4),
          schemaVersion: 2,
          kind: "org.vibeshape.document.metadata-command",
          payload: { kind: "part.set-visibility", partId: authorityId(100), visible: false },
        },
        { transactionId },
      ),
    )
    const input = {
      sessionId,
      lease,
      storedAt,
      transactionId,
      baseSnapshot: fixture.upgraded.snapshot,
      events: [first, second.event],
      snapshot: second.snapshot,
    }
    diagnostic(
      await repository.commitAuthorityDraft({ ...input, transactionId: authorityId(951) }),
      "invalid-input",
    )
    const results = await Promise.all([
      repository.commitAuthorityDraft(input),
      new VersionedLocalDocumentRepository(other).commitAuthorityDraft(input),
    ])
    requireEvidence(
      results.filter((result) => result.ok).length === 1,
      "Concurrent drafts did not have exactly one winner.",
    )
    requireEvidence(
      results.some((result) => !result.ok && result.diagnostic.code === "stale-revision"),
      "Concurrent loser did not report a stale base.",
    )
    const recovered = evidenceValue(await repository.recoverAuthority(documentId)).value
    requireEvidence(
      canonicalJson(recovered.snapshot) === canonicalJson(second.snapshot),
      "The atomic draft lost a metadata change.",
    )
    requireEvidence(
      (await database.eventsV1.count()) === 5 && (await database.snapshotsV1.count()) === 4,
      "The draft published partial or redundant records.",
    )
    return true
  } finally {
    other.close()
    await database.delete()
  }
}
async function verifyPortableCopy(
  database: VibeShapeDatabase,
  repository: VersionedLocalDocumentRepository,
) {
  const portable = evidenceValue(await repository.exportPortableProjectV3(documentId)).value
  const archived = evidenceValue(
    await writeVShapeV3({
      ...portable,
      exportedAt: storedAt,
      createdBy: { application: "VibeShape", version: "evidence", build: null },
    }),
  ).value
  const decoded = evidenceValue(await readVShapeV3(archived)).value
  requireEvidence(
    canonicalJson(decoded.snapshot) === canonicalJson(portable.snapshot),
    "Archive lost authored metadata.",
  )
  const copy = evidenceValue(
    copyCompleteDocumentAuthorityHistory({
      sourceLegacyEvents: portable.legacyEvents,
      sourceSeed: portable.seed,
      sourceSnapshot: portable.snapshot,
      sourceEvents: portable.versionedEvents,
      documentId: authorityId(2),
      name: "Assembly copy",
      issuedAt: storedAt,
      actor: { type: "user", userId: null },
      transactionIds: [],
      commandIds: Array.from({ length: portable.versionedEvents.length + 1 }, (_, index) =>
        authorityId(1000 + index),
      ),
    }),
  )
  const copied = portableProjectV3PayloadSchema.parse({
    ...portable,
    snapshot: copy.snapshot,
    seed: copy.seed,
    legacyEvents: [...copy.legacyEvents],
    versionedEvents: [...copy.versionedEvents],
  })
  evidenceValue(await repository.copyPortableProjectV3({ ...copied, copiedAt: storedAt }))
  const recovered = evidenceValue(await repository.recoverAuthority(authorityId(2))).value
  requireEvidence(
    canonicalJson(recovered.snapshot) === canonicalJson(copy.snapshot),
    "Copied authored authority did not recover.",
  )
  diagnostic(
    await repository.importPortableProjectV3({
      ...copied,
      importedAt: storedAt,
      exportedAt: storedAt,
    }),
    "document-already-exists",
  )
  const importedDatabase = new VibeShapeDatabase(`${database.name}-import`)
  try {
    const imported = new VersionedLocalDocumentRepository(importedDatabase)
    evidenceValue(
      await imported.importPortableProjectV3({
        ...portable,
        importedAt: storedAt,
        exportedAt: storedAt,
      }),
    )
    const restore = documentRestoredV2EventSchema.parse({
      ...authorityEnvelope(4),
      schemaVersion: 2,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: 5,
      targetRevision: 3,
      direction: "undo",
    })
    const restored = evidenceValue(
      reduceDocumentV2Event(portable.snapshot, restore, authorityFixture().upgraded.snapshot),
    )
    evidenceValue(
      await acquireDocumentLease(importedDatabase, {
        documentId,
        ownerId: sessionId,
        nowMs: 0,
        durationMs: 60_000,
      }),
    )
    evidenceValue(
      await imported.commitAuthority({
        sessionId,
        lease,
        storedAt,
        baseSnapshot: portable.snapshot,
        event: restore,
        snapshot: restored.snapshot,
      }),
    )
    requireEvidence(
      evidenceValue(await imported.recoverAuthority(documentId)).value.snapshot.revision === 5,
      "Imported history lost its historical Undo target.",
    )
  } finally {
    await importedDatabase.delete()
  }
  return true
}

async function verifyCheckpointExport(
  database: VibeShapeDatabase,
  repository: VersionedLocalDocumentRepository,
) {
  const first = await database.eventsV1.get([documentId, 1])
  requireEvidence(first !== undefined, "Missing original event before corruption probe.")
  await database.eventsV1.delete([documentId, 1])
  try {
    const checkpoint = evidenceValue(await repository.exportPortableProjectV3(documentId)).value
    requireEvidence(
      checkpoint.historyMode === "checkpoint" && checkpoint.snapshot.schemaVersion === 2,
      "Missing history was presented as a complete archive.",
    )
    diagnostic(
      await repository.importPortableProjectV3({
        ...checkpoint,
        importedAt: storedAt,
        exportedAt: storedAt,
      }),
      "invalid-input",
    )
  } finally {
    await database.eventsV1.add(first)
  }
  return true
}

export async function runAuthorityPersistenceEvidence(name: string) {
  const database = new VibeShapeDatabase(name)
  try {
    const { repository } = await createAuthority(database)
    const rollback = await verifyRollback(database, repository)
    const oldWriterBarrier = await verifyDowngrade(database, repository)
    const recovery = await verifyRecovery(database, repository)
    const unsupported = await verifyUnknownHead(database, repository)
    const portable = await verifyPortableCopy(database, repository)
    const checkpoint = await verifyCheckpointExport(database, repository)
    const draftRace = await verifyDraftAndRace(name)
    const legacyBridge = await verifyLegacyAuthorityBridge(name)
    evidenceValue(
      await repository.closeAuthorityCleanly({ documentId, revision: 4, sessionId, lease }),
    )
    requireEvidence(
      evidenceValue(await repository.recoverAuthority(documentId)).value.status === "clean",
      "Authored close did not clear recovery marker.",
    )
    return {
      rollback,
      oldWriterBarrier,
      recovery,
      unsupported,
      portable,
      checkpoint,
      draftRace,
      legacyBridge,
      schemaVersion: database.verno,
    }
  } finally {
    await database.delete()
  }
}

export async function prepareAuthorityTab(name: string) {
  const database = new VibeShapeDatabase(name)
  try {
    await createAuthority(database)
    return true
  } finally {
    database.close()
  }
}
export async function takeOverAuthorityTab(name: string) {
  const database = new VibeShapeDatabase(name)
  try {
    diagnostic(
      await acquireDocumentLease(database, {
        documentId,
        ownerId: secondSessionId,
        nowMs: 1,
        durationMs: 60_000,
      }),
      "lease-held",
    )
    return evidenceValue(
      await acquireDocumentLease(database, {
        documentId,
        ownerId: secondSessionId,
        nowMs: 60_001,
        durationMs: 60_000,
      }),
    ).value.lease.epoch
  } finally {
    database.close()
  }
}
export async function verifyStaleAuthorityTab(name: string) {
  const database = new VibeShapeDatabase(name)
  try {
    const repository = new VersionedLocalDocumentRepository(database)
    const fixture = authorityFixture()
    const { ok: _ok, ...renamed } = fixture.renamed
    const before = await storedIdentity(database)
    diagnostic(
      await repository.commitAuthority({
        sessionId,
        lease: { epoch: 1, nowMs: 60_002 },
        storedAt,
        baseSnapshot: fixture.upgraded.snapshot,
        ...renamed,
      }),
      "lease-lost",
    )
    diagnostic(
      await repository.closeAuthorityCleanly({
        documentId,
        revision: 3,
        sessionId,
        lease: { epoch: 1, nowMs: 60_002 },
      }),
      "lease-lost",
    )
    requireEvidence(
      (await storedIdentity(database)) === before,
      "Stale tab changed authority or clean-close state.",
    )
    return true
  } finally {
    await database.delete()
  }
}
