import { describe, expect, test } from "vitest"
import { applyDocumentCommand, reduceDocumentEvent, replayDocumentEvents } from "./commands"
import { documentSnapshotSchema } from "./document"
import { featureRecordSchema } from "./feature-graph"
import { boxFeatureType, extrusionFeatureType } from "./part-design"
import { createLengthQuantity } from "./units"

const documentId = "018f0000-0000-7000-8000-000000000001"
const sketchId = "018f0000-0000-7000-8000-000000000002"
const pointA = "018f0000-0000-7000-8000-000000000003"
const pointB = "018f0000-0000-7000-8000-000000000004"
const lineId = "018f0000-0000-7000-8000-000000000005"
const dependentSketchId = "018f0000-0000-7000-8000-000000000006"
const dependentPointId = "018f0000-0000-7000-8000-000000000007"
const externalReferenceId = "018f0000-0000-7000-8000-000000000008"
const projectedPointId = "018f0000-0000-7000-8000-000000000009"
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

function sketchWithOrphanReference(label = "Profile") {
  const featureId = "018f0000-0000-7000-8000-000000000010"
  return {
    ...sketch(label),
    externalReferences: [
      {
        schemaVersion: 1,
        id: externalReferenceId,
        kind: "model-point",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "vertex",
          signature: {
            kind: "vertex",
            geometryClass: "POINT",
            measure: 0,
            centroid: [0, 0, 0],
            bounds: { min: [0, 0, 0], max: [0, 0, 0] },
            boundaryCount: 0,
            adjacentGeometryClasses: [],
          },
        },
        projectedPointId,
        orphanedSource: { kind: "deleted-feature", featureId },
      },
    ],
  } as const
}

function sketchWithRepairedReference(
  featureId: string,
  projectedPoint = projectedPointId,
  label = "Profile",
) {
  return {
    ...sketch(label),
    externalReferences: [
      {
        schemaVersion: 0,
        id: externalReferenceId,
        kind: "model-point",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "vertex",
          signature: {
            kind: "vertex",
            geometryClass: "POINT",
            measure: 0,
            centroid: [0, 0, 0],
            bounds: { min: [0, 0, 0], max: [0, 0, 0] },
            boundaryCount: 0,
            adjacentGeometryClasses: [],
          },
        },
        projectedPointId: projectedPoint,
      },
    ],
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

  test("rejects orphan intent introduced outside atomic feature removal", () => {
    const created = createDocument()
    if (!created.ok) throw new Error(created.diagnostic.message)

    expect(
      applyDocumentCommand(created.snapshot, {
        kind: "org.vibeshape.sketch.add",
        schemaVersion: 1,
        commandId: commandId(115),
        documentId,
        baseRevision: 1,
        issuedAt,
        actor,
        payload: { sketch: sketchWithOrphanReference() },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-sketch" } })
    expect(
      reduceDocumentEvent(created.snapshot, {
        schemaVersion: 1,
        commandId: commandId(116),
        transactionId: null,
        documentId,
        baseRevision: 1,
        revision: 2,
        issuedAt,
        actor,
        type: "org.vibeshape.sketch.added",
        sketch: sketchWithOrphanReference(),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })

    const added = applyDocumentCommand(created.snapshot, {
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      commandId: commandId(117),
      documentId,
      baseRevision: 1,
      issuedAt,
      actor,
      payload: { sketch: sketch() },
    })
    if (!added.ok) throw new Error(added.diagnostic.message)
    expect(
      applyDocumentCommand(added.snapshot, {
        kind: "org.vibeshape.sketch.update",
        schemaVersion: 1,
        commandId: commandId(118),
        documentId,
        baseRevision: 2,
        issuedAt,
        actor,
        payload: { sketch: sketchWithOrphanReference() },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-sketch" } })
    expect(
      reduceDocumentEvent(added.snapshot, {
        schemaVersion: 1,
        commandId: commandId(119),
        transactionId: null,
        documentId,
        baseRevision: 2,
        revision: 3,
        issuedAt,
        actor,
        type: "org.vibeshape.sketch.updated",
        previousSketch: sketch(),
        sketch: sketchWithOrphanReference(),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
  })

  test("allows canonical orphan repair but rejects projected-identity bypasses", () => {
    const created = createDocument()
    if (!created.ok) throw new Error(created.diagnostic.message)
    const targetFeatureId = "018f0000-0000-7000-8000-000000000011"
    const orphaned = documentSnapshotSchema.parse({
      ...created.snapshot,
      revision: 2,
      sketches: [sketchWithOrphanReference()],
      features: [
        featureRecordSchema.parse({
          schemaVersion: 0,
          id: targetFeatureId,
          type: boxFeatureType.type,
          parameters: {
            width: createLengthQuantity(20),
            depth: createLengthQuantity(20),
            height: createLengthQuantity(20),
            centered: false,
          },
          dependencies: [],
          references: [],
          suppressed: false,
        }),
      ],
    })

    expect(
      applyDocumentCommand(orphaned, {
        kind: "org.vibeshape.sketch.update",
        schemaVersion: 1,
        commandId: commandId(1231),
        documentId,
        baseRevision: 2,
        issuedAt,
        actor,
        payload: { sketch: sketchWithOrphanReference("Renamed orphan") },
      }),
    ).toMatchObject({ ok: true })
    expect(
      applyDocumentCommand(orphaned, {
        kind: "org.vibeshape.sketch.update",
        schemaVersion: 1,
        commandId: commandId(1232),
        documentId,
        baseRevision: 2,
        issuedAt,
        actor,
        payload: { sketch: sketchWithRepairedReference(targetFeatureId) },
      }),
    ).toMatchObject({ ok: true })

    const invalidRepair = sketchWithRepairedReference(
      targetFeatureId,
      "018f0000-0000-7000-8000-000000000012",
    )
    expect(
      applyDocumentCommand(orphaned, {
        kind: "org.vibeshape.sketch.update",
        schemaVersion: 1,
        commandId: commandId(1233),
        documentId,
        baseRevision: 2,
        issuedAt,
        actor,
        payload: { sketch: invalidRepair },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-sketch" } })
    expect(
      reduceDocumentEvent(orphaned, {
        schemaVersion: 1,
        commandId: commandId(1234),
        transactionId: null,
        documentId,
        baseRevision: 2,
        revision: 3,
        issuedAt,
        actor,
        type: "org.vibeshape.sketch.updated",
        previousSketch: sketchWithOrphanReference(),
        sketch: invalidRepair,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
  })

  test("blocks removal while a selector-backed extrusion references the sketch", () => {
    const created = createDocument()
    if (!created.ok) throw new Error(created.diagnostic.message)
    const added = applyDocumentCommand(created.snapshot, {
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      commandId: commandId(120),
      documentId,
      baseRevision: 1,
      issuedAt,
      actor,
      payload: { sketch: sketch() },
    })
    if (!added.ok) throw new Error(added.diagnostic.message)
    const removal = applyDocumentCommand(added.snapshot, {
      kind: "org.vibeshape.sketch.remove",
      schemaVersion: 1,
      commandId: commandId(121),
      documentId,
      baseRevision: 2,
      issuedAt,
      actor,
      payload: { sketchId },
    })
    if (!removal.ok) throw new Error(removal.diagnostic.message)
    const referenced = {
      ...added.snapshot,
      features: [
        featureRecordSchema.parse({
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000006",
          type: extrusionFeatureType.type,
          parameters: {
            profile: {
              schemaVersion: 0,
              sketchId,
              outerBoundaryEntityIds: [lineId],
              holeBoundaryEntityIds: [],
            },
            distance: createLengthQuantity(10),
            symmetric: false,
            operation: "new",
          },
          dependencies: [],
          references: [],
          suppressed: false,
        }),
      ],
    }

    expect(
      applyDocumentCommand(referenced, {
        kind: "org.vibeshape.sketch.remove",
        schemaVersion: 1,
        commandId: commandId(122),
        documentId,
        baseRevision: 2,
        issuedAt,
        actor,
        payload: { sketchId },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "sketch-in-use",
        issues: [{ path: "features.0.parameters.profile.sketchId" }],
      },
    })
    expect(reduceDocumentEvent(referenced, removal.event)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-event",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "features.0.parameters.profile.sketchId" }),
        ]),
      },
    })
  })

  test("blocks destructive deletion when an unavailable feature has no semantic-input model", () => {
    const created = createDocument()
    if (!created.ok) throw new Error(created.diagnostic.message)
    const added = applyDocumentCommand(created.snapshot, {
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      commandId: commandId(123),
      documentId,
      baseRevision: 1,
      issuedAt,
      actor,
      payload: { sketch: sketch() },
    })
    if (!added.ok) throw new Error(added.diagnostic.message)
    const removal = applyDocumentCommand(added.snapshot, {
      kind: "org.vibeshape.sketch.remove",
      schemaVersion: 1,
      commandId: commandId(124),
      documentId,
      baseRevision: added.snapshot.revision,
      issuedAt,
      actor,
      payload: { sketchId },
    })
    if (!removal.ok) throw new Error(removal.diagnostic.message)
    const unavailable = featureRecordSchema.parse({
      schemaVersion: 0,
      id: dependentSketchId,
      type: {
        moduleId: "org.example.unavailable",
        moduleVersion: "1.0.0",
        typeId: "org.example.feature.profile-consumer",
        schemaVersion: 1,
      },
      parameters: { profile: { sketchId } },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const snapshot = { ...added.snapshot, features: [unavailable] }

    expect(
      applyDocumentCommand(snapshot, {
        kind: "org.vibeshape.sketch.remove",
        schemaVersion: 1,
        commandId: commandId(125),
        documentId,
        baseRevision: snapshot.revision,
        issuedAt,
        actor,
        payload: { sketchId },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "unavailable-dependency-model",
        issues: [{ path: "features.0.type" }],
      },
    })
    expect(reduceDocumentEvent(snapshot, removal.event)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-event",
        issues: [{ path: "features.0.type" }],
      },
    })
  })

  test("preserves a cross-support external point dependency and blocks source removal", () => {
    const created = createDocument()
    if (!created.ok) throw new Error(created.diagnostic.message)
    const source = applyDocumentCommand(created.snapshot, {
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      commandId: commandId(130),
      documentId,
      baseRevision: 1,
      issuedAt,
      actor,
      payload: { sketch: sketch() },
    })
    if (!source.ok) throw new Error(source.diagnostic.message)
    const dependent = {
      schemaVersion: 0,
      id: dependentSketchId,
      label: "Attached profile",
      plane: "xz",
      entities: [
        {
          schemaVersion: 0,
          id: dependentPointId,
          type: "point",
          x: 0,
          y: 0,
          construction: false,
        },
      ],
      constraints: [
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000010",
          type: "coincident",
          firstPointId: dependentPointId,
          secondPointId: projectedPointId,
        },
      ],
      externalReferences: [
        {
          schemaVersion: 0,
          id: externalReferenceId,
          sourceSketchId: sketchId,
          sourcePointId: pointA,
          projectedPointId,
        },
      ],
    } as const
    const added = applyDocumentCommand(source.snapshot, {
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      commandId: commandId(131),
      documentId,
      baseRevision: 2,
      issuedAt,
      actor,
      payload: { sketch: dependent },
    })
    expect(added).toMatchObject({ ok: true })
    if (!added.ok) return
    expect(added.snapshot.sketches[1]?.externalReferences).toEqual(dependent.externalReferences)
    expect(
      applyDocumentCommand(added.snapshot, {
        kind: "org.vibeshape.sketch.remove",
        schemaVersion: 1,
        commandId: commandId(132),
        documentId,
        baseRevision: 3,
        issuedAt,
        actor,
        payload: { sketchId },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "sketch-in-use" } })
  })
})
