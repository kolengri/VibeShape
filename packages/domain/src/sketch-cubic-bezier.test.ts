import { describe, expect, it } from "bun:test"
import { documentSnapshotV1Schema } from "./document"
import { reduceDocumentRestoredEvent } from "./document-history"
import { sketchConstraintIdSchema, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import { sketchCubicBezierEntitySchema, sketchRecordSchema } from "./sketch"
import { splitSketchCurve } from "./sketch-curve-edit"
import {
  appendSketchCubicBezier,
  createEmptySketch,
  moveSketchPoint,
  removeSketchEntities,
  sketchCurvePointIds,
} from "./sketch-edit"
import { patternSketchEntities } from "./sketch-pattern-edit"
import { mirrorSketchEntities, transformSketchEntities } from "./sketch-transform-edit"
import {
  applyVersionedDocumentCommand,
  replayVersionedDocumentEvents,
} from "./versioned-document-commands"

const id = (value: number) => `01900000-0000-7000-8000-${value.toString(16).padStart(12, "0")}`
function fixture() {
  let next = 1
  const original = createEmptySketch({
    id: sketchIdSchema.parse(id(50)),
    label: "Editable cubic",
    plane: "xy",
  })
  const appended = appendSketchCubicBezier(original, {
    start: { kind: "new", point: { x: 0, y: 0 } },
    control1: { kind: "new", point: { x: 0, y: 4 } },
    control2: { kind: "new", point: { x: 4, y: 4 } },
    end: { kind: "new", point: { x: 4, y: 0 } },
    createEntityId: () => sketchEntityIdSchema.parse(id(next++)),
  })
  const curve = appended.sketch.entities.find((entity) => entity.type === "cubic-bezier")
  if (curve?.type !== "cubic-bezier") throw new Error("The fixture must contain a cubic.")
  return { original, sketch: appended.sketch, curve, appended }
}
describe("editable authored cubic Bezier", () => {
  it("captures one stable curve and four separately authored point identities", () => {
    const f = fixture()
    expect(f.appended.createdEntityIds).toHaveLength(5)
    expect(new Set(sketchCurvePointIds(f.curve)).size).toBe(4)
    expect(f.original.entities).toEqual([])
    expect(sketchRecordSchema.parse(JSON.parse(JSON.stringify(f.sketch)))).toEqual(f.sketch)
  })
  it("rejects repeated point roles, missing references and nonfinite controls", () => {
    const f = fixture()
    expect(
      sketchCubicBezierEntitySchema.safeParse({ ...f.curve, control1PointId: f.curve.startPointId })
        .success,
    ).toBe(false)
    expect(
      sketchRecordSchema.safeParse({
        ...f.sketch,
        entities: f.sketch.entities.filter(
          ({ id: entityId }) => entityId !== f.curve.control2PointId,
        ),
      }).success,
    ).toBe(false)
    expect(
      sketchRecordSchema.safeParse({
        ...f.sketch,
        entities: f.sketch.entities.map((entity) =>
          entity.id === f.curve.control1PointId ? { ...entity, x: NaN } : entity,
        ),
      }).success,
    ).toBe(false)
    expect(
      sketchCubicBezierEntitySchema.safeParse({ ...f.curve, weights: [1, 1, 1, 1] }).success,
    ).toBe(false)
  })
  it("moves a control and rigidly transforms all four roles while preserving IDs", () => {
    const f = fixture()
    const moved = moveSketchPoint(f.sketch, f.curve.control1PointId, { x: 0, y: 6 })
    expect(
      moved.entities.find(({ id: entityId }) => entityId === f.curve.control1PointId),
    ).toMatchObject({ x: 0, y: 6 })
    expect(moved.entities.find(({ id: entityId }) => entityId === f.curve.id)).toEqual(f.curve)
    const transformed = transformSketchEntities(f.sketch, {
      entityIds: [f.curve.id],
      transform: {
        origin: { x: 0, y: 0 },
        rotationRadians: Math.PI / 2,
        translation: { x: 10, y: 0 },
      },
    })
    const transformedControl = transformed.entities.find(
      ({ id: entityId }) => entityId === f.curve.control1PointId,
    )
    if (transformedControl?.type !== "point")
      throw new Error("A transformed cubic must retain its control point.")
    expect(transformedControl.x).toBeCloseTo(6, 12)
    expect(transformedControl.y).toBeCloseTo(0, 12)
    expect(transformed.entities.find(({ id: entityId }) => entityId === f.curve.id)).toEqual(
      f.curve,
    )
  })
  it("copies every control-point role independently in sketch patterns", () => {
    const f = fixture()
    let next = 100
    const result = patternSketchEntities(f.sketch, {
      entityIds: [f.curve.id],
      transforms: [{ rotationRadians: 0, translation: { x: 10, y: 0 } }],
      createEntityId: () => sketchEntityIdSchema.parse(id(next++)),
      createConstraintId: () => {
        throw new Error("The unconstrained source has no copied constraints.")
      },
    })
    const copy = result.sketch.entities.find(
      (entity) => entity.type === "cubic-bezier" && entity.id !== f.curve.id,
    )
    if (copy?.type !== "cubic-bezier")
      throw new Error("A pattern must create an independent cubic.")
    expect(
      sketchCurvePointIds(copy).every((pointId) => !sketchCurvePointIds(f.curve).includes(pointId)),
    ).toBe(true)
    expect(
      result.sketch.entities.find(({ id: pointId }) => pointId === copy.control2PointId),
    ).toMatchObject({ x: 14, y: 4 })
    expect(f.sketch.entities).toHaveLength(5)
  })
  it("mirrors the cubic and four controls without unsupported curve-equality constraints", () => {
    const f = fixture()
    let next = 100
    const source = sketchRecordSchema.parse({
      ...f.sketch,
      entities: [
        ...f.sketch.entities,
        { schemaVersion: 0, id: id(20), type: "point", construction: true, x: -1, y: -1 },
        { schemaVersion: 0, id: id(21), type: "point", construction: true, x: -1, y: 1 },
        {
          schemaVersion: 0,
          id: id(22),
          type: "line",
          construction: true,
          startPointId: id(20),
          endPointId: id(21),
        },
      ],
    })
    const result = mirrorSketchEntities(source, {
      axisLineId: sketchEntityIdSchema.parse(id(22)),
      entityIds: [f.curve.id],
      createEntityId: () => sketchEntityIdSchema.parse(id(next++)),
      createConstraintId: () => sketchConstraintIdSchema.parse(id(next++)),
    })
    const copy = result.sketch.entities.find(
      (entity) => entity.type === "cubic-bezier" && entity.id !== f.curve.id,
    )
    if (copy?.type !== "cubic-bezier") throw new Error("A mirror must create an independent cubic.")
    expect(
      result.sketch.entities.find(({ id: pointId }) => pointId === copy.control2PointId),
    ).toMatchObject({ x: -6, y: 4 })
    expect(result.sketch.constraints.some(({ type }) => type === "equal")).toBe(false)
    expect(sketchRecordSchema.safeParse(result.sketch).success).toBe(true)
  })
  it("removes a cubic when any referenced control point is removed", () => {
    const f = fixture()
    const removed = removeSketchEntities(f.sketch, [f.curve.control1PointId])
    expect(removed.entities.some(({ id: entityId }) => entityId === f.curve.id)).toBe(false)
  })
  it("rejects tangent and offset constraints that would reinterpret a cubic", () => {
    const f = fixture()
    expect(
      sketchRecordSchema.safeParse({
        ...f.sketch,
        constraints: [
          { schemaVersion: 0, id: id(100), type: "tangent", arcId: f.curve.id, lineId: f.curve.id },
        ],
      }).success,
    ).toBe(false)
    expect(
      sketchRecordSchema.safeParse({
        ...f.sketch,
        constraints: [
          {
            schemaVersion: 0,
            id: id(100),
            type: "point-on-curve",
            pointId: f.curve.control1PointId,
            curveId: f.curve.id,
          },
        ],
      }).success,
    ).toBe(false)
    expect(() =>
      splitSketchCurve(f.sketch, {
        curveId: f.curve.id,
        point: { x: 2, y: 3 },
        createConstraintId: () => {
          throw new Error("No allocation")
        },
        createEntityId: () => {
          throw new Error("No allocation")
        },
      }),
    ).toThrow(/unsupported/)
  })
})

it("captures a control-point edit and restores the exact cubic identity through Undo, Redo and replay", () => {
  const envelope = {
    schemaVersion: 1,
    documentId: id(500),
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
  const created = applyVersionedDocumentCommand(null, {
    ...envelope,
    kind: "org.vibeshape.document.create",
    commandId: id(501),
    baseRevision: 0,
    payload: { name: "Cubic history" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const f = fixture()
  const added = applyVersionedDocumentCommand(created.snapshot, {
    ...envelope,
    kind: "org.vibeshape.history.insert-sketch",
    commandId: id(502),
    baseRevision: 1,
    payload: { sketch: f.sketch, historyAfter: null },
  })
  if (!added.ok) throw new Error(added.diagnostic.message)
  const moved = moveSketchPoint(f.sketch, f.curve.control2PointId, { x: 4, y: 6 })
  const edited = applyVersionedDocumentCommand(added.snapshot, {
    ...envelope,
    kind: "org.vibeshape.sketch.update",
    commandId: id(503),
    baseRevision: 2,
    payload: { sketch: moved },
  })
  if (!edited.ok) throw new Error(edited.diagnostic.message)
  const undo = {
    ...envelope,
    type: "org.vibeshape.document.restored",
    direction: "undo",
    transactionId: null,
    commandId: id(504),
    baseRevision: 3,
    revision: 4,
    targetRevision: 2,
  }
  const restored = reduceDocumentRestoredEvent(
    documentSnapshotV1Schema.parse(edited.snapshot),
    undo,
    documentSnapshotV1Schema.parse(added.snapshot),
  )
  if (!restored.ok) throw new Error(restored.diagnostic.message)
  expect(restored.snapshot.sketches[0]).toEqual(f.sketch)
  const redo = {
    ...undo,
    direction: "redo",
    commandId: id(505),
    baseRevision: 4,
    revision: 5,
    targetRevision: 3,
  }
  const redone = reduceDocumentRestoredEvent(
    restored.snapshot,
    redo,
    documentSnapshotV1Schema.parse(edited.snapshot),
  )
  if (!redone.ok) throw new Error(redone.diagnostic.message)
  expect(redone.snapshot.sketches[0]).toEqual(moved)
  expect(
    replayVersionedDocumentEvents([created.event, added.event, edited.event, undo, redo]),
  ).toEqual({ ok: true, snapshot: redone.snapshot })
})
