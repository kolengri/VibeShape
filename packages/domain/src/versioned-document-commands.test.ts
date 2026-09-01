import { expect, it } from "vitest"
import { type DocumentSnapshotV1, documentSnapshotV1Schema } from "./document"
import { featureRecordSchema, featureRecordV1Schema } from "./feature-graph"
import { sketchIdSchema } from "./identifiers"
import { boxFeatureType } from "./part-design"
import { sketchRecordSchema } from "./sketch"
import { createEmptySketch } from "./sketch-edit"
import { createLengthQuantity } from "./units"
import {
  applyVersionedDocumentCommand,
  projectDocumentSnapshotV1ToV0,
  reduceVersionedDocumentEvent,
  replayVersionedDocumentEvents,
} from "./versioned-document-commands"

it("projects strict v1 snapshots by History without mutating the source", () => {
  const created = createDocument()
  const withSketch = insertSketch(created.snapshot)
  const withFeature = insertBox(withSketch.snapshot)
  const source = JSON.parse(JSON.stringify(withFeature.snapshot))
  const projected = projectDocumentSnapshotV1ToV0(withFeature.snapshot)
  expect(projected).toMatchObject({ ok: true, snapshot: { schemaVersion: 0 } })
  if (!projected.ok) return
  expect(projected.snapshot.sketches.map(({ id }) => id)).toEqual([uuid(10)])
  expect(projected.snapshot.features.map(({ id }) => id)).toEqual([uuid(20)])
  expect(projected.snapshot.features[0]).not.toHaveProperty("semanticInputs")
  expect(withFeature.snapshot).toEqual(source)
})

it("returns bounded diagnostics for invalid v1 projection input", () => {
  expect(projectDocumentSnapshotV1ToV0({ schemaVersion: 1 })).toMatchObject({
    ok: false,
    diagnostic: { issues: expect.any(Array) },
  })
})

const uuid = (value: number) => `0195b5ac-b250-7a2c-8c33-${value.toString().padStart(12, "0")}`
const documentId = uuid(1)
const actor = { type: "user", userId: "org.vibeshape.user.versioned-test" } as const

function envelope(kind: string, baseRevision: number, value = baseRevision + 100) {
  return {
    kind,
    schemaVersion: 1,
    commandId: uuid(value),
    documentId,
    baseRevision,
    issuedAt: new Date(Date.UTC(2026, 8, 1, 8, baseRevision)).toISOString(),
    actor,
  }
}

function createDocument() {
  const result = applyVersionedDocumentCommand(null, {
    ...envelope("org.vibeshape.document.create", 0),
    payload: { name: "Versioned model" },
  })
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

function emptySketch(value: number, label = `Sketch ${value}`) {
  return createEmptySketch({ id: sketchIdSchema.parse(uuid(value)), label, plane: "xy" })
}

function box(value: number, width = 20) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: uuid(value),
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(width),
      depth: createLengthQuantity(15),
      height: createLengthQuantity(10),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
    label: `Box ${value}`,
  })
}

function insertSketch(snapshot: DocumentSnapshotV1, sketch = emptySketch(10)) {
  const result = applyVersionedDocumentCommand(snapshot, {
    ...envelope("org.vibeshape.history.insert-sketch", snapshot.revision),
    payload: { sketch, historyAfter: snapshot.history.at(-1) ?? null },
  })
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

function insertBox(snapshot: DocumentSnapshotV1, feature = box(20)) {
  const result = applyVersionedDocumentCommand(snapshot, {
    ...envelope("org.vibeshape.history.insert-feature", snapshot.revision),
    payload: { feature, historyAfter: snapshot.history.at(-1) ?? null },
  })
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

function legacyFeature(feature: DocumentSnapshotV1["features"][number]) {
  const { semanticInputs: _semanticInputs, ...record } = feature
  return featureRecordSchema.parse({ ...record, schemaVersion: 0 })
}

it("creates v1 documents and preserves History across metadata and variable commands", () => {
  const created = createDocument()
  const renamed = applyVersionedDocumentCommand(created.snapshot, {
    ...envelope("org.vibeshape.document.rename", 1),
    payload: { name: "Renamed model" },
  })
  expect(renamed).toMatchObject({ ok: true, snapshot: { name: "Renamed model", history: [] } })
  if (!renamed.ok) return

  const units = applyVersionedDocumentCommand(renamed.snapshot, {
    ...envelope("org.vibeshape.document.set-display-units", 2),
    payload: { displayUnits: { length: "in", angle: "rad" } },
  })
  expect(units).toMatchObject({
    ok: true,
    snapshot: { displayUnits: { length: "in", angle: "rad" }, history: [] },
  })
  if (!units.ok) return

  const variable = applyVersionedDocumentCommand(units.snapshot, {
    ...envelope("org.vibeshape.variable.add", 3),
    payload: {
      variable: { schemaVersion: 0, id: uuid(30), name: "width", expression: "20 mm" },
    },
  })
  expect(variable).toMatchObject({
    ok: true,
    snapshot: { variables: [{ name: "width", expression: "20 mm" }], history: [] },
  })
})

it("preserves anchored History across every variable mutation", () => {
  const inserted = insertSketch(createDocument().snapshot, emptySketch(31))
  const history = inserted.snapshot.history
  const variableId = uuid(32)
  const added = applyVersionedDocumentCommand(inserted.snapshot, {
    ...envelope("org.vibeshape.variable.add", inserted.snapshot.revision),
    payload: {
      variable: { schemaVersion: 0, id: variableId, name: "width", expression: "20 mm" },
    },
  })
  expect(added).toMatchObject({ ok: true, snapshot: { history } })
  if (!added.ok) return

  const changed = applyVersionedDocumentCommand(added.snapshot, {
    ...envelope("org.vibeshape.variable.set-expression", added.snapshot.revision),
    payload: { variableId, expression: "25 mm" },
  })
  expect(changed).toMatchObject({ ok: true, snapshot: { history } })
  if (!changed.ok) return

  const renamed = applyVersionedDocumentCommand(changed.snapshot, {
    ...envelope("org.vibeshape.variable.rename", changed.snapshot.revision),
    payload: { variableId, name: "length" },
  })
  expect(renamed).toMatchObject({ ok: true, snapshot: { history } })
  if (!renamed.ok) return

  const replaced = applyVersionedDocumentCommand(renamed.snapshot, {
    ...envelope("org.vibeshape.variable.replace-table", renamed.snapshot.revision),
    payload: {
      variables: [
        { schemaVersion: 0, id: variableId, name: "length", expression: "30 mm" },
        { schemaVersion: 0, id: uuid(33), name: "height", expression: "10 mm" },
      ],
    },
  })
  expect(replaced).toMatchObject({ ok: true, snapshot: { history } })
  if (!replaced.ok) return

  expect(
    applyVersionedDocumentCommand(replaced.snapshot, {
      ...envelope("org.vibeshape.variable.remove", replaced.snapshot.revision),
      payload: { variableId },
    }),
  ).toMatchObject({ ok: true, snapshot: { history } })
})

it("updates and removes an anchored sketch without changing its position", () => {
  const created = createDocument()
  const inserted = insertSketch(created.snapshot)
  const saved = inserted.snapshot.sketches[0]
  if (!saved) throw new Error("Expected an inserted sketch.")
  const updated = applyVersionedDocumentCommand(inserted.snapshot, {
    ...envelope("org.vibeshape.sketch.update", 2),
    payload: { sketch: { ...saved, label: "Updated sketch" } },
  })
  expect(updated).toMatchObject({
    ok: true,
    snapshot: {
      sketches: [{ label: "Updated sketch" }],
      history: [{ kind: "sketch", id: saved.id }],
    },
  })
  if (!updated.ok) return

  expect(
    applyVersionedDocumentCommand(updated.snapshot, {
      ...envelope("org.vibeshape.sketch.remove", 3),
      payload: { sketchId: saved.id },
    }),
  ).toMatchObject({ ok: true, snapshot: { sketches: [], history: [] } })
})

it("updates, suppresses, and removes first-party features with canonical inputs", () => {
  const created = createDocument()
  const inserted = insertBox(created.snapshot)
  const saved = inserted.snapshot.features[0]
  if (!saved) throw new Error("Expected an inserted feature.")
  expect(saved.semanticInputs).toEqual([])

  const updatedRecord = { ...legacyFeature(saved), parameters: box(20, 25).parameters }
  const updated = applyVersionedDocumentCommand(inserted.snapshot, {
    ...envelope("org.vibeshape.feature.update", 2),
    payload: { feature: updatedRecord },
  })
  expect(updated).toMatchObject({
    ok: true,
    snapshot: { features: [{ parameters: updatedRecord.parameters, semanticInputs: [] }] },
  })
  if (!updated.ok) return

  const suppressed = applyVersionedDocumentCommand(updated.snapshot, {
    ...envelope("org.vibeshape.feature.set-suppressed", 3),
    payload: { featureId: saved.id, suppressed: true },
  })
  expect(suppressed).toMatchObject({
    ok: true,
    snapshot: { features: [{ suppressed: true }], history: [{ kind: "feature", id: saved.id }] },
  })
  if (!suppressed.ok) return

  expect(
    applyVersionedDocumentCommand(suppressed.snapshot, {
      ...envelope("org.vibeshape.feature.remove", 4),
      payload: { featureId: saved.id },
    }),
  ).toMatchObject({ ok: true, snapshot: { features: [], history: [] } })
})

it("rejects legacy add commands and events that lack History intent", () => {
  const created = createDocument()
  const legacyAdd = {
    ...envelope("org.vibeshape.sketch.add", 1),
    payload: { sketch: emptySketch(40) },
  }
  expect(applyVersionedDocumentCommand(created.snapshot, legacyAdd)).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-command" },
  })

  expect(
    reduceVersionedDocumentEvent(created.snapshot, {
      schemaVersion: 1,
      type: "org.vibeshape.sketch.added",
      commandId: uuid(140),
      transactionId: null,
      documentId,
      baseRevision: 1,
      revision: 2,
      issuedAt: "2026-09-01T08:01:00.000Z",
      actor,
      sketch: emptySketch(40),
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
})

it("replays a mixed v1 event journal to canonical equality", () => {
  const created = createDocument()
  const sketch = insertSketch(created.snapshot, emptySketch(50))
  const feature = insertBox(sketch.snapshot, box(51))
  const renamed = applyVersionedDocumentCommand(feature.snapshot, {
    ...envelope("org.vibeshape.document.rename", 3),
    payload: { name: "Replay result" },
  })
  expect(renamed).toMatchObject({ ok: true })
  if (!renamed.ok) return

  expect(
    replayVersionedDocumentEvents([created.event, sketch.event, feature.event, renamed.event]),
  ).toEqual({ ok: true, snapshot: renamed.snapshot })
  expect(replayVersionedDocumentEvents(sketch.snapshot, [feature.event, renamed.event])).toEqual({
    ok: true,
    snapshot: renamed.snapshot,
  })
})

it("orders the v0 projection by History rather than sketch storage position", () => {
  const source = sketchRecordSchema.parse({
    ...emptySketch(60, "Source"),
    entities: [
      {
        schemaVersion: 0,
        id: uuid(61),
        type: "point",
        construction: false,
        x: 0,
        y: 0,
      },
    ],
  })
  const sourcePoint = source.entities[0]
  if (!sourcePoint) throw new Error("Expected a source point.")
  const consumer = sketchRecordSchema.parse({
    ...emptySketch(62, "Consumer"),
    externalReferences: [
      {
        schemaVersion: 0,
        id: uuid(63),
        sourceSketchId: source.id,
        sourcePointId: sourcePoint.id,
        projectedPointId: uuid(64),
      },
    ],
  })
  const snapshot = documentSnapshotV1Schema.parse({
    ...createDocument().snapshot,
    sketches: [consumer, source],
    history: [
      { kind: "sketch", id: source.id },
      { kind: "sketch", id: consumer.id },
    ],
  })

  expect(
    applyVersionedDocumentCommand(snapshot, {
      ...envelope("org.vibeshape.document.rename", 1),
      payload: { name: "History ordered" },
    }),
  ).toMatchObject({
    ok: true,
    snapshot: { sketches: [{ id: source.id }, { id: consumer.id }] },
  })
})

it("preserves unknown extension declarations for safe commands and rejects feature updates", () => {
  const extension = featureRecordV1Schema.parse({
    schemaVersion: 1,
    id: uuid(70),
    type: {
      moduleId: "org.example.extension",
      moduleVersion: "1.0.0",
      typeId: "org.example.extension.feature",
      schemaVersion: 1,
    },
    parameters: { opaque: true },
    dependencies: [],
    references: [],
    semanticInputs: null,
    suppressed: false,
  })
  const snapshot = documentSnapshotV1Schema.parse({
    ...createDocument().snapshot,
    features: [extension],
    history: [{ kind: "feature", id: extension.id }],
  })
  const renamed = applyVersionedDocumentCommand(snapshot, {
    ...envelope("org.vibeshape.document.rename", 1),
    payload: { name: "Safe metadata" },
  })
  expect(renamed).toMatchObject({
    ok: true,
    snapshot: { features: [{ semanticInputs: null }] },
  })
  if (!renamed.ok) return

  expect(
    applyVersionedDocumentCommand(renamed.snapshot, {
      ...envelope("org.vibeshape.feature.update", 2),
      payload: {
        feature: {
          ...legacyFeature(extension),
          parameters: { opaque: false },
        },
      },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "invalid-command" } })

  expect(
    applyVersionedDocumentCommand(renamed.snapshot, {
      ...envelope("org.vibeshape.feature.remove", 2),
      payload: { featureId: extension.id },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "unavailable-dependency-model" } })
})

it("uses complete extension declarations for dependency-safe removals", () => {
  const extension = featureRecordV1Schema.parse({
    schemaVersion: 1,
    id: uuid(71),
    type: {
      moduleId: "org.example.extension",
      moduleVersion: "1.0.0",
      typeId: "org.example.extension.feature",
      schemaVersion: 1,
    },
    parameters: { opaque: true },
    dependencies: [],
    references: [],
    semanticInputs: [],
    suppressed: false,
  })
  const snapshot = documentSnapshotV1Schema.parse({
    ...createDocument().snapshot,
    features: [extension],
    history: [{ kind: "feature", id: extension.id }],
  })
  const removed = applyVersionedDocumentCommand(snapshot, {
    ...envelope("org.vibeshape.feature.remove", snapshot.revision),
    payload: { featureId: extension.id },
  })

  expect(removed).toMatchObject({ ok: true, snapshot: { features: [], history: [] } })
  if (!removed.ok) return
  expect(reduceVersionedDocumentEvent(snapshot, removed.event)).toEqual({
    ok: true,
    snapshot: removed.snapshot,
  })
})

it("honors extension semantic inputs when removing a sketch", () => {
  const source = emptySketch(72)
  const extension = featureRecordV1Schema.parse({
    schemaVersion: 1,
    id: uuid(73),
    type: {
      moduleId: "org.example.extension",
      moduleVersion: "1.0.0",
      typeId: "org.example.extension.feature",
      schemaVersion: 1,
    },
    parameters: {},
    dependencies: [],
    references: [],
    semanticInputs: [{ kind: "sketch", id: source.id }],
    suppressed: false,
  })
  const snapshot = documentSnapshotV1Schema.parse({
    ...createDocument().snapshot,
    sketches: [source],
    features: [extension],
    history: [
      { kind: "sketch", id: source.id },
      { kind: "feature", id: extension.id },
    ],
  })

  expect(
    applyVersionedDocumentCommand(snapshot, {
      ...envelope("org.vibeshape.sketch.remove", snapshot.revision),
      payload: { sketchId: source.id },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "sketch-in-use" } })
})

it("removes a feature atomically while preserving orphaned model-reference intent", () => {
  const source = featureRecordV1Schema.parse({
    ...box(80),
    schemaVersion: 1,
    semanticInputs: [],
  })
  const consumer = sketchRecordSchema.parse({
    ...emptySketch(81),
    externalReferences: [
      {
        schemaVersion: 0,
        id: uuid(82),
        kind: "model-point",
        reference: {
          schemaVersion: 0,
          featureId: source.id,
          kind: "vertex",
          semanticRole: "primitive.box.vertex.x-min.y-min.z-min",
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
        projectedPointId: uuid(83),
      },
    ],
  })
  const snapshot = documentSnapshotV1Schema.parse({
    ...createDocument().snapshot,
    sketches: [consumer],
    features: [source],
    history: [
      { kind: "feature", id: source.id },
      { kind: "sketch", id: consumer.id },
    ],
  })
  expect(
    applyVersionedDocumentCommand(snapshot, {
      ...envelope("org.vibeshape.feature.remove", snapshot.revision),
      payload: { featureId: source.id },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "feature-in-use" } })

  const removed = applyVersionedDocumentCommand(snapshot, {
    ...envelope(
      "org.vibeshape.feature.remove-preserving-model-reference-intent",
      snapshot.revision,
    ),
    payload: { featureId: source.id },
  })
  expect(removed).toMatchObject({
    ok: true,
    snapshot: {
      features: [],
      history: [{ kind: "sketch", id: consumer.id }],
      sketches: [
        {
          externalReferences: [
            {
              schemaVersion: 1,
              orphanedSource: { kind: "deleted-feature", featureId: source.id },
            },
          ],
        },
      ],
    },
  })
  if (!removed.ok) return
  expect(reduceVersionedDocumentEvent(snapshot, removed.event)).toEqual({
    ok: true,
    snapshot: removed.snapshot,
  })
})

it("rejects changing a first-party feature into an unknown extension type", () => {
  const inserted = insertBox(createDocument().snapshot, box(75))
  const saved = inserted.snapshot.features[0]
  if (!saved) throw new Error("Expected an inserted feature.")

  expect(
    applyVersionedDocumentCommand(inserted.snapshot, {
      ...envelope("org.vibeshape.feature.update", inserted.snapshot.revision),
      payload: {
        feature: {
          ...legacyFeature(saved),
          type: {
            moduleId: "org.example.extension",
            moduleVersion: "1.0.0",
            typeId: "org.example.extension.feature",
            schemaVersion: 1,
          },
        },
      },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "invalid-command" } })
})

it("returns diagnostics instead of throwing for invalid snapshots and options", () => {
  const created = createDocument()
  const malformed = {
    ...created.snapshot,
    history: [{ kind: "sketch", id: uuid(999) }],
  }
  const command = {
    ...envelope("org.vibeshape.document.rename", 1),
    payload: { name: "Never applied" },
  }
  const invalidCalls = [
    () => applyVersionedDocumentCommand(malformed as never, command),
    () => applyVersionedDocumentCommand(created.snapshot, command, null as never),
  ]

  for (const run of invalidCalls) {
    expect(run).not.toThrow()
    expect(run()).toMatchObject({ ok: false, diagnostic: { code: "invalid-command" } })
  }
})

it("fails closed for tampered and non-contiguous events", () => {
  const created = createDocument()
  expect(reduceVersionedDocumentEvent(null, { ...created.event, unexpected: true })).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-event" },
  })
  expect(reduceVersionedDocumentEvent(null, { ...created.event, revision: 2 })).toMatchObject({
    ok: false,
    diagnostic: { code: "stale-revision" },
  })
})
