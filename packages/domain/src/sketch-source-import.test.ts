import { expect, it } from "bun:test"
import {
  assemblyAuthoritySchema,
  captureAssemblyDefinition,
  emptyAssemblyAuthority,
} from "./assembly-authority"
import { applyDocumentV2Command } from "./document-v2-commands"
import { copyCompleteDocumentAuthorityHistory } from "./document-v2-copy"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { applyDocumentV3Command } from "./document-v3-commands"
import {
  type DocumentSnapshotV4,
  documentSnapshotV4Schema,
  projectDocumentSnapshotV4ToV2,
} from "./document-v4"
import {
  documentRestoredV4EventSchema,
  documentV4AuthoredEventSchema,
} from "./document-v4-command-schemas"
import { applyDocumentV4Command, reduceDocumentV4Event } from "./document-v4-commands"
import { sketchConstraintIdSchema, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import { extrusionFeatureTypeV5 } from "./part-design"
import { authorPreparedPlanarImport, type PreparedPlanarCurve } from "./planar-import-authoring"
import { sketchRecordSchema } from "./sketch"
import { extendSketchArc } from "./sketch-curve-edit"
import { appendSketchLine, moveSketchPoint, removeSketchEntities } from "./sketch-edit"
import { sketchSourceImportSchema } from "./sketch-source-import"
import { attachSketchSourceImport, detachSketchSourceImport } from "./sketch-source-import-edit"
import { documentSourceAssetClosure } from "./source-asset-closure"
import { sourceAssetSchema } from "./source-assets"
import { createLengthQuantity } from "./units"
import { applyVersionedDocumentCommand } from "./versioned-document-commands"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const actor = { type: "user", userId: null } as const
const issuedAt = "2026-10-03T00:00:00Z"
const asset = sourceAssetSchema.parse({
  id: id(200),
  digest: "a".repeat(64),
  byteLength: 123,
  filename: "Profile.svg",
  format: "svg",
  representation: "sketch-curves",
  normalization: { sourceUnit: "millimeter", scaleToMillimeters: 1, normalizedUnit: "millimeter" },
  outputs: [id(201)],
})
const envelope = (baseRevision: number) => ({
  documentId: id(1),
  commandId: id(1000 + baseRevision),
  baseRevision,
  actor,
  issuedAt,
})
function value<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function imported(curve: PreparedPlanarCurve = { type: "circle", center: [4, 5], radius: 3 }) {
  let next = 20
  const authored = authorPreparedPlanarImport(
    {
      schemaVersion: 0,
      format: "svg",
      units: { coordinateUnit: "mm", sourceUnit: "mm", millimetersPerUnit: 1, policy: "selected" },
      paths: [
        {
          sourceOrdinal: 0,
          inspectionId: "inspection-only",
          label: "Outline",
          layer: "cut",
          closed: curve.type === "circle" || curve.type === "ellipse",
          segments: [
            {
              sourceOrdinal: 0,
              sourceDirection: 1,
              curve,
            },
          ],
        },
      ],
    },
    {
      id: sketchIdSchema.parse(id(10)),
      label: "Imported profile",
      plane: "xy",
      createEntityId: () => sketchEntityIdSchema.parse(id(next++)),
    },
  )
  return { ...authored, sketch: attachSketchSourceImport(authored.sketch, asset, authored.paths) }
}
function base() {
  const created = value(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Planar source" },
    }),
  )
  const v2 = value(
    applyDocumentUpgradeV2Command(created.snapshot, {
      ...envelope(1),
      schemaVersion: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  )
  const texture = value(
    applyDocumentV3Command(v2.snapshot, {
      ...envelope(2),
      schemaVersion: 3,
      kind: "org.vibeshape.document.upgrade-v3",
      payload: { change: null },
    }),
  )
  const v3 = value(
    applyDocumentV4Command(texture.snapshot, {
      ...envelope(3),
      schemaVersion: 4,
      kind: "org.vibeshape.document.upgrade-v4",
      payload: {},
    }),
  )
  const added = value(
    applyDocumentV4Command(v3.snapshot, {
      ...envelope(4),
      schemaVersion: 4,
      kind: "org.vibeshape.document.add-source-assets",
      payload: { assets: [asset] },
    }),
  )
  return {
    snapshot: added.snapshot,
    events: [created.event, v2.event, texture.event, v3.event, added.event],
  }
}
function change(snapshot: DocumentSnapshotV4, kind: string, payload: unknown) {
  const authored = value(
    applyDocumentV2Command(projectDocumentSnapshotV4ToV2(snapshot), {
      ...envelope(snapshot.revision),
      schemaVersion: 2,
      kind: "org.vibeshape.document.model-command",
      payload: {
        command: { ...envelope(snapshot.revision), schemaVersion: 1, kind, payload },
        partAllocations: [],
      },
    }),
  )
  const event = documentV4AuthoredEventSchema.parse({
    ...envelope(snapshot.revision),
    schemaVersion: 4,
    type: "org.vibeshape.document.authored-changed",
    revision: snapshot.revision + 1,
    transactionId: null,
    authoredEvent: authored.event,
  })
  return { event, snapshot: value(reduceDocumentV4Event(snapshot, event)).snapshot }
}

it("captures asset output UUIDs and omits transient parser IDs without changing old sketches", () => {
  const f = imported()
  expect(f.sketch.sourceImport).toMatchObject({
    assetId: asset.id,
    parserPolicyVersion: 1,
    paths: [
      {
        outputId: id(201),
        sourceOrdinal: 0,
        label: "Outline",
        layer: "cut",
        closed: true,
        curves: [{ sourceOrdinal: 0, sourceDirection: 1, curveId: f.paths[0]?.curves[0]?.curveId }],
      },
    ],
  })
  expect(JSON.stringify(f.sketch.sourceImport)).not.toContain("inspection-only")
  const detached = detachSketchSourceImport(f.sketch)
  expect(detached).not.toHaveProperty("sourceImport")
  expect(sketchRecordSchema.parse(detached)).toEqual(detached)
  expect(detached.entities).toEqual(f.sketch.entities)
  expect(() => attachSketchSourceImport(f.sketch, asset, f.paths)).toThrow(/already/)
  expect(() => attachSketchSourceImport(detached, { ...asset, outputs: [] }, f.paths)).toThrow()
})

it("retains stable provenance after coordinate edits and explicitly detaches after topology deletion", () => {
  const f = imported()
  const point = f.paths[0]?.pointIds[0]
  const curve = f.paths[0]?.curves[0]?.curveId
  if (!point || !curve) throw new Error("Missing captured identities.")
  const moved = moveSketchPoint(f.sketch, point, { x: 50, y: -7 })
  expect(moved.sourceImport).toEqual(f.sketch.sourceImport)
  expect(moved.entities.find(({ id }) => id === point)).toMatchObject({ x: 50, y: -7 })
  expect(removeSketchEntities(moved, [curve])).not.toHaveProperty("sourceImport")
  expect(removeSketchEntities(moved, [sketchEntityIdSchema.parse(id(999))]).sourceImport).toEqual(
    f.sketch.sourceImport,
  )
  expect(sketchRecordSchema.safeParse({ ...f.sketch, entities: [] }).success).toBe(false)
})

it("fails closed on altered descriptors, missing assets and forged capture identities", () => {
  const f = imported()
  const snapshot = documentSnapshotV4Schema.parse({
    ...base().snapshot,
    sketches: [f.sketch],
    history: [{ kind: "sketch", id: f.sketch.id }],
  })
  for (const assets of [
    [],
    [{ ...asset, digest: "b".repeat(64) }],
    [{ ...asset, byteLength: 124 }],
    [{ ...asset, format: "dxf" }],
    [{ ...asset, normalization: { ...asset.normalization, scaleToMillimeters: 2 } }],
    [{ ...asset, outputs: [id(202)] }],
  ])
    expect(documentSnapshotV4Schema.safeParse({ ...snapshot, assets }).success).toBe(false)
  const source = f.sketch.sourceImport
  if (!source) throw new Error("Missing source capture.")
  const path = source.paths[0]
  if (!path) throw new Error("Missing path.")
  for (const changed of [
    { parserPolicyVersion: 2 },
    { paths: [{ ...path, sourceOrdinal: 1 }] },
    { paths: [{ ...path, curves: [{ ...path.curves[0], sourceDirection: 0 }] }] },
    { paths: [{ ...path, pointIds: [...path.pointIds, ...path.pointIds] }] },
    { paths: [{ ...path, outputId: path.pointIds[0] }] },
    { paths: [{ ...path, curves: [{ ...path.curves[0], pointIds: [] }] }] },
  ])
    expect(sketchSourceImportSchema.safeParse({ ...source, ...changed }).success).toBe(false)
  expect(
    sketchRecordSchema.safeParse({
      ...f.sketch,
      sourceImport: {
        ...source,
        paths: [{ ...path, curves: [{ ...path.curves[0], curveId: id(999) }] }],
      },
    }).success,
  ).toBe(false)
  expect(() => documentSourceAssetClosure(null, [], { ...snapshot, assets: [] })).toThrow(
    /source descriptor/,
  )
})

it("detaches provenance when conic Extend replaces a captured endpoint", () => {
  const f = imported({
    type: "arc",
    center: [0, 0],
    radius: 5,
    startAngle: 0,
    sweep: Math.PI / 2,
  })
  const arc = f.sketch.entities.find((entity) => entity.type === "arc")
  if (arc?.type !== "arc") throw new Error("Missing imported arc.")
  let next = 100
  const createEntityId = () => sketchEntityIdSchema.parse(id(next++))
  const withBoundary = appendSketchLine(f.sketch, {
    createEntityId,
    start: { kind: "new", point: { x: -3, y: 0 } },
    end: { kind: "new", point: { x: -3, y: 6 } },
  }).sketch
  expect(withBoundary.sourceImport).toEqual(f.sketch.sourceImport)
  const extended = extendSketchArc(withBoundary, {
    arcId: arc.id,
    point: { x: 0, y: 5 },
    createEntityId,
    createConstraintId: () => sketchConstraintIdSchema.parse(id(next++)),
  }).sketch
  expect(extended.entities.some(({ id }) => id === arc.id)).toBe(true)
  expect(extended.entities.some(({ id }) => id === arc.endPointId)).toBe(false)
  expect(extended).not.toHaveProperty("sourceImport")
})

it("requires the immutable descriptor's complete ordered path output list", () => {
  const f = imported()
  const first = f.sketch.sourceImport?.paths[0]
  if (!first) throw new Error("Missing path capture.")
  const second = {
    ...first,
    outputId: id(202),
    sourceOrdinal: 1,
    pointIds: [sketchEntityIdSchema.parse(id(60))],
    curves: [
      {
        sourceOrdinal: 0,
        sourceDirection: -1 as const,
        curveId: sketchEntityIdSchema.parse(id(61)),
        pointIds: [sketchEntityIdSchema.parse(id(60))],
      },
    ],
  }
  const sourceImport = sketchSourceImportSchema.parse({
    ...f.sketch.sourceImport,
    paths: [first, second],
  })
  const sketch = sketchRecordSchema.parse({
    ...f.sketch,
    sourceImport,
    entities: [
      ...f.sketch.entities,
      { schemaVersion: 0, id: id(60), type: "point", x: 40, y: 50 },
      { schemaVersion: 0, id: id(61), type: "circle", centerPointId: id(60), radius: 3 },
    ],
  })
  const snapshot = {
    ...base().snapshot,
    sketches: [sketch],
    history: [{ kind: "sketch", id: sketch.id }],
  }
  expect(
    documentSnapshotV4Schema.safeParse({
      ...snapshot,
      assets: [{ ...asset, outputs: [id(201), id(202)] }],
    }).success,
  ).toBe(true)
  for (const outputs of [[id(202), id(201)], [id(201)], [id(201), id(202), id(203)]])
    expect(
      documentSnapshotV4Schema.safeParse({ ...snapshot, assets: [{ ...asset, outputs }] }).success,
    ).toBe(false)
})

it("preserves edited geometry and source closure through replay, Undo, Redo, removal and complete copy", () => {
  const f = imported()
  const initial = base()
  const inserted = change(initial.snapshot, "org.vibeshape.history.insert-sketch", {
    sketch: f.sketch,
    historyAfter: null,
  })
  const point = f.paths[0]?.pointIds[0]
  if (!point) throw new Error("Missing center.")
  const editedSketch = moveSketchPoint(f.sketch, point, { x: 17, y: 19 })
  const edited = change(inserted.snapshot, "org.vibeshape.sketch.update", {
    sketch: editedSketch,
  })
  const undo = documentRestoredV4EventSchema.parse({
    ...envelope(edited.snapshot.revision),
    schemaVersion: 4,
    type: "org.vibeshape.document.restored",
    revision: edited.snapshot.revision + 1,
    transactionId: null,
    direction: "undo",
    targetRevision: inserted.snapshot.revision,
  })
  const undone = value(reduceDocumentV4Event(edited.snapshot, undo, inserted.snapshot)).snapshot
  expect(undone.sketches[0]).toEqual(f.sketch)
  const redo = documentRestoredV4EventSchema.parse({
    ...envelope(undone.revision),
    schemaVersion: 4,
    type: "org.vibeshape.document.restored",
    revision: undone.revision + 1,
    transactionId: null,
    direction: "redo",
    targetRevision: edited.snapshot.revision,
  })
  const redone = value(reduceDocumentV4Event(undone, redo, edited.snapshot)).snapshot
  expect(redone.sketches[0]).toEqual(editedSketch)
  const events = [...initial.events, inserted.event, edited.event, undo, redo]
  expect(value(replayDocumentAuthorityEvents(null, events)).snapshot).toEqual(redone)
  const copied = value(
    copyCompleteDocumentAuthorityHistory({
      sourceSeed: null,
      sourceLegacyEvents: [],
      sourceSnapshot: redone,
      sourceEvents: events,
      documentId: id(2),
      commandIds: Array.from({ length: events.length + 1 }, (_, index) => id(5000 + index)),
      transactionIds: [],
      name: "Copied planar source",
      issuedAt,
      actor,
    }),
  )
  expect(copied.snapshot.sketches).toEqual([editedSketch])
  expect(copied.snapshot.schemaVersion).toBe(4)
  const removed = change(redone, "org.vibeshape.sketch.remove", { sketchId: f.sketch.id })
  expect(removed.snapshot.sketches).toEqual([])
  expect(documentSourceAssetClosure(null, [...events, removed.event], removed.snapshot)).toEqual([
    asset,
  ])
})

it("captures only imported sketch assets in the selected body's frozen closure", () => {
  const f = imported()
  const curve = f.paths[0]?.curves[0]?.curveId
  if (!curve) throw new Error("Missing circle.")
  const extrusion = {
    schemaVersion: 1,
    id: id(30),
    type: extrusionFeatureTypeV5.type,
    dependencies: [],
    references: [],
    semanticInputs: [{ kind: "sketch", id: f.sketch.id }],
    suppressed: false,
    parameters: {
      profiles: {
        schemaVersion: 0,
        profiles: [
          {
            schemaVersion: 0,
            sketchId: f.sketch.id,
            outerBoundaryEntityIds: [curve],
            holeBoundaryEntityIds: [],
          },
        ],
      },
      distance: createLengthQuantity(10),
      symmetric: false,
      reversed: false,
      secondDistance: null,
      operation: "new",
    },
  }
  const body = { schemaVersion: 0, featureId: extrusion.id, outputRole: "result" }
  const unrelated = sourceAssetSchema.parse({
    ...asset,
    id: id(210),
    digest: "c".repeat(64),
    outputs: [id(211)],
  })
  const source = documentSnapshotV4Schema.parse({
    ...base().snapshot,
    assets: [asset, unrelated],
    features: [extrusion],
    sketches: [f.sketch],
    history: [
      { kind: "sketch", id: f.sketch.id },
      { kind: "feature", id: extrusion.id },
    ],
    parts: [
      {
        schemaVersion: 0,
        id: id(40),
        name: "Imported profile extrusion",
        visible: true,
        origin: "independent",
        consumedBy: null,
        bodyHistory: [body],
      },
    ],
  })
  const captured = captureAssemblyDefinition(source, {
    schemaVersion: 1,
    id: id(50),
    name: "Frozen outline",
    sources: [{ kind: "part", partId: id(40), body, contentHash: "e".repeat(64) }],
    sourceFrame: { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] },
  })
  const pinned = captured.pinnedModels[0]
  if (!pinned) throw new Error("Missing frozen model.")
  expect(pinned.assets).toEqual([asset])
  expect(pinned.snapshot.sketches).toEqual([f.sketch])
  expect(
    assemblyAuthoritySchema.safeParse({
      ...emptyAssemblyAuthority(),
      definitions: [{ ...captured, pinnedModels: [{ ...pinned, assets: [] }] }],
    }).success,
  ).toBe(false)
  expect(
    assemblyAuthoritySchema.safeParse({
      ...emptyAssemblyAuthority(),
      definitions: [{ ...captured, pinnedModels: [{ ...pinned, assets: [asset, unrelated] }] }],
    }).success,
  ).toBe(false)
  const { pinRevision: _revision, pinnedModels: _models, ...definition } = captured
  expect(() => captureAssemblyDefinition({ ...source, assets: [] }, definition)).toThrow(
    /source descriptor/,
  )
})
