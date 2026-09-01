import {
  applyDocumentCommand,
  applyVersionedDocumentCommand,
  documentIdSchema,
  draftIdSchema,
} from "@vibeshape/domain"
import { readVersionedVShape, writeVShape } from "@vibeshape/formats/vshape"
import { describe, expect, it } from "vitest"
import { copyPortableProjectV2, portableProjectV2FromArchive } from "./versioned-project-file"

const actor = { type: "user", userId: null } as const
const sourceDocumentId = "0195b5ac-b250-7a2c-8c33-000000000101"
const copiedDocumentId = "0195b5ac-b250-7a2c-8c33-000000000102"
const issuedAt = "2026-09-01T12:00:00.000Z"

function createCommand(documentId = sourceDocumentId) {
  return {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: "0195b5ac-b250-7a2c-8c33-000000000103",
    documentId,
    baseRevision: 0,
    issuedAt,
    actor,
    payload: { name: "Source" },
  } as const
}

describe("versioned project file lifecycle", () => {
  it("lifts a replay-proven legacy archive into a complete promoted v2 boundary", async () => {
    const created = applyDocumentCommand(null, createCommand())
    if (!created.ok) throw new Error(created.diagnostic.message)
    const archive = await writeVShape({
      snapshot: created.snapshot,
      events: [created.event],
      exportedAt: issuedAt,
      createdBy: { application: "VibeShape", version: "test", build: null },
      engine: null,
    })
    if (!archive.ok) throw new Error(archive.diagnostic.message)
    const decoded = await readVersionedVShape(archive.value)
    if (!decoded.ok) throw new Error(decoded.diagnostic.message)

    expect(portableProjectV2FromArchive(decoded.value)).toMatchObject({
      ok: true,
      exportedAt: issuedAt,
      project: {
        historyMode: "complete",
        promotionRevision: 1,
        seed: { schemaVersion: 1, revision: 1, history: [] },
        legacyEvents: [{ type: "org.vibeshape.document.created" }],
        versionedEvents: [],
        migrationDiagnostic: null,
        unavailableRecords: [],
      },
    })
  })

  it("copies a native v2 history with fresh document and transaction identities", () => {
    const created = applyVersionedDocumentCommand(null, createCommand())
    if (!created.ok) throw new Error(created.diagnostic.message)
    const sourceTransactionId = draftIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000104")
    const source = {
      snapshot: { ...created.snapshot },
      seed: null,
      legacyEvents: [],
      versionedEvents: [{ ...created.event, transactionId: sourceTransactionId }],
      historyMode: "complete" as const,
      promotionRevision: 0,
      migrationDiagnostic: null,
      unavailableRecords: [],
    }
    const commandIds = [
      "0195b5ac-b250-7a2c-8c33-000000000105",
      "0195b5ac-b250-7a2c-8c33-000000000106",
    ]
    const copiedTransactionId = draftIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000107")

    const copied = copyPortableProjectV2({
      source,
      documentId: documentIdSchema.parse(copiedDocumentId),
      name: "Copy",
      issuedAt: "2026-09-01T12:01:00.000Z",
      nextCommandId: () => commandIds.shift() ?? "missing",
      nextTransactionId: () => copiedTransactionId,
    })

    expect(copied).toMatchObject({
      ok: true,
      project: {
        snapshot: { id: copiedDocumentId, name: "Copy", revision: 2 },
        seed: null,
        historyMode: "complete",
        promotionRevision: 0,
        versionedEvents: [
          {
            documentId: copiedDocumentId,
            commandId: "0195b5ac-b250-7a2c-8c33-000000000105",
            transactionId: copiedTransactionId,
          },
          {
            documentId: copiedDocumentId,
            commandId: "0195b5ac-b250-7a2c-8c33-000000000106",
            type: "org.vibeshape.document.renamed",
          },
        ],
      },
    })
  })
})
