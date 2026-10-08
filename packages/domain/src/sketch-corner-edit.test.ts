import { describe, expect, it } from "bun:test"
import { sketchConstraintIdSchema, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import { createRectangleSketch } from "./rectangle-sketch"
import { treatSketchCorner } from "./sketch-corner-edit"
import { createLengthQuantity } from "./units"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
function fixture() {
  let entity = 1,
    constraint = 100
  const createEntityId = () => sketchEntityIdSchema.parse(id(entity++))
  const createConstraintId = () => sketchConstraintIdSchema.parse(id(constraint++))
  const sketch = createRectangleSketch({
    id: sketchIdSchema.parse(id(200)),
    label: "Corner",
    plane: "xy",
    width: createLengthQuantity(10),
    height: createLengthQuantity(8),
    createEntityId,
    createConstraintId,
  })
  return { sketch, createEntityId, createConstraintId }
}
describe("stable sketch corner treatments", () => {
  it.each(["fillet", "chamfer"] as const)(
    "preserves virtual-corner dimensions and stable source line IDs for %s",
    (kind) => {
      const f = fixture(),
        before = JSON.parse(JSON.stringify(f.sketch))
      const treatment =
        kind === "fillet"
          ? {
              kind,
              firstLineId: sketchEntityIdSchema.parse(id(5)),
              secondLineId: sketchEntityIdSchema.parse(id(6)),
              radius: createLengthQuantity(2, "mm", "radius"),
            }
          : {
              kind,
              firstLineId: sketchEntityIdSchema.parse(id(5)),
              secondLineId: sketchEntityIdSchema.parse(id(6)),
              firstDistance: createLengthQuantity(2),
              secondDistance: createLengthQuantity(3),
            }
      const result = treatSketchCorner(f.sketch, { ...f, treatment })
      expect(f.sketch).toEqual(before)
      expect(result.sketch.entities.find(({ id: entityId }) => entityId === id(5))).toMatchObject({
        type: "line",
        construction: false,
      })
      expect(result.sketch.entities.find(({ id: entityId }) => entityId === id(2))).toMatchObject({
        x: 10,
        y: 0,
        construction: true,
      })
      expect(
        result.sketch.constraints.find(({ id: constraintId }) => constraintId === id(105)),
      ).toEqual(f.sketch.constraints.find(({ id: constraintId }) => constraintId === id(105)))
      expect(
        result.sketch.entities.filter((entity) => entity.type === "line" && entity.construction),
      ).toHaveLength(2)
      if (kind === "fillet") {
        expect(result.sketch.constraints.filter(({ type }) => type === "tangent")).toHaveLength(2)
        expect(result.sketch.constraints.find(({ type }) => type === "radius")).toMatchObject({
          value: { source: { expression: "radius" } },
        })
      }
    },
  )
  it("rejects collinear and branched authored corners without changing source identity", () => {
    const f = fixture()
    const treatment = {
      kind: "fillet" as const,
      firstLineId: sketchEntityIdSchema.parse(id(5)),
      secondLineId: sketchEntityIdSchema.parse(id(6)),
      radius: createLengthQuantity(1),
    }
    const collinear = {
      ...f.sketch,
      entities: f.sketch.entities.map((entity) =>
        entity.type === "point" && entity.id === id(3) ? { ...entity, x: 20, y: 0 } : entity,
      ),
    }
    expect(() => treatSketchCorner(collinear, { ...f, treatment })).toThrow("non-collinear")
    const branched = {
      ...f.sketch,
      entities: [
        ...f.sketch.entities,
        {
          schemaVersion: 0 as const,
          id: sketchEntityIdSchema.parse(id(500)),
          type: "line" as const,
          startPointId: sketchEntityIdSchema.parse(id(2)),
          endPointId: sketchEntityIdSchema.parse(id(4)),
          construction: false,
        },
      ],
    }
    expect(() => treatSketchCorner(branched, { ...f, treatment })).toThrow("branched")
    expect(f.sketch.entities).toHaveLength(8)
  })
  it("fails atomically for incompatible and oversized corners", () => {
    const f = fixture(),
      before = JSON.parse(JSON.stringify(f.sketch))
    const treatment = {
      kind: "fillet" as const,
      firstLineId: sketchEntityIdSchema.parse(id(5)),
      secondLineId: sketchEntityIdSchema.parse(id(7)),
      radius: createLengthQuantity(1),
    }
    expect(() => treatSketchCorner(f.sketch, { ...f, treatment })).toThrow("shared endpoint")
    expect(() =>
      treatSketchCorner(f.sketch, {
        ...f,
        treatment: {
          ...treatment,
          secondLineId: sketchEntityIdSchema.parse(id(6)),
          radius: createLengthQuantity(9),
        },
      }),
    ).toThrow("fit strictly")
    expect(f.sketch).toEqual(before)
  })
})
