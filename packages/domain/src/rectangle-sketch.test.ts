import { describe, expect, it } from "vitest"
import { sketchConstraintIdSchema, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import {
  createRectangleSketch,
  rectangleSketchDefinition,
  rectangleSketchProfileSelector,
  updateRectangleSketch,
} from "./rectangle-sketch"
import { createLengthQuantity } from "./units"

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3001")

function idFactory<Value>(parser: { parse: (value: string) => Value }, prefix: string) {
  let index = 0
  return () => {
    index += 1
    return parser.parse(`0195b5ac-${prefix}-7a2c-8c33-${index.toString(16).padStart(12, "0")}`)
  }
}

function rectangle() {
  return createRectangleSketch({
    id: sketchId,
    label: "Rectangle 1",
    plane: "xy",
    width: createLengthQuantity(30, "mm", "#width"),
    height: createLengthQuantity(12, "mm", "#height"),
    createEntityId: idFactory(sketchEntityIdSchema, "b221"),
    createConstraintId: idFactory(sketchConstraintIdSchema, "b222"),
  })
}

describe("rectangular sketch template", () => {
  it("creates a fully dimensioned stable-identity rectangle with source expressions", () => {
    const sketch = rectangle()
    const definition = rectangleSketchDefinition(sketch)

    expect(sketch).toMatchObject({
      id: sketchId,
      label: "Rectangle 1",
      plane: "xy",
      entities: expect.arrayContaining([
        expect.objectContaining({ type: "line" }),
        expect.objectContaining({ type: "point", x: 30, y: 12 }),
      ]),
    })
    expect(definition).toMatchObject({
      width: { value: 30, source: { expression: "#width" } },
      height: { value: 12, source: { expression: "#height" } },
    })
    expect(rectangleSketchProfileSelector(sketch)).toEqual({
      schemaVersion: 0,
      sketchId,
      outerBoundaryEntityIds: sketch.entities
        .flatMap((entity) => (entity.type === "line" ? [entity.id] : []))
        .sort(),
      holeBoundaryEntityIds: [],
    })
  })

  it("updates expressions and plane while preserving sketch and topology identity", () => {
    const sketch = rectangle()
    const updated = updateRectangleSketch(sketch, {
      plane: "xz",
      width: createLengthQuantity(42, "mm", "#width + 12 mm"),
      height: createLengthQuantity(20, "mm", "20 mm"),
    })

    expect(updated.id).toBe(sketch.id)
    expect(updated.entities.map(({ id }) => id)).toEqual(sketch.entities.map(({ id }) => id))
    expect(updated.constraints.map(({ id }) => id)).toEqual(sketch.constraints.map(({ id }) => id))
    expect(rectangleSketchDefinition(updated)).toMatchObject({
      plane: "xz",
      width: { value: 42, source: { expression: "#width + 12 mm" } },
      height: { value: 20, source: { expression: "20 mm" } },
    })
  })

  it("fails closed for a rectangle whose intent constraints were changed", () => {
    const sketch = rectangle()
    const changed = {
      ...sketch,
      constraints: sketch.constraints.filter(({ type }) => type !== "fixed"),
    }
    expect(rectangleSketchDefinition(changed)).toBeNull()
    expect(rectangleSketchProfileSelector(changed)).toBeNull()
    expect(() =>
      updateRectangleSketch(changed, {
        plane: "xy",
        width: createLengthQuantity(20),
        height: createLengthQuantity(20),
      }),
    ).toThrow("not a supported rectangular sketch")
  })
})
