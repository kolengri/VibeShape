import { describe, expect, it } from "vitest"
import { featureRecordSchema } from "./feature-graph"
import {
  partDesignFeatureTypeHandlers,
  revolveFeatureParametersSchema,
  revolveFeatureType,
} from "./part-design"
import { createAngleQuantity } from "./units"
import { evaluateVariableDefinitions } from "./variables"

const profile = {
  schemaVersion: 0,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3211"],
  holeBoundaryEntityIds: [],
}

const parameters = {
  profile,
  axis: "x" as const,
  angle: createAngleQuantity(90, "deg", "#quarterTurn"),
  operation: "new" as const,
}

describe("selector-backed revolve feature", () => {
  it("accepts bounded axis and angle intent while rejecting unsupported operations", () => {
    expect(revolveFeatureParametersSchema.safeParse(parameters).success).toBe(true)
    expect(
      revolveFeatureParametersSchema.safeParse({
        ...parameters,
        angle: createAngleQuantity(0),
      }).success,
    ).toBe(false)
    expect(
      revolveFeatureParametersSchema.safeParse({
        ...parameters,
        angle: createAngleQuantity(360, "deg"),
      }).success,
    ).toBe(true)
    expect(
      revolveFeatureParametersSchema.safeParse({ ...parameters, operation: "add" }).success,
    ).toBe(false)
  })

  it("resolves an angle expression and emits transient authored content", () => {
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f3301",
      type: revolveFeatureType.type,
      parameters,
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const variables = evaluateVariableDefinitions([
      {
        schemaVersion: 0,
        id: "0195b5ac-b240-7a2c-8c33-67a36a7f21ac",
        name: "quarterTurn",
        expression: "45 deg",
      },
    ])
    if (!variables.ok) throw new Error(variables.diagnostic.message)
    const handler = partDesignFeatureTypeHandlers.find(
      (candidate) => candidate.type.typeId === revolveFeatureType.type.typeId,
    )
    if (!handler?.resolveParameters) throw new Error("Revolve handler is not registered.")
    expect(handler.resolveParameters(feature.parameters, variables.valuesByName)).toMatchObject({
      ok: true,
      parameters: { angle: { value: Math.PI / 4 } },
    })
    expect(handler.contentParameters(parameters)).toMatchObject({
      axis: "x",
      angle: Math.PI / 2,
      operation: "new",
    })
  })
})
