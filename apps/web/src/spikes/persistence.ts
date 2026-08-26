import { applyDocumentCommand, canonicalJson, type DocumentSnapshot } from "@vibeshape/domain"
import {
  acquireDocumentLease,
  classifyPersistenceError,
  cleanupDerivedCacheOrphans,
  decideUpdateActivation,
  inspectStorageCapabilities,
  LocalDocumentRepository,
  openOriginPrivateFileSystem,
  type PersistenceResult,
  readDerivedCache,
  releaseDocumentLease,
  selectSaveAsMethod,
  shouldRequestPersistentStorage,
  VibeShapeDatabase,
  writeDerivedCache,
} from "@vibeshape/persistence"
import { isError } from "is-what"

interface PersistenceSpikeState {
  state: "running" | "passed" | "failed"
  stage: string
  report: Record<string, unknown> | null
  error: string | null
}

declare global {
  interface Window {
    __VIBESHAPE_PERSISTENCE_SPIKE__: PersistenceSpikeState
  }
}

const databaseName = "vibeshape-persistence-spike-v0"
const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ac"
const createCommandId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ad"
const renameCommandId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ae"
const staleCommandId = "0195b5ac-b220-7a2c-8c33-67a36a7f21af"
const lostLeaseCommandId = "0195b5ac-b220-7a2c-8c33-67a36a7f21b3"
const ownerA = "0195b5ac-b220-7a2c-8c33-67a36a7f21b0"
const ownerB = "0195b5ac-b220-7a2c-8c33-67a36a7f21b1"
const operationId = "0195b5ac-b220-7a2c-8c33-67a36a7f21b2"
const createdAt = "2026-08-08T00:00:00Z"
const renamedAt = "2026-08-08T00:00:01Z"
let currentStage = "initializing"

async function runStage<Value>(stage: string, operation: () => Promise<Value>) {
  currentStage = stage
  return operation()
}

function requireStatusElement() {
  const element = document.querySelector<HTMLElement>("#status")
  if (!element) throw new Error("The persistence spike status element is missing.")
  return element
}

function requirePersistenceValue<Value>(result: PersistenceResult<Value>) {
  if (!result.ok) throw new Error(`${result.diagnostic.code}: ${result.diagnostic.message}`)
  return result.value
}

function requireDomainResult(result: ReturnType<typeof applyDocumentCommand>) {
  if (!result.ok) throw new Error(`${result.diagnostic.code}: ${result.diagnostic.message}`)
  return result
}

function requireCondition(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

function requirePersistenceFailure(
  result: PersistenceResult<unknown>,
  expectedCode: string,
  message: string,
) {
  if (result.ok) throw new Error(message)
  if (result.diagnostic.code !== expectedCode) throw new Error(message)
  return result.diagnostic
}

function documentCommand(input: {
  commandId: string
  baseRevision: number
  issuedAt: string
  kind: "org.vibeshape.document.create" | "org.vibeshape.document.rename"
  name: string
}) {
  return {
    schemaVersion: 1,
    kind: input.kind,
    commandId: input.commandId,
    documentId,
    baseRevision: input.baseRevision,
    issuedAt: input.issuedAt,
    actor: { type: "user", userId: null },
    payload: { name: input.name },
  }
}

async function resetOpfs() {
  const root = await runStage("opfs-root", () => openOriginPrivateFileSystem(window))
  if (!root) return null
  try {
    currentStage = "opfs-reset-cache"
    await root.removeEntry("cache", { recursive: true })
  } catch {
    // The first run has no cache directory.
  }
  return root
}

async function createHistory(repository: LocalDocumentRepository) {
  const created = requireDomainResult(
    applyDocumentCommand(
      null,
      documentCommand({
        commandId: createCommandId,
        baseRevision: 0,
        issuedAt: createdAt,
        kind: "org.vibeshape.document.create",
        name: "Bracket",
      }),
    ),
  )
  const createCommit = requirePersistenceValue(
    await repository.commit({
      sessionId: ownerA,
      lease: null,
      storedAt: createdAt,
      baseSnapshot: null,
      event: created.event,
      snapshot: created.snapshot,
    }),
  )
  const writerLease = requirePersistenceValue(
    await acquireDocumentLease(repository.database, {
      documentId,
      ownerId: ownerA,
      nowMs: 1_000,
      durationMs: 1_000,
    }),
  )
  const renamed = requireDomainResult(
    applyDocumentCommand(
      created.snapshot,
      documentCommand({
        commandId: renameCommandId,
        baseRevision: 1,
        issuedAt: renamedAt,
        kind: "org.vibeshape.document.rename",
        name: "Bracket v2",
      }),
    ),
  )
  const renameCommit = requirePersistenceValue(
    await repository.commit({
      sessionId: ownerA,
      lease: { epoch: writerLease.lease.epoch, nowMs: 1_000 },
      storedAt: renamedAt,
      baseSnapshot: created.snapshot,
      event: renamed.event,
      snapshot: renamed.snapshot,
    }),
  )
  return { created, renamed, createCommit, renameCommit, writerLease }
}

async function verifyStaleCommit(
  repository: LocalDocumentRepository,
  database: VibeShapeDatabase,
  baseSnapshot: DocumentSnapshot,
) {
  const stale = requireDomainResult(
    applyDocumentCommand(
      baseSnapshot,
      documentCommand({
        commandId: staleCommandId,
        baseRevision: 1,
        issuedAt: "2026-08-08T00:00:02Z",
        kind: "org.vibeshape.document.rename",
        name: "Stale name",
      }),
    ),
  )
  const before = await database.events.count()
  const result = await repository.commit({
    sessionId: ownerA,
    lease: { epoch: 1, nowMs: 1_500 },
    storedAt: "2026-08-08T00:00:02Z",
    baseSnapshot,
    event: stale.event,
    snapshot: stale.snapshot,
  })
  const diagnostic = requirePersistenceFailure(
    result,
    "stale-revision",
    "The stale commit did not fail with a revision diagnostic.",
  )
  requireCondition(
    (await database.events.count()) === before,
    "The rejected transaction left a partial event.",
  )
  return diagnostic.code
}

async function verifyRecovery(
  repository: LocalDocumentRepository,
  database: VibeShapeDatabase,
  checksums: {
    createEventChecksum: string
    eventChecksum: string
    snapshotChecksum: string
  },
) {
  const journalStorageBefore = await semanticStorageIdentity(database)
  const journalDerived = requirePersistenceValue(await repository.recoverMigrated(documentId))
  requireCondition(
    [
      journalDerived.snapshot.schemaVersion === 1,
      journalDerived.migration.provenance === "journal-derived",
    ].every(Boolean),
    "A complete stored journal did not produce a journal-derived History migration.",
  )
  requireCondition(
    (await semanticStorageIdentity(database)) === journalStorageBefore,
    "Journal-derived recovery mutated semantic persistence records.",
  )
  await database.snapshots.update([documentId, 2], { checksum: "0".repeat(64) })
  const replayed = requirePersistenceValue(await repository.recover(documentId))
  requireCondition(
    [replayed.snapshot.revision === 2, replayed.corruptRecords.includes("snapshot:2")].every(
      Boolean,
    ),
    "The valid event did not recover the corrupted latest snapshot.",
  )
  await database.events.update([documentId, 2], { checksum: "0".repeat(64) })
  const boundedLoss = requirePersistenceValue(await repository.recover(documentId))
  requireCondition(
    [boundedLoss.recoveredRevision === 1, boundedLoss.lostRevisionCount === 1].every(Boolean),
    "Corrupt snapshot and event recovery exceeded the one-revision loss bound.",
  )
  const boundedStorageBefore = await semanticStorageIdentity(database)
  const boundedMigration = requirePersistenceValue(await repository.recoverMigrated(documentId))
  requireCondition(
    [
      boundedMigration.recoveredRevision === 1,
      boundedMigration.snapshot.revision === 1,
      boundedMigration.migration.provenance === "journal-derived",
      (await semanticStorageIdentity(database)) === boundedStorageBefore,
    ].every(Boolean),
    "Migrated recovery did not derive against the actual bounded-loss revision.",
  )
  await database.snapshots.update([documentId, 2], { checksum: checksums.snapshotChecksum })
  await database.events.update([documentId, 2], { checksum: checksums.eventChecksum })
  await database.events.update([documentId, 1], { checksum: "0".repeat(64) })
  const degradedStorageBefore = await semanticStorageIdentity(database)
  const snapshotDerived = requirePersistenceValue(await repository.recoverMigrated(documentId))
  requireCondition(
    [
      snapshotDerived.migration.provenance === "snapshot-derived",
      snapshotDerived.migration.unavailableRecords.includes("event:1"),
      snapshotDerived.migration.diagnostic?.code === "legacy-journal-unavailable",
    ].every(Boolean),
    "A corrupt journal prefix did not produce an explicit snapshot-derived migration.",
  )
  requireCondition(
    (await semanticStorageIdentity(database)) === degradedStorageBefore,
    "Snapshot-derived recovery mutated semantic persistence records.",
  )
  const storedSnapshot = await database.snapshots.get([documentId, 2])
  const storedSnapshotSchema = storedSnapshot
    ? Reflect.get(JSON.parse(storedSnapshot.payload), "schemaVersion")
    : null
  requireCondition(
    storedSnapshotSchema === 0,
    "Read-only History migration rewrote the stored legacy snapshot.",
  )
  await database.events.update([documentId, 1], { checksum: checksums.createEventChecksum })
  return {
    replayed,
    boundedLoss,
    migration: {
      journalProvenance: journalDerived.migration.provenance,
      degradedProvenance: snapshotDerived.migration.provenance,
      boundedRevision: boundedMigration.recoveredRevision,
      boundedProvenance: boundedMigration.migration.provenance,
      unavailableRecords: snapshotDerived.migration.unavailableRecords,
      storedSnapshotSchema,
    },
  }
}

async function semanticStorageIdentity(database: VibeShapeDatabase) {
  const snapshots = (
    await database.snapshots.where("documentId").equals(documentId).toArray()
  ).sort((left, right) => left.revision - right.revision)
  const events = (await database.events.where("documentId").equals(documentId).toArray()).sort(
    (left, right) => left.revision - right.revision,
  )
  return canonicalJson({
    project: (await database.projects.get(documentId)) ?? null,
    snapshots,
    events,
    recovery: (await database.recovery.get(documentId)) ?? null,
  })
}

async function verifyLeases(
  database: VibeShapeDatabase,
  repository: LocalDocumentRepository,
  acquired: { status: "acquired" | "renewed" | "taken-over" },
  baseSnapshot: DocumentSnapshot,
) {
  const blocked = await acquireDocumentLease(database, {
    documentId,
    ownerId: ownerB,
    nowMs: 1_500,
    durationMs: 1_000,
  })
  const blockedDiagnostic = requirePersistenceFailure(
    blocked,
    "lease-held",
    "A live lease did not block the second writer.",
  )
  const takeover = requirePersistenceValue(
    await acquireDocumentLease(database, {
      documentId,
      ownerId: ownerB,
      nowMs: 2_001,
      durationMs: 1_000,
    }),
  )
  const oldOwnerRelease = await releaseDocumentLease(database, {
    documentId,
    ownerId: ownerA,
    nowMs: 2_001,
  })
  requirePersistenceFailure(
    oldOwnerRelease,
    "lease-lost",
    "The prior owner retained authority after takeover.",
  )
  const lostLeaseCommand = requireDomainResult(
    applyDocumentCommand(
      baseSnapshot,
      documentCommand({
        commandId: lostLeaseCommandId,
        baseRevision: 2,
        issuedAt: "2026-08-08T00:00:03Z",
        kind: "org.vibeshape.document.rename",
        name: "Unauthorized rename",
      }),
    ),
  )
  const oldWriterCommit = await repository.commit({
    sessionId: ownerA,
    lease: { epoch: 1, nowMs: 2_001 },
    storedAt: "2026-08-08T00:00:03Z",
    baseSnapshot,
    event: lostLeaseCommand.event,
    snapshot: lostLeaseCommand.snapshot,
  })
  const oldWriterDiagnostic = requirePersistenceFailure(
    oldWriterCommit,
    "lease-lost",
    "The prior owner committed after lease takeover.",
  )
  return {
    acquired: acquired.status,
    blocked: blockedDiagnostic.code,
    takeover: takeover.status,
    epoch: takeover.lease.epoch,
    oldWriterCommit: oldWriterDiagnostic.code,
  }
}

async function createOrphanFiles(root: FileSystemDirectoryHandle) {
  const directory = await root.getDirectoryHandle("cache", { create: true })
  for (const name of ["orphan.bin", `orphan.${operationId}.tmp`]) {
    const writable = await (await directory.getFileHandle(name, { create: true })).createWritable()
    await writable.write("orphan")
    await writable.close()
  }
}

async function verifyCache(database: VibeShapeDatabase, root: FileSystemDirectoryHandle | null) {
  if (!root) return { status: "unavailable" as const }
  const bytes = Uint8Array.from([1, 2, 3, 4, 5])
  const write = requirePersistenceValue(
    await writeDerivedCache(database, root, {
      bytes,
      engineBuildId: "org.vibeshape.occt",
      operationId,
      lastAccessedAt: createdAt,
    }),
  )
  const hit = requirePersistenceValue(
    await readDerivedCache(database, root, {
      contentHash: write.contentHash,
      engineBuildId: "org.vibeshape.occt",
    }),
  )
  if (hit.status !== "hit" || !bytes.every((byte, index) => hit.bytes[index] === byte)) {
    throw new Error("The verified OPFS cache entry did not round-trip.")
  }
  await createOrphanFiles(root)
  const cleanup = requirePersistenceValue(await cleanupDerivedCacheOrphans(database, root))
  return { status: "verified" as const, write, cleanup }
}

async function verifyQuotaRollback(database: VibeShapeDatabase) {
  const key: [string, number] = [documentId, 2]
  const before = await database.events.get(key)
  requireCondition(before !== undefined, "The quota rollback fixture event is missing.")
  const diagnostic = await simulateQuotaFailure(database, key)
  const after = await database.events.get(key)
  requireCondition(
    [diagnostic === "quota-exceeded", after?.checksum === before?.checksum].every(Boolean),
    "The simulated quota failure did not roll back the transaction.",
  )
  return { diagnostic, rolledBack: true }
}

async function simulateQuotaFailure(database: VibeShapeDatabase, key: [string, number]) {
  try {
    await database.transaction("rw", database.events, async () => {
      await database.events.update(key, { checksum: "1".repeat(64) })
      throw new DOMException("Synthetic quota boundary.", "QuotaExceededError")
    })
  } catch (error) {
    return classifyPersistenceError(error).code
  }
  throw new Error("The synthetic quota transaction unexpectedly committed.")
}

async function resetDatabase() {
  const staleDatabase = new VibeShapeDatabase(databaseName)
  await runStage("reset-indexed-db", () => staleDatabase.delete())
}

async function runDirtySeed() {
  await resetDatabase()
  const database = new VibeShapeDatabase(databaseName)
  const repository = new LocalDocumentRepository(database)
  const history = await runStage("seed-dirty-document", () => createHistory(repository))
  return { schemaVersion: 0, mode: "seed-dirty", revision: history.renamed.snapshot.revision }
}

async function runReopen(mode: "recover-dirty" | "offline-reopen") {
  const database = new VibeShapeDatabase(databaseName)
  const repository = new LocalDocumentRepository(database)
  const recovery = await runStage(mode, async () =>
    requirePersistenceValue(await repository.recover(documentId)),
  )
  database.close()
  return {
    schemaVersion: 0,
    mode,
    status: recovery.status,
    recoveredRevision: recovery.recoveredRevision,
    lostRevisionCount: recovery.lostRevisionCount,
  }
}

async function verifyCleanCloseOwner(repository: LocalDocumentRepository) {
  const result = await repository.closeCleanly({
    documentId,
    revision: 2,
    sessionId: ownerA,
    lease: { epoch: 1, nowMs: 2_500 },
  })
  return requirePersistenceFailure(
    result,
    "lease-lost",
    "A former writer removed the recovery marker.",
  ).code
}

async function runFullSpike() {
  const root = await runStage("reset-opfs", resetOpfs)
  await resetDatabase()
  const database = new VibeShapeDatabase(databaseName)
  const repository = new LocalDocumentRepository(database)
  const history = await runStage("commit-history", () => createHistory(repository))
  const staleDiagnostic = await runStage("stale-transaction", () =>
    verifyStaleCommit(repository, database, history.created.snapshot),
  )
  const quotaFailure = await runStage("quota-rollback", () => verifyQuotaRollback(database))
  const recovery = await runStage("recovery", () =>
    verifyRecovery(repository, database, {
      ...history.renameCommit,
      createEventChecksum: history.createCommit.eventChecksum,
    }),
  )
  const leases = await runStage("writer-leases", () =>
    verifyLeases(database, repository, history.writerLease, history.renamed.snapshot),
  )
  const cache = await runStage("opfs-cache", () => verifyCache(database, root))
  const rejectedCleanClose = await runStage("clean-close-owner-check", () =>
    verifyCleanCloseOwner(repository),
  )
  await runStage("clean-close", async () => {
    requirePersistenceValue(
      await repository.closeCleanly({
        documentId,
        revision: 2,
        sessionId: ownerB,
        lease: { epoch: 2, nowMs: 2_500 },
      }),
    )
  })
  const clean = await runStage("clean-reopen", async () =>
    requirePersistenceValue(await repository.recover(documentId)),
  )
  const capabilities = await runStage("capabilities", () => inspectStorageCapabilities(window))
  database.close()

  return {
    schemaVersion: 0,
    committedRevisions: 2,
    staleDiagnostic,
    quotaFailure,
    transactionRecordCounts: { events: 2, snapshots: 2, projects: 1 },
    recovery: {
      replayedRevision: recovery.replayed.recoveredRevision,
      corruptSnapshotRecords: recovery.replayed.corruptRecords,
      boundedLossRevision: recovery.boundedLoss.recoveredRevision,
      lostRevisionCount: recovery.boundedLoss.lostRevisionCount,
      cleanStatus: clean.status,
      migration: recovery.migration,
    },
    leases,
    rejectedCleanClose,
    cache: {
      status: cache.status,
      byteLength: cache.status === "verified" ? cache.write.byteLength : null,
      orphanFilesRemoved: cache.status === "verified" ? cache.cleanup.removed : [],
    },
    capabilities,
    updateWithDirtyDocument: decideUpdateActivation(1),
    persistentStoragePrompt: {
      afterSavedUserGesture: shouldRequestPersistentStorage({
        hasSavedProject: true,
        userGesture: true,
      }),
      background: shouldRequestPersistentStorage({
        hasSavedProject: true,
        userGesture: false,
      }),
    },
    fallbackSaveMethod: selectSaveAsMethod({}),
  }
}

function requestedMode() {
  const mode = new URL(window.location.href).searchParams.get("mode")
  if (mode === "seed-dirty" || mode === "recover-dirty" || mode === "offline-reopen") {
    return mode
  }
  return "full" as const
}

async function ensureControlledServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are unavailable in this browser.")
  }
  const wasControlled = navigator.serviceWorker.controller !== null
  if (wasControlled) return true
  await navigator.serviceWorker.register("/persistence-spike-sw.js", { scope: "/" })
  await navigator.serviceWorker.ready
  window.location.reload()
  return false
}

async function bootSpike() {
  const controlled = await runStage("service-worker", ensureControlledServiceWorker)
  if (!controlled) return null
  const mode = requestedMode()
  const runners = {
    full: runFullSpike,
    "seed-dirty": runDirtySeed,
    "recover-dirty": () => runReopen("recover-dirty"),
    "offline-reopen": () => runReopen("offline-reopen"),
  }
  return runners[mode]()
}

const statusElement = requireStatusElement()
const state: PersistenceSpikeState = {
  state: "running",
  stage: currentStage,
  report: null,
  error: null,
}
window.__VIBESHAPE_PERSISTENCE_SPIKE__ = state

void bootSpike()
  .then((report) => {
    if (!report) return
    state.stage = "complete"
    state.report = report
    state.state = "passed"
    statusElement.dataset.state = "passed"
    statusElement.textContent = "Local-first persistence corpus completed."
  })
  .catch((error: unknown) => {
    state.state = "failed"
    state.stage = currentStage
    const message = isError(error) ? error.message : String(error)
    state.error = `${currentStage}: ${message}`
    statusElement.dataset.state = "failed"
    statusElement.textContent = state.error
  })
