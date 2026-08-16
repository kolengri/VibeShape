import { describe, expect, it } from "vitest"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  extrusionFeatureParametersSchema,
  extrusionFeatureType,
  legacyExtrusionFeatureType,
  partDesignFeatureTypeHandlers,
} from "./part-design"
import { createLengthQuantity } from "./units"
import { evaluateVariableDefinitions } from "./variables"

const profile = {
  schemaVersion: 0,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
  outerBoundaryEntityIds: [
    "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
    "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
    "0195b5ac-b220-7a2c-8c33-67a36a7f3213",
    "0195b5ac-b220-7a2c-8c33-67a36a7f3214",
  ],
  holeBoundaryEntityIds: [],
} as const

function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.registry
}

function extrusion(distance = createLengthQuantity(12, "mm", "#depth")) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f3301",
    type: extrusionFeatureType.type,
    parameters: { profile, distance, symmetric: false, operation: "new" },
    dependencies: [],
    references: [],
    suppressed: false,
    label: "Extrusion 1",
  })
}

describe("selector-backed extrusion feature", () => {
  it("persists only stable profile intent and a variable-capable distance", () => {
    expect(extrusionFeatureParametersSchema.parse(extrusion().parameters)).toEqual(
      extrusion().parameters,
    )
    expect(
      extrusionFeatureParametersSchema.safeParse({
        ...extrusion().parameters,
        profile: { ...profile, transientProfileIndex: 0 },
      }).success,
    ).toBe(false)
  })

  it.each(["add", "remove", "intersect"] as const)(
    "requires one explicit target dependency for %s",
    (operation) => {
      const feature = {
        ...extrusion(),
        parameters: { ...extrusion().parameters, operation },
      }
      expect(registry().validateFeature(feature)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-feature-parameters",
          issues: [{ path: "dependencies" }],
        },
      })
      expect(
        registry().validateFeature({
          ...feature,
          dependencies: ["0195b5ac-b220-7a2c-8c33-67a36a7f3302"],
        }),
      ).toMatchObject({ ok: true })
    },
  )

  it("keeps schema-version-1 new-body extrusion readable", () => {
    expect(
      registry().validateFeature({
        ...extrusion(),
        type: legacyExtrusionFeatureType.type,
      }),
    ).toMatchObject({ ok: true })
  })

  it("resolves distance expressions while retaining the authored selector", () => {
    const variables = evaluateVariableDefinitions([
      {
        schemaVersion: 0,
        id: "0195b5ac-b240-7a2c-8c33-67a36a7f21ac",
        name: "depth",
        expression: "18 mm",
      },
    ])
    if (!variables.ok) throw new Error(variables.diagnostic.message)

    const resolved = registry().resolveFeatureParameters(extrusion(), variables.valuesByName)
    expect(resolved).toMatchObject({
      ok: true,
      feature: {
        parameters: {
          profile,
          distance: { value: 18, source: { expression: "#depth" } },
          symmetric: false,
          operation: "new",
        },
      },
    })
  })

  it("fails closed for missing variables and non-positive distances", () => {
    const variables = evaluateVariableDefinitions([])
    if (!variables.ok) throw new Error(variables.diagnostic.message)

    expect(registry().resolveFeatureParameters(extrusion(), variables.valuesByName)).toMatchObject({
      ok: false,
      diagnostic: { reason: "unknown-variable", issues: [{ path: "parameters.distance" }] },
    })
    expect(
      extrusionFeatureParametersSchema.safeParse({
        ...extrusion().parameters,
        distance: createLengthQuantity(0),
      }).success,
    ).toBe(false)
  })
})
