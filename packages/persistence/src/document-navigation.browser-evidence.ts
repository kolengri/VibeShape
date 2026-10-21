import {
  applyVersionedDocumentCommand,
  canonicalJson,
  commandIdSchema,
  documentIdSchema,
  sessionIdSchema,
} from "@vibeshape/domain"
import { VibeShapeDatabase } from "./database"
import { acquireDocumentLease } from "./lease"
import type { PersistenceResult } from "./repository"
import { VersionedLocalDocumentRepository } from "./versioned-repository"

function value<T>(result: PersistenceResult<T>): T {
  if (!result.ok) throw new Error(`${result.diagnostic.code}: ${result.diagnostic.message}`)
  return result.value
}
function requireEvidence(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const uuid = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const documentId = documentIdSchema.parse(uuid(1))
const sessionId = sessionIdSchema.parse(uuid(2))
const issuedAt = "2026-10-21T00:00:00Z"
const actor = { type: "user", userId: null } as const

/** Real IndexedDB evidence; the browser runner imports this fixture through Vite. */
export async function durableNavigationEvidence(name: string, preserveForRestart = false) {
  let database = new VibeShapeDatabase(name)
  let repository = new VersionedLocalDocumentRepository(database)
  const created = applyVersionedDocumentCommand(null, {
    schemaVersion: 1,
    kind: "org.vibeshape.document.create",
    documentId,
    commandId: uuid(10),
    baseRevision: 0,
    issuedAt,
    actor,
    payload: { name: "Original" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  let head = created.snapshot
  let ordinal = 11
  try {
    value(
      await repository.commit({
        sessionId,
        lease: null,
        storedAt: issuedAt,
        baseSnapshot: null,
        event: created.event,
        snapshot: head,
      }),
    )
    const lease = {
      epoch: value(
        await acquireDocumentLease(database, {
          documentId,
          ownerId: sessionId,
          nowMs: 1000,
          durationMs: 30000,
        }),
      ).lease.epoch,
      nowMs: 1000,
    }
    for (let step = 1; step <= 125; step++) {
      const renamed = applyVersionedDocumentCommand(head, {
        schemaVersion: 1,
        kind: "org.vibeshape.document.rename",
        documentId,
        commandId: uuid(ordinal++),
        baseRevision: head.revision,
        issuedAt,
        actor,
        payload: { name: `Edit ${step}` },
      })
      if (!renamed.ok) throw new Error(renamed.diagnostic.message)
      value(
        await repository.commit({
          sessionId,
          lease,
          storedAt: issuedAt,
          baseSnapshot: head,
          event: renamed.event,
          snapshot: renamed.snapshot,
        }),
      )
      head = renamed.snapshot
    }
    const originalHead = head.revision
    database.close()
    database = new VibeShapeDatabase(name)
    repository = new VersionedLocalDocumentRepository(database)
    const recovered = value(await repository.recoverAuthority(documentId))
    requireEvidence(
      recovered.navigation?.undo.length === 125 && recovered.navigation.redo.length === 0,
      "Reopen lost durable Undo boundaries.",
    )
    // Historical cache loss and checksum damage are repaired from the verified journal.
    await database.snapshotsV1.delete([documentId, 1])
    const second = await database.snapshotsV1.get([documentId, 2])
    requireEvidence(!!second, "Missing second checkpoint.")
    await database.snapshotsV1.put({ ...second, checksum: "0".repeat(64) })
    requireEvidence(
      value(await repository.loadHistoryTarget(documentId, 1)).name === "Original",
      "A missing historical snapshot did not replay.",
    )
    requireEvidence(
      value(await repository.loadHistoryTarget(documentId, 2)).name === "Edit 1",
      "A corrupt historical snapshot did not replay.",
    )
    const target = value(await repository.loadHistoryTarget(documentId, 1))
    requireEvidence(target.schemaVersion === 1, "Unexpected historical schema.")
    const restoredEvent = {
      schemaVersion: 1 as const,
      type: "org.vibeshape.document.restored" as const,
      commandId: commandIdSchema.parse(uuid(ordinal++)),
      transactionId: null,
      documentId,
      baseRevision: head.revision,
      revision: head.revision + 1,
      issuedAt,
      actor,
      direction: "undo" as const,
      targetRevision: 1,
    }
    const restored = { ...target, revision: restoredEvent.revision, updatedAt: issuedAt }
    const input = {
      sessionId,
      lease,
      storedAt: issuedAt,
      baseSnapshot: head,
      event: restoredEvent,
      snapshot: restored,
    }
    const identity = async () =>
      canonicalJson(
        await Promise.all([
          database.projectsV1.get(documentId),
          database.eventsV1.count(),
          database.snapshotsV1.count(),
          database.recoveryV1.get(documentId),
        ]),
      )
    const before = await identity()
    const quota = () => {
      throw new DOMException("Controlled quota failure", "QuotaExceededError")
    }
    database.projectsV1.hook("updating", quota)
    const failed = await repository.commit(input)
    database.projectsV1.hook("updating").unsubscribe(quota)
    requireEvidence(
      !failed.ok && failed.diagnostic.code === "quota-exceeded",
      "Quota failure was not actionable.",
    )
    requireEvidence(
      (await identity()) === before,
      "Quota failure published head, records, or navigation.",
    )
    const staleLease = await repository.commit({
      ...input,
      lease: { ...lease, epoch: lease.epoch + 1 },
    })
    requireEvidence(
      !staleLease.ok && staleLease.diagnostic.code === "lease-lost",
      "Stale writer lease was accepted.",
    )
    requireEvidence((await identity()) === before, "Stale writer changed saved navigation.")
    value(await repository.commit(input))
    const stale = await repository.commit({
      ...input,
      event: { ...restoredEvent, commandId: uuid(ordinal++) },
    })
    requireEvidence(
      !stale.ok && stale.diagnostic.code === "stale-revision",
      "A stale head was accepted.",
    )
    database.close()
    database = new VibeShapeDatabase(name)
    repository = new VersionedLocalDocumentRepository(database)
    const undone = value(await repository.recoverAuthority(documentId))
    requireEvidence(
      undone.snapshot.revision === originalHead + 1 &&
        undone.snapshot.name === "Original" &&
        undone.navigation?.undo.length === 0 &&
        undone.navigation.redo.length === 125,
      "One saved restore did not retain the crossed redo range after restart.",
    )
    if (preserveForRestart) return { preparedForRestart: true, redoSteps: 125 }
    const redoTarget = value(await repository.loadHistoryTarget(documentId, originalHead))
    requireEvidence(redoTarget.schemaVersion === 1, "Unexpected redo target schema.")
    value(
      await repository.commit({
        sessionId,
        lease,
        storedAt: issuedAt,
        baseSnapshot: undone.snapshot,
        event: {
          ...restoredEvent,
          commandId: uuid(ordinal++),
          direction: "redo",
          targetRevision: originalHead,
          baseRevision: undone.snapshot.revision,
          revision: undone.snapshot.revision + 1,
        },
        snapshot: { ...redoTarget, revision: undone.snapshot.revision + 1, updatedAt: issuedAt },
      }),
    )
    const redone = value(await repository.recoverAuthority(documentId))
    requireEvidence(
      redone.navigation?.undo.length === 125 && redone.navigation.redo.length === 0,
      "Multi-step redo did not restore durable boundary order.",
    )
    // The local navigation state is not inferred from portable event transaction IDs.
    const portable = value(await repository.exportPortableProjectV2(documentId))
    const importedDb = new VibeShapeDatabase(`${name}-import`)
    try {
      const imported = new VersionedLocalDocumentRepository(importedDb)
      value(
        await imported.importPortableProjectV2({
          ...portable,
          importedAt: issuedAt,
          exportedAt: issuedAt,
        }),
      )
      requireEvidence(
        value(await imported.recover(documentId)).navigation === undefined,
        "Import fabricated navigation ownership.",
      )
    } finally {
      await importedDb.delete()
    }
    // A legacy project remains readable; its first new edit starts an explicit fresh baseline.
    const record = await database.projectsV1.get(documentId)
    requireEvidence(!!record, "Missing current project.")
    const { navigation: _navigation, ...legacy } = record
    await database.projectsV1.put(legacy)
    requireEvidence(
      value(await repository.recover(documentId)).navigation === undefined,
      "Legacy recovery fabricated navigation boundaries.",
    )
    await database.snapshotsV1.where("documentId").equals(documentId).delete()
    const corrupted = await database.eventsV1.get([documentId, 1])
    requireEvidence(!!corrupted, "Missing creation event.")
    await database.eventsV1.put({ ...corrupted, checksum: "0".repeat(64) })
    requireEvidence(
      !(await repository.loadHistoryTarget(documentId, 1)).ok,
      "Corrupt historical journal was trusted.",
    )
    value(
      await repository.deleteProject({
        documentId,
        expectedHeadRevision: redone.snapshot.revision,
        nowMs: 50000,
      }),
    )
    requireEvidence(
      (await database.projectsV1.get(documentId)) === undefined,
      "Deletion retained navigation metadata.",
    )
    return {
      reopenedSteps: 125,
      quotaRollback: true,
      staleLease: true,
      multiStepRestart: true,
      replayFallback: true,
      corruptHistory: true,
      legacyBaseline: true,
      importedBaseline: true,
    }
  } finally {
    if (preserveForRestart) database.close()
    else await database.delete()
  }
}

export async function verifyDurableNavigationRestart(name: string) {
  const database = new VibeShapeDatabase(name)
  const repository = new VersionedLocalDocumentRepository(database)
  try {
    const recovered = value(await repository.recoverAuthority(documentId))
    requireEvidence(
      recovered.navigation?.undo.length === 0 && recovered.navigation.redo.length === 125,
      "Browser restart did not preserve the saved redo range.",
    )
    const target = value(await repository.loadHistoryTarget(documentId, 126))
    requireEvidence(
      target.schemaVersion === 1 && recovered.snapshot.schemaVersion === 1,
      "Unexpected restart authority.",
    )
    const lease = value(
      await acquireDocumentLease(database, {
        documentId,
        ownerId: sessionId,
        nowMs: 1001,
        durationMs: 30000,
      }),
    ).lease
    value(
      await repository.commit({
        sessionId,
        lease: { epoch: lease.epoch, nowMs: 1001 },
        storedAt: issuedAt,
        baseSnapshot: recovered.snapshot,
        event: {
          schemaVersion: 1,
          type: "org.vibeshape.document.restored",
          transactionId: null,
          commandId: uuid(2000),
          documentId,
          baseRevision: recovered.snapshot.revision,
          revision: recovered.snapshot.revision + 1,
          issuedAt,
          actor,
          direction: "redo",
          targetRevision: target.revision,
        },
        snapshot: { ...target, revision: recovered.snapshot.revision + 1, updatedAt: issuedAt },
      }),
    )
    const redone = value(await repository.recoverAuthority(documentId))
    requireEvidence(
      redone.snapshot.name === "Edit 125" &&
        redone.navigation?.undo.length === 125 &&
        redone.navigation.redo.length === 0,
      "Redo failed after browser process restart.",
    )
    return { browserRestart: true, redoSteps: 125 }
  } finally {
    await database.delete()
  }
}

export async function historicalSourceNavigationEvidence(
  name: string,
  snapshots: readonly import("@vibeshape/domain").DocumentAuthoritySnapshot[],
  events: readonly import("@vibeshape/domain").DocumentAuthorityEvent[],
  blob: import("@vibeshape/domain").SourceAssetBlob,
) {
  const database = new VibeShapeDatabase(name)
  const repository = new VersionedLocalDocumentRepository(database)
  const initial = snapshots[0]
  if (!initial) throw new Error("The historical source fixture must create a document")
  try {
    let before: import("@vibeshape/domain").DocumentAuthoritySnapshot | null = null
    for (const [index, snapshot] of snapshots.entries()) {
      const input = {
        sessionId,
        lease: index === 0 ? null : { epoch: 1, nowMs: 1000 },
        storedAt: issuedAt,
        baseSnapshot: before,
        event: events[index],
        snapshot,
      }
      value(
        await (snapshot.schemaVersion === 1
          ? repository.commit(input)
          : repository.commitAuthority({
              ...input,
              assetBlobs: index === snapshots.length - 1 ? [blob] : [],
            })),
      )
      if (index === 0)
        value(
          await acquireDocumentLease(database, {
            documentId: initial.id,
            ownerId: sessionId,
            nowMs: 1000,
            durationMs: 30000,
          }),
        )
      before = snapshot
    }
    await database.snapshotsV1.where("documentId").equals(initial.id).delete()
    for (const expected of snapshots) {
      const target = value(await repository.loadHistoryTarget(initial.id, expected.revision))
      requireEvidence(
        canonicalJson(target) === canonicalJson(expected),
        "Mixed-version historical replay changed authority.",
      )
    }
    await database.assetBlobs.put({ ...blob, bytes: new Uint8Array(blob.bytes.length) })
    const current = snapshots.at(-1)
    requireEvidence(!!current, "Missing current source authority.")
    const corrupt = await repository.loadHistoryTarget(initial.id, current.revision)
    requireEvidence(
      !corrupt.ok && corrupt.diagnostic.code === "corrupt-history",
      "Historical preview trusted corrupt immutable source bytes.",
    )
    return { migratedTargets: snapshots.length, sourceChecksum: true }
  } finally {
    await database.delete()
  }
}
