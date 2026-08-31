import { describe, expect, it } from "vitest"
import { featureBodyDependencyIds } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  legacyRevolveFeatureType,
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

const targetFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"

function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.registry
}

function revolve(operation: "new" | "add" | "remove" | "intersect" = "new") {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f3301",
    type: revolveFeatureType.type,
    parameters: { ...parameters, operation },
    dependencies: operation === "new" ? [] : [targetFeatureId],
    references: [],
    suppressed: false,
    label: "Revolve 1",
  })
}

describe("selector-backed revolve feature", () => {
  it("accepts bounded axis, angle, and modifying-operation intent", () => {
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
    for (const operation of ["new", "add", "remove", "intersect"] as const) {
      expect(revolveFeatureParametersSchema.safeParse({ ...parameters, operation }).success).toBe(
        true,
      )
    }
    expect(
      revolveFeatureParametersSchema.safeParse({ ...parameters, operation: "join" }).success,
    ).toBe(false)
  })

  it.each(["add", "remove", "intersect"] as const)(
    "requires one explicit target dependency for %s",
    (operation) => {
      const feature = revolve(operation)
      expect(
        registry().validateFeature({
          ...feature,
          dependencies: [],
        }),
      ).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-feature-parameters",
          issues: [{ path: "dependencies" }],
        },
      })
      expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
      expect(featureBodyDependencyIds(feature)).toEqual([targetFeatureId])
    },
  )

  it("keeps schema-version-1 new-body revolve readable", () => {
    expect(
      registry().validateFeature({
        ...revolve(),
        type: legacyRevolveFeatureType.type,
      }),
    ).toMatchObject({ ok: true })
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
      (candidate) =>
        candidate.type.typeId === revolveFeatureType.type.typeId &&
        candidate.type.schemaVersion === revolveFeatureType.type.schemaVersion,
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
