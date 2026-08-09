import { describe, expect, it } from "vitest"
import { applyDocumentCommand, replayDocumentEvents } from "./commands"
import { copyDocumentHistory } from "./document-copy"

const sourceDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f5101"
const copiedDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f5102"
const sourceCommandIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f5111",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5112",
] as const
const copiedCommandIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f5121",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5122",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5123",
] as const

function configurableDocument() {
  const created = applyDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: sourceCommandIds[0],
    documentId: sourceDocumentId,
    baseRevision: 0,
    issuedAt: "2026-08-08T00:00:00Z",
    actor: { type: "user", userId: null },
    payload: { name: "Bracket" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const variableAdded = applyDocumentCommand(created.snapshot, {
    kind: "org.vibeshape.variable.add",
    schemaVersion: 1,
    commandId: sourceCommandIds[1],
    documentId: sourceDocumentId,
    baseRevision: 1,
    issuedAt: "2026-08-08T00:01:00Z",
    actor: { type: "user", userId: null },
    payload: {
      variable: {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f5131",
        name: "width",
        expression: "24 mm",
      },
    },
  })
  if (!variableAdded.ok) throw new Error(variableAdded.diagnostic.message)
  return { snapshot: variableAdded.snapshot, events: [created.event, variableAdded.event] }
}

describe("copyDocumentHistory", () => {
  it("preserves semantic history under new document and command identities", () => {
    const source = configurableDocument()
    const copied = copyDocumentHistory({
      sourceSnapshot: source.snapshot,
      sourceEvents: source.events,
      documentId: copiedDocumentId,
      commandIds: copiedCommandIds,
      name: "Bracket copy",
      issuedAt: "2026-08-08T00:02:00Z",
      actor: { type: "user", userId: null },
    })

    expect(copied).toMatchObject({
      ok: true,
      snapshot: {
        id: copiedDocumentId,
        name: "Bracket copy",
        revision: 3,
        variables: [{ id: source.snapshot.variables[0]?.id, name: "width" }],
      },
    })
    if (!copied.ok) return
    expect(copied.events.map((event) => event.documentId)).toEqual([
      copiedDocumentId,
      copiedDocumentId,
      copiedDocumentId,
    ])
    expect(copied.events.map((event) => event.commandId)).toEqual(copiedCommandIds)
    expect(replayDocumentEvents(copied.events)).toEqual({ ok: true, snapshot: copied.snapshot })
    expect(source.snapshot).toMatchObject({ id: sourceDocumentId, name: "Bracket", revision: 2 })
  })

  it("rejects source command identity reuse", () => {
    const source = configurableDocument()
    expect(
      copyDocumentHistory({
        sourceSnapshot: source.snapshot,
        sourceEvents: source.events,
        documentId: copiedDocumentId,
        commandIds: [...sourceCommandIds, copiedCommandIds[2]],
        name: "Bracket copy",
        issuedAt: "2026-08-08T00:02:00Z",
        actor: { type: "user", userId: null },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
  })
})
