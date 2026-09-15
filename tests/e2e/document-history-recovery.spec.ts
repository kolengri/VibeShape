import { expect, test } from "./fixtures"

for (const damage of ["missing-target", "corrupt-target", "all-snapshots-missing"] as const) {
  test(`recovers historical undo targets with ${damage} without trusting caller state`, async ({
    page,
  }) => {
    await page.goto("/")
    const result = await page.evaluate(
      async ({ damage, domainPath, persistencePath }) => {
        function success<
          Result extends { ok: true } | { ok: false; diagnostic: { message: string } },
        >(result: Result): asserts result is Extract<Result, { ok: true }> {
          if (!result.ok) throw new Error(result.diagnostic.message)
        }
        const domain = (await import(
          domainPath
        )) as typeof import("../../packages/domain/src/index")
        const persistence = (await import(
          persistencePath
        )) as typeof import("../../packages/persistence/src/versioned-repository") &
          typeof import("../../packages/persistence/src/database") &
          typeof import("../../packages/persistence/src/lease")
        const db = new persistence.VibeShapeDatabase(
          `vibeshape-history-test-${crypto.randomUUID()}`,
        )
        const repository = new persistence.VersionedLocalDocumentRepository(db)
        const uuid = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
        const documentId = domain.documentIdSchema.parse(uuid(1))
        const sessionId = domain.sessionIdSchema.parse(uuid(2))
        const issuedAt = "2026-09-05T00:00:00Z"
        const actor = { type: "user", userId: null } as const
        const envelope = { schemaVersion: 1, documentId, issuedAt, actor }
        try {
          const created = domain.applyVersionedDocumentCommand(null, {
            ...envelope,
            commandId: uuid(10),
            kind: "org.vibeshape.document.create",
            baseRevision: 0,
            payload: { name: "Original" },
          })
          success(created)
          const saved = await repository.commit({
            sessionId,
            lease: null,
            storedAt: issuedAt,
            baseSnapshot: null,
            event: created.event,
            snapshot: created.snapshot,
          })
          success(saved)
          const acquired = await persistence.acquireDocumentLease(db, {
            documentId,
            ownerId: sessionId,
            nowMs: 1000,
            durationMs: 30000,
          })
          success(acquired)
          const lease = { epoch: acquired.value.lease.epoch, nowMs: 1000 }
          const a = domain.applyVersionedDocumentCommand(created.snapshot, {
            ...envelope,
            commandId: uuid(11),
            kind: "org.vibeshape.document.rename",
            baseRevision: 1,
            payload: { name: "A" },
          })
          success(a)
          const savedA = await repository.commit({
            sessionId,
            lease,
            storedAt: issuedAt,
            baseSnapshot: created.snapshot,
            event: a.event,
            snapshot: a.snapshot,
          })
          success(savedA)
          const b = domain.applyVersionedDocumentCommand(a.snapshot, {
            ...envelope,
            commandId: uuid(12),
            kind: "org.vibeshape.document.rename",
            baseRevision: 2,
            payload: { name: "B" },
          })
          success(b)
          const savedB = await repository.commit({
            sessionId,
            lease,
            storedAt: issuedAt,
            baseSnapshot: a.snapshot,
            event: b.event,
            snapshot: b.snapshot,
          })
          success(savedB)
          if (damage === "all-snapshots-missing") await db.snapshotsV1.clear()
          else if (damage === "missing-target") await db.snapshotsV1.delete([documentId, 2])
          else await db.snapshotsV1.update([documentId, 2], { checksum: "f".repeat(64) })
          const event = domain.documentRestoredEventSchema.parse({
            ...envelope,
            commandId: uuid(13),
            type: "org.vibeshape.document.restored",
            direction: "undo",
            transactionId: null,
            baseRevision: 3,
            revision: 4,
            targetRevision: 2,
          })
          const forged = domain.reduceVersionedDocumentEvent(b.snapshot, event, {
            ...a.snapshot,
            name: "Forged",
          })
          success(forged)
          const rejected = await repository.commit({
            sessionId,
            lease,
            storedAt: issuedAt,
            baseSnapshot: b.snapshot,
            event,
            snapshot: forged.snapshot,
          })
          const restored = domain.reduceVersionedDocumentEvent(b.snapshot, event, a.snapshot)
          success(restored)
          const committed = await repository.commit({
            sessionId,
            lease,
            storedAt: issuedAt,
            baseSnapshot: b.snapshot,
            event,
            snapshot: restored.snapshot,
          })
          success(committed)
          const portable = await repository.exportPortableProjectV2(documentId)
          success(portable)
          await db.snapshotsV1.delete([documentId, 4])
          const recovered = await repository.recover(documentId)
          success(recovered)
          let importedSnapshot = portable.value.snapshot
          const events = [...portable.value.versionedEvents]
          for (let index = 0; index < 40; index++) {
            const target = index % 2 === 0 ? b.snapshot : a.snapshot
            const navigation = domain.documentRestoredEventSchema.parse({
              ...envelope,
              commandId: uuid(100 + index),
              type: "org.vibeshape.document.restored",
              direction: index % 2 === 0 ? "redo" : "undo",
              transactionId: null,
              baseRevision: importedSnapshot.revision,
              revision: importedSnapshot.revision + 1,
              targetRevision: target.revision,
            })
            const next = domain.reduceVersionedDocumentEvent(importedSnapshot, navigation, target)
            success(next)
            importedSnapshot = next.snapshot
            events.push(navigation)
          }
          const importedDb = new persistence.VibeShapeDatabase(
            `vibeshape-history-import-test-${crypto.randomUUID()}`,
          )
          try {
            const importedRepository = new persistence.VersionedLocalDocumentRepository(importedDb)
            const imported = await importedRepository.importPortableProjectV2({
              ...portable.value,
              snapshot: importedSnapshot,
              versionedEvents: events,
              importedAt: issuedAt,
              exportedAt: issuedAt,
            })
            success(imported)
            await importedDb.snapshotsV1.clear()
            let journalReads = 0
            importedDb.eventsV1.hook("reading", (record) => {
              journalReads += 1
              return record
            })
            const importedRecovery = await importedRepository.recover(documentId)
            success(importedRecovery)
            return {
              forgedAccepted: rejected.ok,
              name: recovered.value.snapshot.name,
              revision: recovered.value.snapshot.revision,
              lost: recovered.value.lostRevisionCount,
              importedName: importedRecovery.value.snapshot.name,
              importedRevision: importedRecovery.value.snapshot.revision,
              importedLost: importedRecovery.value.lostRevisionCount,
              journalReads,
            }
          } finally {
            await importedDb.delete()
          }
        } finally {
          await db.delete()
        }
      },
      {
        damage,
        domainPath: `/@fs${process.cwd()}/packages/domain/src/index.ts`,
        persistencePath: `/@fs${process.cwd()}/packages/persistence/src/index.ts`,
      },
    )
    expect(result).toEqual({
      forgedAccepted: false,
      name: "A",
      revision: 4,
      lost: 0,
      importedName: "A",
      importedRevision: 44,
      importedLost: 0,
      journalReads: 44,
    })
  })
}
