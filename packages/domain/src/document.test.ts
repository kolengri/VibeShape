import { describe, expect, it } from "vitest"
import { documentSnapshotSchema, documentSnapshotV1Schema } from "./document"
import { featureRecordV1Schema } from "./feature-graph"

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

  it("validates an external curve against its stable source entity and type", () => {
    const center = pointSketch(4)
    const sourceCircleId = id("3501")
    const source = {
      ...center,
      entities: [
        ...center.entities,
        {
          schemaVersion: 0 as const,
          id: sourceCircleId,
          type: "circle" as const,
          construction: false,
          centerPointId: sketchPointId(center),
          radius: 4,
        },
      ],
    }
    const target = {
      ...pointSketch(5),
      externalReferences: [
        {
          schemaVersion: 0 as const,
          id: id("3502"),
          kind: "curve" as const,
          sourceSketchId: source.id,
          sourceEntityId: sourceCircleId,
          sourceType: "circle" as const,
          projectedEntityId: id("3503"),
          projectedType: "circle" as const,
          projectedPointIds: [id("3504")],
        },
      ],
    }
    const snapshot = {
      schemaVersion: 0,
      id: id("3505"),
      revision: 1,
      name: "Curve reference",
      displayUnits: { length: "mm", angle: "deg" },
      variables: [],
      sketches: [source, target],
      features: [],
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    }

    expect(documentSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(
      documentSnapshotSchema.safeParse({
        ...snapshot,
        sketches: [
          source,
          {
            ...target,
            externalReferences: [{ ...target.externalReferences[0], sourceType: "arc" }],
          },
        ],
      }).success,
    ).toBe(false)
  })
})

describe("document snapshot v1", () => {
  const feature = (suffix: string, semanticInputs: readonly unknown[]) =>
    featureRecordV1Schema.parse({
      schemaVersion: 1,
      id: id(suffix),
      type: {
        moduleId: "org.example.extension",
        moduleVersion: "1.0.0",
        typeId: "org.example.feature.reference",
        schemaVersion: 1,
      },
      parameters: {},
      dependencies: [],
      references: [],
      semanticInputs,
      suppressed: false,
    })
  const base = {
    schemaVersion: 1 as const,
    id: id("3600"),
    revision: 1,
    name: "Versioned history",
    displayUnits: { length: "mm" as const, angle: "deg" as const },
    variables: [],
    sketches: [],
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  }

  it("requires History and exact dependency-safe coverage", () => {
    const source = feature("3601", [])
    const consumer = feature("3602", [{ kind: "feature", id: source.id }])

    expect(
      documentSnapshotV1Schema.safeParse({ ...base, features: [source], history: undefined })
        .success,
    ).toBe(false)
    expect(
      documentSnapshotV1Schema.safeParse({
        ...base,
        features: [source, consumer],
        history: [{ kind: "feature", id: source.id }],
      }).success,
    ).toBe(false)
    expect(
      documentSnapshotV1Schema.safeParse({
        ...base,
        features: [source, consumer],
        history: [
          { kind: "feature", id: consumer.id },
          { kind: "feature", id: source.id },
        ],
      }).success,
    ).toBe(false)
    expect(
      documentSnapshotV1Schema.safeParse({
        ...base,
        features: [source, consumer],
        history: [
          { kind: "feature", id: source.id },
          { kind: "feature", id: consumer.id },
        ],
      }).success,
    ).toBe(true)
  })
})
