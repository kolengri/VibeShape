import { describe, expect, it } from "vitest"
import {
  featureIdSchema,
  sketchEntityIdSchema,
  sketchExternalReferenceIdSchema,
} from "./identifiers"
import { sketchRecordSchema, type SketchRecord } from "./sketch"
import { inspectSketchReferenceHealth } from "./sketch-reference-health"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${value.toString().padStart(12, "0")}`

function pointSketch(value: number, label: string) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(value),
    label,
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: id(value + 100),
        type: "point",
        construction: false,
        x: value,
        y: 0,
      },
    ],
    constraints: [],
  })
}

function projectedPointSketch(
  value: number,
  label: string,
  source: SketchRecord,
  sourcePointId = source.entities[0]?.id,
) {
  if (!sourcePointId) throw new Error("The source point fixture is required.")
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(value),
    label,
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: id(value + 200),
        sourceSketchId: source.id,
        sourcePointId,
        projectedPointId: id(value + 300),
      },
    ],
  })
}

describe("inspectSketchReferenceHealth", () => {
  it("distinguishes healthy authored references from direct identity failures", () => {
    const source = pointSketch(1, "Source")
    const healthy = projectedPointSketch(2, "Healthy", source)
    const broken = projectedPointSketch(3, "Broken", source, sketchEntityIdSchema.parse(id(999)))

    const health = inspectSketchReferenceHealth([source, healthy, broken])

    expect(health.get(healthy.id)).toEqual({
      status: "healthy",
      directBrokenReferenceIds: [],
      transitiveBrokenReferenceIds: [],
      uncheckedModelReferenceIds: [],
    })
    expect(health.get(broken.id)).toEqual({
      status: "broken",
      directBrokenReferenceIds: [broken.externalReferences?.[0]?.id],
      transitiveBrokenReferenceIds: [],
      uncheckedModelReferenceIds: [],
    })
  })

  it("classifies missing source sketches and incompatible source types as direct failures", () => {
    const source = pointSketch(5, "Source")
    const missingSource = projectedPointSketch(6, "Missing source", source)
    const sourcePointId = source.entities[0]?.id
    if (!sourcePointId) throw new Error("The source point fixture is required.")
    const wrongType = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id(7),
      label: "Wrong type",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id(207),
          kind: "line",
          sourceSketchId: source.id,
          sourceLineId: sourcePointId,
          projectedLineId: id(307),
          projectedStartPointId: id(308),
          projectedEndPointId: id(309),
        },
      ],
    })

    expect(inspectSketchReferenceHealth([], [missingSource]).get(missingSource.id)).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [missingSource.externalReferences?.[0]?.id],
    })
    expect(inspectSketchReferenceHealth([source], [wrongType]).get(wrongType.id)).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [wrongType.externalReferences?.[0]?.id],
    })
  })

  it("reports a downstream projected reference as transitively broken", () => {
    const deletedSource = { ...pointSketch(10, "Source"), entities: [] }
    const middle = projectedPointSketch(
      11,
      "Middle",
      deletedSource,
      sketchEntityIdSchema.parse(id(110)),
    )
    const middleReference = middle.externalReferences?.[0]
    if (!middleReference || !("projectedPointId" in middleReference)) {
      throw new Error("The intermediate projection is required.")
    }
    const middleProjectedPointId = middleReference.projectedPointId
    const target = projectedPointSketch(12, "Target", middle, middleProjectedPointId)

    const health = inspectSketchReferenceHealth([deletedSource, middle, target])

    expect(health.get(middle.id)?.directBrokenReferenceIds).toEqual([
      middle.externalReferences?.[0]?.id,
    ])
    expect(health.get(target.id)).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [],
      transitiveBrokenReferenceIds: [target.externalReferences?.[0]?.id],
    })
  })

  it("fails closed when malformed projected-reference ownership is cyclic", () => {
    const firstProjectedPointId = sketchEntityIdSchema.parse(id(430))
    const secondProjectedPointId = sketchEntityIdSchema.parse(id(431))
    const firstId = id(40)
    const secondId = id(41)
    const first = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: firstId,
      label: "First",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id(240),
          sourceSketchId: secondId,
          sourcePointId: secondProjectedPointId,
          projectedPointId: firstProjectedPointId,
        },
      ],
    })
    const second = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: secondId,
      label: "Second",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id(241),
          sourceSketchId: firstId,
          sourcePointId: firstProjectedPointId,
          projectedPointId: secondProjectedPointId,
        },
      ],
    })

    expect(inspectSketchReferenceHealth([first, second]).get(first.id)).toMatchObject({
      status: "broken",
      transitiveBrokenReferenceIds: [first.externalReferences?.[0]?.id],
    })
  })

  it("keeps model-topology references unknown until rebuilt geometry can resolve them", () => {
    const sketch = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id(50),
      label: "Model reference",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: sketchExternalReferenceIdSchema.parse(id(250)),
          kind: "model-point",
          reference: {
            schemaVersion: 0,
            featureId: featureIdSchema.parse(id(450)),
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
          projectedPointId: id(350),
        },
      ],
    })

    expect(inspectSketchReferenceHealth([sketch]).get(sketch.id)).toEqual({
      status: "unknown",
      directBrokenReferenceIds: [],
      transitiveBrokenReferenceIds: [],
      uncheckedModelReferenceIds: [sketch.externalReferences?.[0]?.id],
    })
  })
})
