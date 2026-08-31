import { revolveFeatureContentParametersSchema } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import {
  type FeatureEvaluationInput,
  type RevolveContentParameters,
  revolveInputCardinalityIsValid,
} from "./engine"

const targetFeatureId = "01900000-0000-7000-8000-000000000101"
const supportFeatureId = "01900000-0000-7000-8000-000000000102"
const axisSourceFeatureId = "01900000-0000-7000-8000-000000000103"

function parameters(
  operation: "new" | "add",
  supportId: string | undefined = undefined,
): RevolveContentParameters {
  return revolveFeatureContentParametersSchema.parse({
    sketchId: "01900000-0000-7000-8000-000000000201",
    ...(supportId ? { supportFeatureId: supportId } : {}),
    frame: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    },
    outer: {
      sourceEntityIds: ["01900000-0000-7000-8000-000000000301"],
      segments: [
        {
          entityId: "01900000-0000-7000-8000-000000000301",
          type: "circle",
          center: [5, 0],
          radius: 1,
        },
      ],
    },
    holes: [],
    axis: {
      kind: "model-edge",
      reference: {
        schemaVersion: 0,
        featureId: axisSourceFeatureId,
        kind: "edge",
        semanticRole: "test.axis.edge",
        signature: {
          kind: "edge",
          geometryClass: "LINE",
          measure: 10,
          centroid: [5, 0, 0],
          bounds: { min: [0, 0, 0], max: [10, 0, 0] },
          direction: [1, 0, 0],
          directionMode: "axis",
          boundaryCount: 2,
          adjacentGeometryClasses: ["PLANE", "PLANE"],
        },
      },
    },
    axisOrigin: [0, 0, 0],
    axisDirection: [1, 0, 0],
    angleRadians: Math.PI,
    operation,
  })
}

function input(dependencyIds: readonly string[]): FeatureEvaluationInput {
  return {
    content: {
      feature: { inputs: dependencyIds.map(() => "input") },
    },
    dependencies: dependencyIds.map((featureId) => ({ featureId })),
  } as unknown as FeatureEvaluationInput
}

describe("revolveInputCardinalityIsValid", () => {
  it("accepts a distinct model-edge source for an origin-plane new body", () => {
    expect(revolveInputCardinalityIsValid(input([axisSourceFeatureId]), parameters("new"))).toBe(
      true,
    )
    expect(revolveInputCardinalityIsValid(input([]), parameters("new"))).toBe(false)
  })

  it("requires support before a distinct model-edge source", () => {
    const content = parameters("new", supportFeatureId)
    expect(
      revolveInputCardinalityIsValid(input([supportFeatureId, axisSourceFeatureId]), content),
    ).toBe(true)
    expect(
      revolveInputCardinalityIsValid(input([axisSourceFeatureId, supportFeatureId]), content),
    ).toBe(false)
  })

  it("requires target, support, and a distinct model-edge source in canonical order", () => {
    const content = parameters("add", supportFeatureId)
    expect(
      revolveInputCardinalityIsValid(
        input([targetFeatureId, supportFeatureId, axisSourceFeatureId]),
        content,
      ),
    ).toBe(true)
    expect(
      revolveInputCardinalityIsValid(input([targetFeatureId, supportFeatureId]), content),
    ).toBe(false)
  })
})
