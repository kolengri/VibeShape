import { describe, expect, it } from "vitest"
import { applyDocumentCommand, reduceDocumentEvent, replayDocumentEvents } from "./commands"
import { documentSnapshotSchema } from "./document"
import { type FeatureRecord, featureRecordSchema } from "./feature-graph"
import { sketchIdSchema } from "./identifiers"
import { boxFeatureType } from "./part-design"
import { datumPlaneFeatureType } from "./reference-geometry"
import { createEmptySketch } from "./sketch-edit"
import { createLengthQuantity } from "./units"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const featureIds = {
  root: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
  dependent: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
  missing: "0195b5ac-b220-7a2c-8c33-67a36a7f3103",
} as const
const commandIds = [
  "0195b5ac-b214-7a2c-8c33-67a36a7f2101",
  "0195b5ac-b214-7a2c-8c33-67a36a7f2102",
  "0195b5ac-b214-7a2c-8c33-67a36a7f2103",
  "0195b5ac-b214-7a2c-8c33-67a36a7f2104",
  "0195b5ac-b214-7a2c-8c33-67a36a7f2105",
  "0195b5ac-b214-7a2c-8c33-67a36a7f2106",
  "0195b5ac-b214-7a2c-8c33-67a36a7f2107",
] as const
const actor = { type: "user", userId: "org.vibeshape.user.alice" } as const

function feature(
  id: (typeof featureIds)[keyof typeof featureIds],
  dependencies: string[] = [],
  values: Partial<FeatureRecord> = {},
) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: boxFeatureType.type,
    parameters: { length: 10 },
    dependencies,
    references: [],
    suppressed: false,
    ...values,
  })
}

function createDocument() {
  const result = applyDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: commandIds[0],
    documentId,
    baseRevision: 0,
    issuedAt: "2026-08-08T12:00:00Z",
    actor,
    payload: { name: "Enclosure" },
  })

  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

function featureCommand(
  kind:
    | "org.vibeshape.feature.add"
    | "org.vibeshape.feature.update"
    | "org.vibeshape.feature.remove"
    | "org.vibeshape.feature.set-suppressed",
  baseRevision: number,
  payload: Record<string, unknown>,
) {
  return {
    kind,
    schemaVersion: 1,
    commandId: commandIds[baseRevision],
    documentId,
    baseRevision,
    issuedAt: new Date(Date.UTC(2026, 7, 8, 12, baseRevision)).toISOString(),
    actor,
    payload,
  }
}

function applyFeatureCommand(
  snapshot: ReturnType<typeof createDocument>["snapshot"],
  command: ReturnType<typeof featureCommand>,
) {
  const result = applyDocumentCommand(snapshot, command)

  if (!result.ok) throw new Error(`${result.diagnostic.code}: ${result.diagnostic.message}`)
  return result
}

describe("feature document commands", () => {
  it("adds, updates, suppresses, removes, and replays feature state by document revision", () => {
    const created = createDocument()
    const root = feature(featureIds.root)
    const addedRoot = applyFeatureCommand(
      created.snapshot,
      featureCommand("org.vibeshape.feature.add", 1, { feature: root }),
    )
    const dependent = feature(featureIds.dependent, [featureIds.root])
    const addedDependent = applyFeatureCommand(
      addedRoot.snapshot,
      featureCommand("org.vibeshape.feature.add", 2, { feature: dependent }),
    )
    const updatedRoot = feature(featureIds.root, [], {
      parameters: { width: 20, length: 12 },
      label: "Base sketch",
    })
    const updated = applyFeatureCommand(
      addedDependent.snapshot,
      featureCommand("org.vibeshape.feature.update", 3, { feature: updatedRoot }),
    )
    const suppressed = applyFeatureCommand(
      updated.snapshot,
      featureCommand("org.vibeshape.feature.set-suppressed", 4, {
        featureId: featureIds.dependent,
        suppressed: true,
      }),
    )
    const removed = applyFeatureCommand(
      suppressed.snapshot,
      featureCommand("org.vibeshape.feature.remove", 5, {
        featureId: featureIds.dependent,
      }),
    )

    expect(removed.snapshot).toMatchObject({ revision: 6 })
    expect(removed.snapshot.features).toEqual([updatedRoot])
    expect(updated.event).toMatchObject({
      type: "org.vibeshape.feature.updated",
      previousFeature: root,
      feature: updatedRoot,
    })
    expect(suppressed.event).toMatchObject({
      type: "org.vibeshape.feature.suppression-changed",
      previousSuppressed: false,
      suppressed: true,
    })
    expect(removed.event).toMatchObject({
      type: "org.vibeshape.feature.removed",
      feature: { ...dependent, suppressed: true },
    })
    expect(
      replayDocumentEvents([
        created.event,
        addedRoot.event,
        addedDependent.event,
        updated.event,
        suppressed.event,
        removed.event,
      ]),
    ).toEqual({ ok: true, snapshot: removed.snapshot })
  })

  it("rejects duplicate, missing, cyclic, and no-op mutations without partial state", () => {
    const created = createDocument()
    const root = feature(featureIds.root)
    const addedRoot = applyFeatureCommand(
      created.snapshot,
      featureCommand("org.vibeshape.feature.add", 1, { feature: root }),
    )
    const dependent = feature(featureIds.dependent, [featureIds.root])
    const addedDependent = applyFeatureCommand(
      addedRoot.snapshot,
      featureCommand("org.vibeshape.feature.add", 2, { feature: dependent }),
    )
    const before = JSON.stringify(addedDependent.snapshot)

    expect(
      applyDocumentCommand(
        addedDependent.snapshot,
        featureCommand("org.vibeshape.feature.add", 3, { feature: root }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "feature-already-exists" } })
    expect(
      applyDocumentCommand(
        created.snapshot,
        featureCommand("org.vibeshape.feature.add", 1, { feature: dependent }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-graph" } })
    expect(
      applyDocumentCommand(
        addedDependent.snapshot,
        featureCommand("org.vibeshape.feature.remove", 3, {
          featureId: featureIds.root,
        }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "feature-in-use",
        issues: [{ path: "features.1.dependencies" }],
      },
    })
    expect(
      applyDocumentCommand(
        addedDependent.snapshot,
        featureCommand("org.vibeshape.feature.remove", 3, {
          featureId: featureIds.missing,
        }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "feature-not-found" } })
    expect(
      applyDocumentCommand(
        addedDependent.snapshot,
        featureCommand("org.vibeshape.feature.update", 3, {
          feature: feature(featureIds.root, [featureIds.dependent]),
        }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-graph" } })
    expect(
      applyDocumentCommand(
        addedDependent.snapshot,
        featureCommand("org.vibeshape.feature.update", 3, {
          feature: feature(featureIds.missing),
        }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "feature-not-found" } })
    expect(
      applyDocumentCommand(
        addedDependent.snapshot,
        featureCommand("org.vibeshape.feature.update", 3, {
          feature: { ...root, parameters: { length: 10 } },
        }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "command-no-op" } })
    expect(JSON.stringify(addedDependent.snapshot)).toBe(before)
  })

  it("blocks removal of a feature used as a planar sketch support", () => {
    const created = createDocument()
    const root = feature(featureIds.root)
    const addedRoot = applyFeatureCommand(
      created.snapshot,
      featureCommand("org.vibeshape.feature.add", 1, { feature: root }),
    )
    const sketch = createEmptySketch({
      id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3201"),
      label: "Supported sketch",
      plane: "xy",
      support: {
        kind: "feature-face",
        reference: {
          schemaVersion: 0,
          featureId: root.id,
          kind: "face",
          semanticRole: "primitive.box.cap.end",
          signature: {
            kind: "face",
            geometryClass: "PLANE",
            measure: 400,
            centroid: [0, 0, 10],
            bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
            direction: [0, 0, 1],
            directionMode: "oriented",
            boundaryCount: 4,
            adjacentGeometryClasses: ["PLANE"],
          },
        },
      },
    })
    const snapshot = documentSnapshotSchema.parse({ ...addedRoot.snapshot, sketches: [sketch] })

    expect(
      applyDocumentCommand(
        snapshot,
        featureCommand("org.vibeshape.feature.remove", snapshot.revision, {
          featureId: root.id,
        }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "feature-in-use",
        issues: [{ path: "sketches.0.support.reference.featureId" }],
      },
    })
  })

  it("blocks removal of a feature referenced by model geometry in a sketch", () => {
    const created = createDocument()
    const root = feature(featureIds.root)
    const addedRoot = applyFeatureCommand(
      created.snapshot,
      featureCommand("org.vibeshape.feature.add", 1, { feature: root }),
    )
    const sketch = {
      ...createEmptySketch({
        id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3202"),
        label: "Referenced sketch",
        plane: "xy",
      }),
      externalReferences: [
        {
          schemaVersion: 0 as const,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3203",
          kind: "model-point" as const,
          reference: {
            schemaVersion: 0 as const,
            featureId: root.id,
            kind: "vertex" as const,
            signature: {
              kind: "vertex" as const,
              geometryClass: "POINT",
              measure: 0,
              centroid: [0, 0, 0] as const,
              bounds: { min: [0, 0, 0] as const, max: [0, 0, 0] as const },
              boundaryCount: 0,
              adjacentGeometryClasses: [],
            },
          },
          projectedPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3204",
        },
      ],
    }
    const snapshot = documentSnapshotSchema.parse({ ...addedRoot.snapshot, sketches: [sketch] })

    expect(
      applyDocumentCommand(
        snapshot,
        featureCommand("org.vibeshape.feature.remove", snapshot.revision, {
          featureId: root.id,
        }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "feature-in-use",
        issues: [{ path: "sketches.0.externalReferences.0.reference.featureId" }],
      },
    })
  })

  it("blocks feature deletion when an unavailable feature has no semantic-input model", () => {
    const created = createDocument()
    const root = feature(featureIds.root)
    const addedRoot = applyFeatureCommand(
      created.snapshot,
      featureCommand("org.vibeshape.feature.add", 1, { feature: root }),
    )
    const unavailable = featureRecordSchema.parse({
      schemaVersion: 0,
      id: featureIds.dependent,
      type: {
        moduleId: "org.example.unavailable",
        moduleVersion: "1.0.0",
        typeId: "org.example.feature.target-consumer",
        schemaVersion: 1,
      },
      parameters: { targetFeatureId: root.id },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const snapshot = documentSnapshotSchema.parse({
      ...addedRoot.snapshot,
      features: [root, unavailable],
    })

    expect(
      applyDocumentCommand(
        snapshot,
        featureCommand("org.vibeshape.feature.remove", snapshot.revision, {
          featureId: root.id,
        }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "unavailable-dependency-model",
        issues: [{ path: "features.1.type" }],
      },
    })
  })

  it("treats an undeclared Datum Plane support as an incomplete dependency model", () => {
    const created = createDocument()
    const root = feature(featureIds.root)
    const addedRoot = applyFeatureCommand(
      created.snapshot,
      featureCommand("org.vibeshape.feature.add", 1, { feature: root }),
    )
    const invalidDatum = featureRecordSchema.parse({
      schemaVersion: 0,
      id: featureIds.dependent,
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: {
          kind: "feature-face",
          reference: {
            schemaVersion: 0,
            featureId: root.id,
            kind: "face",
            semanticRole: "primitive.box.cap.end",
            signature: {
              kind: "face",
              geometryClass: "PLANE",
              measure: 400,
              centroid: [0, 0, 10],
              bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
              direction: [0, 0, 1],
              directionMode: "oriented",
              boundaryCount: 4,
              adjacentGeometryClasses: ["PLANE"],
            },
          },
        },
        offset: createLengthQuantity(5),
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const addedDatum = applyDocumentCommand(
      addedRoot.snapshot,
      featureCommand("org.vibeshape.feature.add", addedRoot.snapshot.revision, {
        feature: invalidDatum,
      }),
    )
    if (!addedDatum.ok) throw new Error(addedDatum.diagnostic.message)
    const cleanRemoval = applyDocumentCommand(
      addedRoot.snapshot,
      featureCommand("org.vibeshape.feature.remove", addedRoot.snapshot.revision, {
        featureId: root.id,
      }),
    )
    if (!cleanRemoval.ok) throw new Error(cleanRemoval.diagnostic.message)

    expect(
      applyDocumentCommand(
        addedDatum.snapshot,
        featureCommand("org.vibeshape.feature.remove", addedDatum.snapshot.revision, {
          featureId: root.id,
        }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "unavailable-dependency-model",
        issues: [{ path: "features.1.type" }],
      },
    })
    expect(
      reduceDocumentEvent(addedDatum.snapshot, {
        ...cleanRemoval.event,
        commandId: commandIds[4],
        baseRevision: addedDatum.snapshot.revision,
        revision: addedDatum.snapshot.revision + 1,
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-event",
        issues: [{ path: "features.1.type" }],
      },
    })
  })

  it("rejects tampered feature events even when their payloads remain schema-valid", () => {
    const created = createDocument()
    const root = feature(featureIds.root)
    const added = applyFeatureCommand(
      created.snapshot,
      featureCommand("org.vibeshape.feature.add", 1, { feature: root }),
    )
    const updated = applyFeatureCommand(
      added.snapshot,
      featureCommand("org.vibeshape.feature.update", 2, {
        feature: { ...root, parameters: { length: 12 } },
      }),
    )

    if (updated.event.type !== "org.vibeshape.feature.updated") {
      throw new Error("The update fixture must emit a feature update event.")
    }

    expect(
      reduceDocumentEvent(added.snapshot, {
        ...updated.event,
        previousFeature: { ...root, parameters: { length: 11 } },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
    expect(
      reduceDocumentEvent(added.snapshot, {
        ...updated.event,
        feature: feature(featureIds.dependent),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })

    const removed = applyFeatureCommand(
      updated.snapshot,
      featureCommand("org.vibeshape.feature.remove", 3, { featureId: featureIds.root }),
    )
    if (removed.event.type !== "org.vibeshape.feature.removed") {
      throw new Error("The remove fixture must emit a feature removed event.")
    }
    expect(
      reduceDocumentEvent(updated.snapshot, {
        ...removed.event,
        feature: { ...root, parameters: { length: 999 } },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
  })

  it("defaults old in-memory fixtures to an empty graph and rejects invalid snapshots", () => {
    const input = {
      schemaVersion: 0,
      id: documentId,
      revision: 1,
      name: "Enclosure",
      createdAt: "2026-08-08T12:00:00Z",
      updatedAt: "2026-08-08T12:00:00Z",
    }

    expect(documentSnapshotSchema.parse(input).features).toEqual([])
    expect(
      documentSnapshotSchema.safeParse({
        ...input,
        features: [feature(featureIds.dependent, [featureIds.root])],
      }).success,
    ).toBe(false)
  })
})
