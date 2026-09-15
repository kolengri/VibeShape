import { expect, it } from "vitest"
import type { DocumentSnapshotV1 } from "./document"
import { copyVersionedDocumentHistory } from "./document-copy"
import { documentRestoredEventSchema } from "./document-history"
import { boxFeatureType, filletFeatureType } from "./part-design"
import { createLengthQuantity } from "./units"
import {
  applyVersionedDocumentCommand,
  reduceVersionedDocumentEvent,
  replayVersionedDocumentEvents,
  type VersionedDocumentEvent,
} from "./versioned-document-commands"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = { type: "user", userId: null } as const
const issuedAt = "2026-09-05T00:00:00Z"

function model() {
  let snapshot: DocumentSnapshotV1 | null = null
  const events: VersionedDocumentEvent[] = []
  function apply(kind: string, payload: unknown) {
    const result = applyVersionedDocumentCommand(snapshot, {
      kind,
      schemaVersion: 1,
      commandId: id(10 + events.length),
      documentId: id(1),
      baseRevision: snapshot?.revision ?? 0,
      issuedAt,
      actor,
      payload,
    })
    if (!result.ok) throw new Error(result.diagnostic.message)
    snapshot = result.snapshot
    events.push(result.event)
    return result.snapshot
  }
  apply("org.vibeshape.document.create", { name: "Bracket" })
  apply("org.vibeshape.history.insert-sketch", {
    sketch: {
      schemaVersion: 0,
      id: id(2),
      label: "Profile",
      plane: "xy",
      entities: [],
      constraints: [],
    },
    historyAfter: null,
  })
  apply("org.vibeshape.history.insert-feature", {
    feature: {
      schemaVersion: 0,
      id: id(3),
      label: "Box",
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(20),
        depth: createLengthQuantity(15),
        height: createLengthQuantity(10),
        centered: false,
      },
      dependencies: [],
      references: [],
      suppressed: false,
    },
    historyAfter: { kind: "sketch", id: id(2) },
  })
  const before = apply("org.vibeshape.history.insert-feature", {
    feature: {
      schemaVersion: 0,
      id: id(4),
      label: "Fillet",
      type: filletFeatureType.type,
      parameters: { radius: createLengthQuantity(1) },
      dependencies: [id(3)],
      references: [],
      suppressed: false,
    },
    historyAfter: { kind: "feature", id: id(3) },
  })
  const removed = apply("org.vibeshape.feature.remove", { featureId: id(4) })
  const restore = documentRestoredEventSchema.parse({
    type: "org.vibeshape.document.restored",
    schemaVersion: 1,
    direction: "undo",
    commandId: id(30),
    transactionId: null,
    documentId: id(1),
    baseRevision: removed.revision,
    revision: removed.revision + 1,
    issuedAt,
    actor,
    targetRevision: before.revision,
  })
  return { before, removed, restore, events }
}

it("restores a removed dependent feature with its exact History and dependency declarations", () => {
  const h = model()
  const restored = reduceVersionedDocumentEvent(h.removed, h.restore, h.before)
  expect(restored).toEqual({
    ok: true,
    snapshot: { ...h.before, revision: 6, updatedAt: issuedAt },
  })
  expect(replayVersionedDocumentEvents([...h.events, h.restore])).toEqual(restored)
  if (!restored.ok) throw new Error(restored.diagnostic.message)
  expect(restored.snapshot.features[1]).toMatchObject({ dependencies: [id(3)], semanticInputs: [] })
  const rejected = applyVersionedDocumentCommand(restored.snapshot, {
    kind: "org.vibeshape.feature.remove",
    schemaVersion: 1,
    commandId: id(31),
    documentId: id(1),
    baseRevision: 6,
    issuedAt,
    actor,
    payload: { featureId: id(3) },
  })
  expect(rejected.ok).toBe(false)
})

it("rejects a restore with missing dependencies, invalid History or noncanonical semantic inputs", () => {
  const h = model()
  const [box, fillet] = h.before.features
  if (!box || !fillet) throw new Error("Missing fixture features")
  const targets = [
    {
      ...h.before,
      features: [fillet],
      history: h.before.history.filter((item) => item.id !== box.id),
    },
    { ...h.before, history: [...h.before.history].reverse() },
    { ...h.before, features: [box, { ...fillet, semanticInputs: null }] },
  ]
  for (const target of targets)
    expect(reduceVersionedDocumentEvent(h.removed, h.restore, target).ok).toBe(false)
})

it("copies a complete restore journal while retaining valid historical revision references", () => {
  const h = model()
  const restored = reduceVersionedDocumentEvent(h.removed, h.restore, h.before)
  if (!restored.ok) throw new Error(restored.diagnostic.message)
  const sourceEvents = [...h.events, h.restore]
  const copied = copyVersionedDocumentHistory({
    sourceSeed: null,
    sourceSnapshot: restored.snapshot,
    sourceEvents,
    documentId: id(100),
    commandIds: Array.from({ length: sourceEvents.length + 1 }, (_, index) => id(101 + index)),
    transactionIds: [],
    name: "Bracket copy",
    issuedAt,
    actor,
  })
  expect(copied.ok).toBe(true)
  if (!copied.ok) throw new Error(copied.diagnostic.message)
  const event = copied.events.find((event) => event.type === "org.vibeshape.document.restored")
  expect(event).toMatchObject({
    documentId: id(100),
    targetRevision: h.before.revision,
  })
  expect(replayVersionedDocumentEvents(copied.events)).toEqual({
    ok: true,
    snapshot: copied.snapshot,
  })
  expect(h.before.id).toBe(id(1))
})
