import { describe, expect, it } from "vitest"
import { applyDocumentCommand } from "./commands"
import { copyCompleteVersionedDocumentHistory, copyVersionedDocumentHistory } from "./document-copy"
import { migrateDocumentSnapshot } from "./document-migration"
import { draftIdSchema } from "./identifiers"
import {
  applyVersionedDocumentCommand,
  replayVersionedDocumentEvents,
} from "./versioned-document-commands"

const sourceDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f5101"
const copiedDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f5102"
const sourceCommandIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f5111",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5112",
] as const
const copiedCommandIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f5121",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5122",
] as const
const sourceTransactionId = draftIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f5141")
const copiedTransactionId = draftIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f5142")
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f5143"
const promotedSourceCommandIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f5151",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5152",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5153",
] as const
const promotedCopyCommandIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f5161",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5162",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5163",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5164",
] as const

function anchoredVersionedDocument() {
  const created = applyVersionedDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: sourceCommandIds[0],
    documentId: sourceDocumentId,
    baseRevision: 0,
    issuedAt: "2026-08-08T00:00:00Z",
    actor: { type: "user", userId: null },
    payload: { name: "Versioned bracket" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const inserted = applyVersionedDocumentCommand(
    created.snapshot,
    {
      kind: "org.vibeshape.history.insert-sketch",
      schemaVersion: 1,
      commandId: sourceCommandIds[1],
      documentId: sourceDocumentId,
      baseRevision: created.snapshot.revision,
      issuedAt: "2026-08-08T00:01:00Z",
      actor: { type: "user", userId: null },
      payload: {
        sketch: {
          schemaVersion: 0,
          id: sketchId,
          label: "Mount profile",
          plane: "xy",
          entities: [],
          constraints: [],
        },
        historyAfter: null,
      },
    },
    { transactionId: sourceTransactionId },
  )
  if (!inserted.ok) throw new Error(inserted.diagnostic.message)
  return { seed: created.snapshot, snapshot: inserted.snapshot, event: inserted.event }
}

function copyInput() {
  const source = anchoredVersionedDocument()
  return {
    source,
    input: {
      sourceSeed: source.seed,
      sourceSnapshot: source.snapshot,
      sourceEvents: [source.event],
      documentId: copiedDocumentId,
      commandIds: copiedCommandIds,
      transactionIds: [{ source: sourceTransactionId, target: copiedTransactionId }],
      name: "Versioned bracket copy",
      issuedAt: "2026-08-08T00:02:00Z",
      actor: { type: "user", userId: null },
    },
  }
}

function promotedVersionedDocument() {
  const created = applyDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: promotedSourceCommandIds[0],
    documentId: sourceDocumentId,
    baseRevision: 0,
    issuedAt: "2026-08-08T00:00:00Z",
    actor: { type: "user", userId: null },
    payload: { name: "Legacy bracket" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const legacyRenamed = applyDocumentCommand(created.snapshot, {
    kind: "org.vibeshape.document.rename",
    schemaVersion: 1,
    commandId: promotedSourceCommandIds[1],
    documentId: sourceDocumentId,
    baseRevision: 1,
    issuedAt: "2026-08-08T00:01:00Z",
    actor: { type: "user", userId: null },
    payload: { name: "Promoted bracket" },
  })
  if (!legacyRenamed.ok) throw new Error(legacyRenamed.diagnostic.message)
  const legacyEvents = [created.event, legacyRenamed.event]
  const migrated = migrateDocumentSnapshot(legacyRenamed.snapshot, legacyEvents)
  if (!migrated.ok) throw new Error(migrated.diagnostic.message)
  const renamed = applyVersionedDocumentCommand(migrated.snapshot, {
    kind: "org.vibeshape.document.rename",
    schemaVersion: 1,
    commandId: promotedSourceCommandIds[2],
    documentId: sourceDocumentId,
    baseRevision: migrated.snapshot.revision,
    issuedAt: "2026-08-08T00:02:00Z",
    actor: { type: "user", userId: null },
    payload: { name: "Versioned bracket" },
  })
  if (!renamed.ok) throw new Error(renamed.diagnostic.message)
  return { legacyEvents, seed: migrated.snapshot, event: renamed.event, snapshot: renamed.snapshot }
}

describe("copyVersionedDocumentHistory", () => {
  it("preserves anchored History under fresh root identities", () => {
    const { source, input } = copyInput()
    const copied = copyVersionedDocumentHistory(input)
    expect(copied).toMatchObject({
      ok: true,
      seed: { id: copiedDocumentId, revision: 1 },
      snapshot: {
        id: copiedDocumentId,
        name: "Versioned bracket copy",
        revision: 3,
        history: [{ kind: "sketch", id: sketchId }],
      },
      events: [
        { commandId: copiedCommandIds[0], transactionId: copiedTransactionId },
        { commandId: copiedCommandIds[1], transactionId: null },
      ],
    })
    if (!copied.ok) return
    expect(replayVersionedDocumentEvents(copied.seed, copied.events)).toEqual({
      ok: true,
      snapshot: copied.snapshot,
    })
    expect(source.snapshot).toMatchObject({ id: sourceDocumentId, revision: 2 })
  })

  it("rejects incomplete transaction identity mappings", () => {
    const { input } = copyInput()
    expect(copyVersionedDocumentHistory({ ...input, transactionIds: [] })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-event" },
    })
  })

  it("rejects a source suffix that does not reproduce its snapshot", () => {
    const { input } = copyInput()
    expect(
      copyVersionedDocumentHistory({
        ...input,
        sourceSnapshot: { ...input.sourceSnapshot, name: "Tampered" },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
  })
})

describe("copyCompleteVersionedDocumentHistory", () => {
  it("remaps and replay-proves a promoted legacy prefix and v1 suffix", () => {
    const source = promotedVersionedDocument()
    const copied = copyCompleteVersionedDocumentHistory({
      sourceLegacyEvents: source.legacyEvents,
      sourceSeed: source.seed,
      sourceSnapshot: source.snapshot,
      sourceEvents: [source.event],
      documentId: copiedDocumentId,
      commandIds: promotedCopyCommandIds,
      transactionIds: [],
      name: "Promoted bracket copy",
      issuedAt: "2026-08-08T00:03:00Z",
      actor: { type: "user", userId: null },
    })
    expect(copied).toMatchObject({
      ok: true,
      legacyEvents: [
        { documentId: copiedDocumentId, commandId: promotedCopyCommandIds[0] },
        { documentId: copiedDocumentId, commandId: promotedCopyCommandIds[1] },
      ],
      seed: { id: copiedDocumentId, revision: 2 },
      snapshot: { id: copiedDocumentId, name: "Promoted bracket copy", revision: 4 },
      versionedEvents: [
        { commandId: promotedCopyCommandIds[2], revision: 3 },
        { commandId: promotedCopyCommandIds[3], revision: 4 },
      ],
    })
    if (!copied.ok) return
    expect(replayVersionedDocumentEvents(copied.seed, copied.versionedEvents)).toEqual({
      ok: true,
      snapshot: copied.snapshot,
    })
  })
})
