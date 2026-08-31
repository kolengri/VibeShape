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
  legacyRevolveFeatureTypeV2,
  legacyRevolveFeatureTypeV3,
  partDesignFeatureTypeHandlers,
  readRevolveFeatureParameters,
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
  axis: { kind: "origin-axis" as const, axis: "x" as const },
  angle: createAngleQuantity(90, "deg", "#quarterTurn"),
  operation: "new" as const,
}

const targetFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"
const modelEdgeReference = {
  schemaVersion: 0 as const,
  featureId: targetFeatureId,
  kind: "edge" as const,
  semanticRole: "primitive.box.edge.x.y-min.z-min",
  signature: {
    kind: "edge" as const,
    geometryClass: "LINE",
    measure: 20,
    centroid: [0, 0, 0] as const,
    bounds: { min: [-10, 0, 0] as const, max: [10, 0, 0] as const },
    direction: [1, 0, 0] as const,
    directionMode: "axis" as const,
    boundaryCount: 2,
    adjacentGeometryClasses: ["PLANE", "PLANE"],
  },
}

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
        parameters: { ...parameters, axis: "x", operation: "new" },
      }),
    ).toMatchObject({ ok: true })
  })

  it("normalizes schema-version-2 origin-axis intent without widening its stored contract", () => {
    const feature = featureRecordSchema.parse({
      ...revolve("remove"),
      type: legacyRevolveFeatureTypeV2.type,
      parameters: { ...parameters, axis: "y", operation: "remove" },
    })

    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(readRevolveFeatureParameters(feature)?.axis).toEqual({
      kind: "origin-axis",
      axis: "y",
    })
  })

  it("requires a selected line axis to belong to the profile sketch", () => {
    const feature = revolve()
    expect(
      registry().validateFeature({
        ...feature,
        parameters: {
          ...parameters,
          axis: {
            kind: "sketch-line",
            sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3299",
            entityId: profile.outerBoundaryEntityIds[0],
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { issues: [{ path: "parameters.axis.sketchId" }] },
    })
  })

  it("persists a model-edge axis as stable topology intent and an evaluation-only dependency", () => {
    const feature = featureRecordSchema.parse({
      ...revolve(),
      parameters: { ...parameters, axis: { kind: "model-edge", reference: modelEdgeReference } },
      dependencies: [targetFeatureId],
    })

    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(readRevolveFeatureParameters(feature)?.axis).toEqual({
      kind: "model-edge",
      reference: modelEdgeReference,
    })
    expect(featureBodyDependencyIds(feature)).toEqual([])
    expect(registry().validateFeature({ ...feature, dependencies: [] })).toMatchObject({
      ok: false,
      diagnostic: { issues: [{ path: "dependencies" }] },
    })
  })

  it("keeps schema-version-3 sketch-line axes readable", () => {
    const feature = featureRecordSchema.parse({
      ...revolve(),
      type: legacyRevolveFeatureTypeV3.type,
      parameters: {
        ...parameters,
        axis: {
          kind: "sketch-line",
          sketchId: profile.sketchId,
          entityId: profile.outerBoundaryEntityIds[0],
        },
      },
    })
    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
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
      axis: { kind: "origin-axis", axis: "x" },
      angle: Math.PI / 2,
      operation: "new",
    })
  })
})
