import { describe, expect, it } from "vitest"
import { documentSnapshotSchema } from "./document"

const id = (suffix: string) => `0195b5ac-b220-7a2c-8c33-67a36a7f${suffix}`

function pointSketch(index: number) {
  return {
    schemaVersion: 0 as const,
    id: id(`31${index.toString().padStart(2, "0")}`),
    label: `Sketch ${index}`,
    plane: "xy" as const,
    entities: [
      {
        schemaVersion: 0 as const,
        id: id(`32${index.toString().padStart(2, "0")}`),
        type: "point" as const,
        construction: false,
        x: index,
        y: 0,
      },
    ],
    constraints: [],
  }
}

function sketchPointId(sketch: ReturnType<typeof pointSketch>) {
  const point = sketch.entities[0]
  if (!point) throw new Error("Expected a sketch point.")
  return point.id
}

describe("document sketch references", () => {
  it("accepts an ordered chain of external sketch references", () => {
    const first = pointSketch(1)
    const second = {
      ...pointSketch(2),
      externalReferences: [
        {
          schemaVersion: 0 as const,
          id: id("3301"),
          sourceSketchId: first.id,
          sourcePointId: sketchPointId(first),
          projectedPointId: id("3401"),
        },
      ],
    }
    const third = {
      ...pointSketch(3),
      externalReferences: [
        {
          schemaVersion: 0 as const,
          id: id("3302"),
          sourceSketchId: second.id,
          sourcePointId: sketchPointId(second),
          projectedPointId: id("3402"),
        },
      ],
    }

    expect(
      documentSnapshotSchema.safeParse({
        schemaVersion: 0,
        id: id("3000"),
        revision: 1,
        name: "Reference chain",
        displayUnits: { length: "mm", angle: "deg" },
        variables: [],
        sketches: [first, second, third],
        features: [],
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
      }).success,
    ).toBe(true)
  })
})
