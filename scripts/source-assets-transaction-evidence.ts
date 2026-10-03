import { createAuthorityPersistenceAdapter } from "../packages/application/src/authority-persistence-adapter"
import { runtimeProjection } from "../packages/application/src/authority-persistence-operations"
import {
  commandIdSchema,
  documentIdSchema,
  sessionIdSchema,
} from "../packages/domain/src/identifiers"
import { VibeShapeDatabase } from "../packages/persistence/src/database"
import { acquireDocumentLease } from "../packages/persistence/src/lease"
import { readSourceAssetBytes } from "../packages/persistence/src/source-asset-store"
import { VersionedLocalDocumentRepository } from "../packages/persistence/src/versioned-repository"
import {
  authorityEnvelope,
  authorityId,
  authorityTimestamp,
  evidenceValue,
} from "./authority-persistence-fixture"
import { sourceAssetsFixture } from "./source-assets-fixture"

function requireEvidence(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function sourceAssetsTransactionEvidence(name: string) {
  const f = await sourceAssetsFixture()
  const database = new VibeShapeDatabase(name)
  const repository = new VersionedLocalDocumentRepository(database)
  const common = {
    sessionId: sessionIdSchema.parse(authorityId(900)),
    lease: { epoch: 1, nowMs: 1 },
    storedAt: authorityTimestamp,
  }
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
        documentId: authorityId(1),
        ownerId: common.sessionId,
        nowMs: 0,
        durationMs: 60000,
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
    const adapter = createAuthorityPersistenceAdapter(
      repository,
      () => {
        throw new Error("Unexpected part allocation")
      },
      f.authored.upgraded.snapshot,
    )
    const current = () => adapter.currentAuthoritySnapshot
    const runtime = () => {
      const authority = current()
      if (!authority) throw new Error("Missing transaction authority")
      return evidenceValue(runtimeProjection(authority)).snapshot
    }
    const input = {
      ...common,
      baseSnapshot: runtime(),
      command: {
        transactionId: authorityId(800),
        assetBlobs: [f.blob],
        commands: [
          {
            ...authorityEnvelope(3),
            schemaVersion: 3,
            kind: "org.vibeshape.document.upgrade-v3",
            payload: { change: null },
          },
          {
            ...authorityEnvelope(4),
            schemaVersion: 4,
            kind: "org.vibeshape.document.upgrade-v4",
            payload: {},
          },
          {
            ...authorityEnvelope(5),
            schemaVersion: 4,
            kind: "org.vibeshape.document.add-source-assets",
            payload: { assets: [f.asset] },
          },
          {
            ...authorityEnvelope(6),
            schemaVersion: 1,
            kind: "org.vibeshape.document.rename",
            payload: { name: "Atomic import" },
          },
        ],
      },
    }
    // An invalid byte digest must roll back the entire upgrade, descriptor and model change.
    const failed = await adapter.authoredTransaction.apply({
      ...input,
      command: {
        ...input.command,
        assetBlobs: [{ ...f.blob, bytes: new Uint8Array(f.blob.bytes.length) }],
      },
    })
    requireEvidence(
      !failed.ok &&
        adapter.currentAuthoritySnapshot === f.authored.upgraded.snapshot &&
        (await database.assetBlobs.count()) === 0 &&
        (await database.eventsV1.count()) === 3,
      "Failed authored publication left partial authority.",
    )
    evidenceValue(await adapter.authoredTransaction.apply(input))
    requireEvidence(
      (await database.eventsV1.count()) === 7 && (await database.assetBlobs.count()) === 1,
      "Authored publication did not commit its full closure.",
    )
    const navigate = async (direction: "undo" | "redo", ordinal: number) =>
      evidenceValue(
        await adapter.history.navigate({
          ...common,
          baseSnapshot: runtime(),
          request: {
            ...authorityEnvelope(runtime().revision),
            commandId: commandIdSchema.parse(authorityId(ordinal)),
            documentId: documentIdSchema.parse(authorityId(1)),
            actor: { type: "user", userId: null },
            direction,
          },
        }),
      )
    await navigate("undo", 810)
    const undone = current()
    requireEvidence(
      undone?.schemaVersion === 4 &&
        undone.assets.length === 0 &&
        runtime().name === f.authored.upgraded.snapshot.name,
      "Transaction Undo did not restore the whole V4 checkpoint.",
    )
    await navigate("redo", 811)
    const recovered = evidenceValue(await repository.recoverAuthority(authorityId(1))).value
      .snapshot
    requireEvidence(
      recovered.schemaVersion === 4 &&
        recovered.assets.length === 1 &&
        recovered.name === "Atomic import" &&
        recovered.revision === 9,
      "Transaction Redo did not recover its whole source authority.",
    )
    requireEvidence(
      evidenceValue(await readSourceAssetBytes(database, f.blob.digest)).value.length ===
        f.blob.bytes.length,
      "Transaction history lost immutable source bytes.",
    )
    return true
  } finally {
    await database.delete()
  }
}
