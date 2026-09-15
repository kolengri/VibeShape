import { describe, expect, test } from "vitest"
import { documentRestoredEventSchema, reduceDocumentRestoredEvent } from "./document-history"
import {
  applyVersionedDocumentCommand,
  replayVersionedDocumentEvents,
} from "./versioned-document-commands"

const actor = { type: "user", userId: null } as const
const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f5162"
const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
function fixture() {
  const envelope = { schemaVersion: 1, documentId, issuedAt: "2026-09-05T00:00:00Z", actor }
  const created = applyVersionedDocumentCommand(null, {
    ...envelope,
    kind: "org.vibeshape.document.create",
    commandId: id(1),
    baseRevision: 0,
    payload: { name: "Original" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const renamed = applyVersionedDocumentCommand(created.snapshot, {
    ...envelope,
    kind: "org.vibeshape.document.rename",
    commandId: id(2),
    baseRevision: 1,
    payload: { name: "Changed" },
  })
  if (!renamed.ok) throw new Error(renamed.diagnostic.message)
  const event = {
    ...envelope,
    type: "org.vibeshape.document.restored",
    direction: "undo",
    commandId: id(3),
    transactionId: null,
    baseRevision: 2,
    revision: 3,
    targetRevision: 1,
    issuedAt: "2026-09-05T00:00:02Z",
  }
  return {
    before: created.snapshot,
    current: renamed.snapshot,
    event,
    prefix: [created.event, renamed.event],
  }
}

describe("document restoration by historical revision", () => {
  test("restores a validated checkpoint at a new revision and replays from the journal", () => {
    const h = fixture()
    const expected = {
      ok: true,
      snapshot: { ...h.before, revision: 3, updatedAt: h.event.issuedAt },
    }
    expect(reduceDocumentRestoredEvent(h.current, h.event, h.before)).toEqual(expected)
    expect(replayVersionedDocumentEvents([...h.prefix, h.event])).toEqual(expected)
    expect(documentRestoredEventSchema.parse(h.event)).not.toHaveProperty("target")
  })
  test("requires the exact same-document historical checkpoint rather than caller content", () => {
    const h = fixture()
    expect(reduceDocumentRestoredEvent(h.current, h.event).ok).toBe(false)
    expect(reduceDocumentRestoredEvent(h.current, h.event, h.current).ok).toBe(false)
    expect(
      reduceDocumentRestoredEvent(h.current, h.event, {
        ...h.before,
        id: h.current.features[0]?.id ?? id(999),
      } as typeof h.before).ok,
    ).toBe(false)
    expect(
      reduceDocumentRestoredEvent(h.current, h.event, { ...h.before, createdAt: h.event.issuedAt })
        .ok,
    ).toBe(false)
    expect(
      reduceDocumentRestoredEvent(h.current, h.event, { ...h.before, name: h.current.name }).ok,
    ).toBe(false)
  })
  test("rejects stale, exhausted, future, and malformed envelopes", () => {
    const h = fixture()
    for (const event of [
      { ...h.event, baseRevision: 1 },
      { ...h.event, revision: 4 },
      { ...h.event, documentId: id(999) },
      { ...h.event, targetRevision: 2 },
      { ...h.event, targetRevision: 0 },
      { ...h.event, extra: true },
    ])
      expect(reduceDocumentRestoredEvent(h.current, event, h.before).ok).toBe(false)
    expect(
      reduceDocumentRestoredEvent(
        { ...h.current, revision: Number.MAX_SAFE_INTEGER },
        { ...h.event, baseRevision: Number.MAX_SAFE_INTEGER, revision: Number.MAX_SAFE_INTEGER },
        h.before,
      ).ok,
    ).toBe(false)
  })
  test("fails closed when a suffix does not include its historical target", () => {
    const h = fixture()
    expect(replayVersionedDocumentEvents(h.current, [h.event]).ok).toBe(false)
    expect(replayVersionedDocumentEvents(h.before, [h.prefix[1], h.event]).ok).toBe(true)
  })
})
