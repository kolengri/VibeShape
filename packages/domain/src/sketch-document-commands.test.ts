import { describe, expect, test } from "vitest"
import { applyDocumentCommand, reduceDocumentEvent, replayDocumentEvents } from "./commands"

const documentId = "018f0000-0000-7000-8000-000000000001"
const sketchId = "018f0000-0000-7000-8000-000000000002"
const pointA = "018f0000-0000-7000-8000-000000000003"
const pointB = "018f0000-0000-7000-8000-000000000004"
const lineId = "018f0000-0000-7000-8000-000000000005"
const issuedAt = "2026-08-09T10:00:00.000Z"
const actor = { type: "user", userId: null } as const

function commandId(index: number) {
  return `018f0000-0000-7000-8000-${String(index).padStart(12, "0")}`
}

function sketch(label = "Profile") {
  return {
    schemaVersion: 0,
    id: sketchId,
    label,
    plane: "xy",
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 0, y: 0, construction: false },
      { schemaVersion: 0, id: pointB, type: "point", x: 20, y: 0, construction: false },
      {
        schemaVersion: 0,
        id: lineId,
        type: "line",
        startPointId: pointA,
        endPointId: pointB,
        construction: false,
      },
    ],
    constraints: [],
  } as const
}

function createDocument() {
  return applyDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: commandId(101),
    documentId,
    baseRevision: 0,
    issuedAt,
    actor,
    payload: { name: "Sketch command test" },
  })
}

describe("sketch document commands", () => {
  test("adds, updates, removes, and deterministically replays a sketch", () => {
    const created = createDocument()
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const added = applyDocumentCommand(created.snapshot, {
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      commandId: commandId(102),
      documentId,
      baseRevision: 1,
      issuedAt,
      actor,
      payload: { sketch: sketch() },
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.snapshot.sketches).toEqual([sketch()])

    const updated = applyDocumentCommand(added.snapshot, {
      kind: "org.vibeshape.sketch.update",
      schemaVersion: 1,
      commandId: commandId(103),
      documentId,
      baseRevision: 2,
      issuedAt,
      actor,
      payload: { sketch: sketch("Updated profile") },
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.snapshot.sketches[0]?.label).toBe("Updated profile")

    const removed = applyDocumentCommand(updated.snapshot, {
      kind: "org.vibeshape.sketch.remove",
      schemaVersion: 1,
      commandId: commandId(104),
      documentId,
      baseRevision: 3,
      issuedAt,
      actor,
      payload: { sketchId },
    })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.snapshot.sketches).toEqual([])

    const replayed = replayDocumentEvents([
      created.event,
      added.event,
      updated.event,
      removed.event,
    ])
    expect(replayed).toEqual({ ok: true, snapshot: removed.snapshot })
  })

  test("rejects duplicate, missing, no-op, and tampered mutations", () => {
    const created = createDocument()
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const added = applyDocumentCommand(created.snapshot, {
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      commandId: commandId(110),
      documentId,
      baseRevision: 1,
      issuedAt,
      actor,
      payload: { sketch: sketch() },
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return

    expect(
      applyDocumentCommand(added.snapshot, {
        kind: "org.vibeshape.sketch.add",
        schemaVersion: 1,
        commandId: commandId(111),
        documentId,
        baseRevision: 2,
        issuedAt,
        actor,
        payload: { sketch: sketch() },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "sketch-already-exists" } })
    expect(
      applyDocumentCommand(added.snapshot, {
        kind: "org.vibeshape.sketch.update",
        schemaVersion: 1,
        commandId: commandId(112),
        documentId,
        baseRevision: 2,
        issuedAt,
        actor,
        payload: { sketch: sketch() },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "command-no-op" } })
    expect(
      applyDocumentCommand(created.snapshot, {
        kind: "org.vibeshape.sketch.remove",
        schemaVersion: 1,
        commandId: commandId(113),
        documentId,
        baseRevision: 1,
        issuedAt,
        actor,
        payload: { sketchId },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "sketch-not-found" } })

    const updated = applyDocumentCommand(added.snapshot, {
      kind: "org.vibeshape.sketch.update",
      schemaVersion: 1,
      commandId: commandId(114),
      documentId,
      baseRevision: 2,
      issuedAt,
      actor,
      payload: { sketch: sketch("Updated profile") },
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok || updated.event.type !== "org.vibeshape.sketch.updated") return
    expect(
      reduceDocumentEvent(added.snapshot, {
        ...updated.event,
        previousSketch: sketch("Tampered previous profile"),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
  })
})
