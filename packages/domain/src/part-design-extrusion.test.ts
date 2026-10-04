import { describe, expect, it } from "vitest"
import { featureBodyDependencies, featureGeometryDependencies } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { terminalBodyOutputs } from "./model-bodies"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  extrusionFeatureParametersSchema,
  extrusionFeatureParametersV4Schema,
  extrusionFeatureParametersV5Schema,
  extrusionFeatureParametersV6Schema,
  extrusionFeatureParametersV7Schema,
  extrusionFeatureType,
  extrusionFeatureTypeV4,
  extrusionFeatureTypeV5,
  extrusionFeatureTypeV6,
  extrusionFeatureTypeV7,
  legacyExtrusionFeatureType,
  multiProfileExtrusionFeatureParametersSchema,
  multiProfileExtrusionFeatureType,
  partDesignFeatureTypeHandlers,
  readExtrusionFeatureParameters,
  readExtrusionProfileSet,
} from "./part-design"
import { createAngleQuantity, createLengthQuantity } from "./units"
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
const secondProfile = {
  ...profile,
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3221"],
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
  const extentFeature = (parameters = {}) =>
    featureRecordSchema.parse({
      ...extrusion(),
      type: extrusionFeatureTypeV5.type,
      parameters: {
        profiles: { schemaVersion: 0, profiles: [profile] },
        distance: createLengthQuantity(10),
        symmetric: false,
        reversed: false,
        secondDistance: createLengthQuantity(3),
        operation: "new",
        ...parameters,
      },
    })

  it("registers independent depths and preserves legacy total-span intent", () => {
    const feature = extentFeature()
    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(readExtrusionFeatureParameters(feature)).toMatchObject({
      profile,
      reversed: false,
      secondDistance: { value: 3 },
    })
    const legacy = { ...extrusion(), parameters: { ...extrusion().parameters, symmetric: true } }
    expect(readExtrusionFeatureParameters(legacy)).toMatchObject({
      distance: { value: 12 },
      symmetric: true,
      reversed: false,
      secondDistance: null,
    })
    expect(legacy.parameters).not.toHaveProperty("secondDistance")
    expect(extrusionFeatureParametersSchema.safeParse(feature.parameters).success).toBe(false)
  })

  it("canonicalizes both literal depth units in authored content", () => {
    const millimeters = registry().validateFeature(extentFeature())
    const centimeters = registry().validateFeature(
      extentFeature({
        distance: createLengthQuantity(1, "cm"),
        secondDistance: createLengthQuantity(0.3, "cm"),
      }),
    )
    expect(millimeters.ok && centimeters.ok).toBe(true)
    if (!millimeters.ok || !centimeters.ok) throw new Error("Expected valid extent features.")
    expect(centimeters.contentParameters).toEqual(millimeters.contentParameters)
    expect(millimeters.contentParameters).toMatchObject({
      distance: 10,
      secondDistance: 3,
      reversed: false,
    })
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite authored depths %s",
    (value) => {
      expect(
        extrusionFeatureParametersV5Schema.safeParse({
          ...extentFeature().parameters,
          secondDistance: { ...createLengthQuantity(3), value },
        }).success,
      ).toBe(false)
    },
  )

  it.each([
    { distance: createLengthQuantity(0) },
    { distance: createLengthQuantity(0.0005) },
    { secondDistance: createLengthQuantity(-1) },
    { secondDistance: createLengthQuantity(0) },
    { symmetric: true },
    { distance: createLengthQuantity(99_999), secondDistance: createLengthQuantity(2) },
    { offset: createLengthQuantity(1) },
    { reversed: "true" },
    { secondDistance: undefined },
  ])("rejects invalid authored extrusion extents %j", (parameters) => {
    expect(
      extrusionFeatureParametersV5Schema.safeParse({ ...extentFeature().parameters, ...parameters })
        .success,
    ).toBe(false)
  })

  it.each(["add", "remove", "intersect"] as const)(
    "requires an explicit target for v5 %s",
    (operation) => {
      const feature = extentFeature({ operation })
      expect(registry().validateFeature(feature)).toMatchObject({ ok: false })
      expect(
        registry().validateFeature({
          ...feature,
          dependencies: ["0195b5ac-b220-7a2c-8c33-67a36a7f3302"],
        }),
      ).toMatchObject({ ok: true })
    },
  )

  it("resolves both expressions in canonical millimeters and rejects total overflow after rebuild", () => {
    const feature = extentFeature({
      distance: createLengthQuantity(1, "cm", "#front"),
      secondDistance: createLengthQuantity(0.3, "cm", "#back"),
    })
    const variables = (front: string, back: string) => {
      const result = evaluateVariableDefinitions([
        {
          schemaVersion: 0,
          id: "0195b5ac-b240-7a2c-8c33-67a36a7f21ac",
          name: "front",
          expression: front,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b240-7a2c-8c33-67a36a7f21ad",
          name: "back",
          expression: back,
        },
      ])
      if (!result.ok) throw new Error(result.diagnostic.message)
      return result.valuesByName
    }
    expect(registry().resolveFeatureParameters(feature, variables("1 in", "3 mm"))).toMatchObject({
      ok: true,
      feature: {
        parameters: {
          distance: { value: 25.4, source: { expression: "#front" } },
          secondDistance: { value: 3, source: { expression: "#back" } },
        },
      },
    })
    expect(
      registry().resolveFeatureParameters(feature, variables("99999 mm", "2 mm")),
    ).toMatchObject({
      ok: false,
      diagnostic: { reason: "invalid-range" },
    })
    expect(registry().resolveFeatureParameters(feature, variables("10 mm", "0 mm"))).toMatchObject({
      ok: false,
    })
    expect(registry().resolveFeatureParameters(feature, variables("10 mm", "3 deg"))).toMatchObject(
      {
        ok: false,
        diagnostic: { issues: [{ path: "parameters.secondDistance" }] },
      },
    )
  })

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

  it("registers a same-sketch multi-profile new-body version without changing legacy reads", () => {
    const feature = featureRecordSchema.parse({
      ...extrusion(),
      type: multiProfileExtrusionFeatureType.type,
      parameters: {
        profiles: { schemaVersion: 0, profiles: [profile, secondProfile] },
        distance: createLengthQuantity(12, "mm"),
        symmetric: false,
        operation: "new",
      },
    })
    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(readExtrusionProfileSet(feature)?.profiles).toEqual([profile, secondProfile])
    expect(readExtrusionProfileSet(extrusion())?.profiles).toEqual([profile])
    expect(
      multiProfileExtrusionFeatureParametersSchema.safeParse({
        ...feature.parameters,
        operation: "add",
      }).success,
    ).toBe(false)
    expect(
      multiProfileExtrusionFeatureParametersSchema.safeParse({
        ...feature.parameters,
        profiles: {
          schemaVersion: 0,
          profiles: [
            profile,
            { ...secondProfile, sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3299" },
          ],
        },
      }).success,
    ).toBe(false)
  })

  it.each(["add", "remove", "intersect"] as const)(
    "registers a distinct multi-profile %s version with a target-first dependency",
    (operation) => {
      const targetFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"
      const parameters = extrusionFeatureParametersV4Schema.parse({
        profiles: { schemaVersion: 0, profiles: [profile, secondProfile] },
        distance: createLengthQuantity(12, "mm"),
        symmetric: false,
        operation,
      })
      const feature = featureRecordSchema.parse({
        ...extrusion(),
        type: extrusionFeatureTypeV4.type,
        parameters,
        dependencies: [targetFeatureId],
      })

      expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
      expect(readExtrusionProfileSet(feature)?.profiles).toEqual([profile, secondProfile])
      expect(
        registry().validateFeature({
          ...feature,
          dependencies: [],
        }),
      ).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-feature-dependency-count",
        },
      })
    },
  )

  it("rejects multi-profile payloads that do not match the declared extrusion version", () => {
    const versionThreeParameters = {
      profiles: { schemaVersion: 0 as const, profiles: [profile, secondProfile] },
      distance: createLengthQuantity(12, "mm"),
      symmetric: false,
      operation: "new" as const,
    }
    const mismatchedVersionFour = featureRecordSchema.parse({
      ...extrusion(),
      type: extrusionFeatureTypeV4.type,
      parameters: versionThreeParameters,
      dependencies: ["0195b5ac-b220-7a2c-8c33-67a36a7f3302"],
    })

    expect(readExtrusionFeatureParameters(mismatchedVersionFour)).toBeNull()
    expect(registry().validateFeature(mismatchedVersionFour)).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-parameters" },
    })

    const mismatchedVersionThree = featureRecordSchema.parse({
      ...mismatchedVersionFour,
      type: multiProfileExtrusionFeatureType.type,
      parameters: { ...versionThreeParameters, operation: "remove" },
    })
    expect(readExtrusionFeatureParameters(mismatchedVersionThree)).toBeNull()
    expect(registry().validateFeature(mismatchedVersionThree)).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-parameters" },
    })
  })

  it("keeps multi-profile support after the target and deduplicates the same source", () => {
    const targetFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"
    const supportFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3303"
    const reference = {
      schemaVersion: 0 as const,
      featureId: supportFeatureId,
      kind: "face" as const,
      semanticRole: "extrusion.cap.end",
      signature: {
        kind: "face" as const,
        geometryClass: "PLANE",
        measure: 400,
        centroid: [0, 0, 10] as [number, number, number],
        bounds: {
          min: [-10, -10, 10] as [number, number, number],
          max: [10, 10, 10] as [number, number, number],
        },
        direction: [0, 0, 1] as [number, number, number],
        directionMode: "oriented" as const,
        boundaryCount: 4,
        adjacentGeometryClasses: ["PLANE"],
      },
    }
    const feature = featureRecordSchema.parse({
      ...extrusion(),
      type: extrusionFeatureTypeV4.type,
      parameters: {
        profiles: { schemaVersion: 0, profiles: [profile, secondProfile] },
        distance: createLengthQuantity(12, "mm"),
        symmetric: false,
        operation: "remove",
      },
      dependencies: [targetFeatureId, supportFeatureId],
      references: [reference],
    })

    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(
      registry().validateFeature({ ...feature, dependencies: [supportFeatureId, targetFeatureId] }),
    ).toMatchObject({ ok: false })
    expect(
      registry().validateFeature({
        ...feature,
        dependencies: [supportFeatureId],
        references: [{ ...reference, featureId: supportFeatureId }],
      }),
    ).toMatchObject({ ok: true })
  })

  it("accepts one stable face-support dependency for a new-body extrusion", () => {
    const supportFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"
    const reference = {
      schemaVersion: 0 as const,
      featureId: supportFeatureId,
      kind: "face" as const,
      semanticRole: "extrusion.cap.end",
      signature: {
        kind: "face" as const,
        geometryClass: "PLANE",
        measure: 400,
        centroid: [0, 0, 10] as [number, number, number],
        bounds: {
          min: [-10, -10, 10] as [number, number, number],
          max: [10, 10, 10] as [number, number, number],
        },
        direction: [0, 0, 1] as [number, number, number],
        directionMode: "oriented" as const,
        boundaryCount: 4,
        adjacentGeometryClasses: ["PLANE"],
      },
    }
    const supported = featureRecordSchema.parse({
      ...extrusion(),
      dependencies: [supportFeatureId],
      references: [reference],
    })

    expect(registry().validateFeature(supported)).toMatchObject({ ok: true })
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

describe("body-bound extrusion end conditions", () => {
  const target = {
    schemaVersion: 0,
    featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3401",
    outputRole: "pattern.instance.1",
  }
  const base = {
    profiles: { schemaVersion: 0, profiles: [profile] },
    distance: createLengthQuantity(12),
    symmetric: false,
    reversed: false,
    secondDistance: null,
    operation: "new",
    targetBody: null,
    startOffset: createLengthQuantity(-3),
    draftAngle: createAngleQuantity(5, "deg"),
    endCondition: { kind: "distance" },
  }
  const sphericalEnd = (body = target) => ({
    kind: "up-to-face",
    targetBody: body,
    sourceContentHash: "a".repeat(64),
    face: {
      ...body,
      schemaVersion: 1,
      kind: "face",
      signature: {
        kind: "face",
        geometryClass: "SPHERE",
        measure: 64 * Math.PI,
        centroid: [0, 0, 8],
        bounds: { min: [-4, -4, 4], max: [4, 4, 12] },
        boundaryCount: 1,
        adjacentGeometryClasses: [],
      },
    },
  })
  it("registers v7 finite curved face extents without broadening the strict v6 decoder", () => {
    const parameters = { ...base, endCondition: sphericalEnd() }
    expect(extrusionFeatureParametersV7Schema.safeParse(parameters).success).toBe(true)
    expect(extrusionFeatureParametersV6Schema.safeParse(parameters).success).toBe(false)
    const feature = featureRecordSchema.parse({
      ...extrusion(),
      type: extrusionFeatureTypeV7.type,
      parameters,
      dependencies: [target.featureId],
    })
    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(readExtrusionFeatureParameters(feature)).toMatchObject({
      endCondition: { kind: "up-to-face", face: { signature: { geometryClass: "SPHERE" } } },
    })
    expect(
      readExtrusionFeatureParameters({ ...feature, type: extrusionFeatureTypeV6.type }),
    ).toBeNull()
    expect(featureBodyDependencies(feature)).toEqual([])
  })
  it("keeps the face-extent-only v7 contract directional and bound to one exact body", () => {
    const parameters = { ...base, endCondition: sphericalEnd() }
    for (const endCondition of [
      { kind: "distance" },
      { kind: "through-all", targetBody: target, sourceContentHash: "a".repeat(64) },
      { kind: "up-to-body", targetBody: target, sourceContentHash: "a".repeat(64) },
      { ...sphericalEnd(), face: { ...sphericalEnd().face, outputRole: "pattern.instance.2" } },
    ])
      expect(
        extrusionFeatureParametersV7Schema.safeParse({ ...parameters, endCondition }).success,
      ).toBe(false)
    for (const invalid of [{ symmetric: true }, { secondDistance: createLengthQuantity(1) }])
      expect(
        extrusionFeatureParametersV7Schema.safeParse({ ...parameters, ...invalid }).success,
      ).toBe(false)
  })
  it.each(["add", "remove", "intersect"] as const)(
    "retains the separate v7 endpoint and consumes only the exact %s target",
    (operation) => {
      const endpoint = {
        ...target,
        featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3410",
        outputRole: "result",
      }
      const feature = featureRecordSchema.parse({
        ...extrusion(),
        type: extrusionFeatureTypeV7.type,
        parameters: {
          ...base,
          operation,
          targetBody: target,
          endCondition: sphericalEnd(endpoint),
        },
        dependencies: [target.featureId, endpoint.featureId],
      })
      expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
      expect(
        registry().validateFeature({
          ...feature,
          dependencies: [...feature.dependencies].reverse(),
        }),
      ).toMatchObject({ ok: false })
      const consumed = { featureId: target.featureId, outputRole: target.outputRole }
      expect(featureBodyDependencies(feature)).toEqual([consumed])
      expect(featureGeometryDependencies(feature)).toEqual([consumed, endpoint])
    },
  )
  it("deduplicates a shared v7 target/end producer without silently changing its body role", () => {
    const parameters = {
      ...base,
      operation: "remove",
      targetBody: target,
      endCondition: sphericalEnd(),
    }
    const feature = featureRecordSchema.parse({
      ...extrusion(),
      type: extrusionFeatureTypeV7.type,
      parameters,
      dependencies: [target.featureId],
    })
    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(featureGeometryDependencies(feature)).toEqual([
      { featureId: target.featureId, outputRole: target.outputRole },
    ])
    expect(
      extrusionFeatureParametersV7Schema.safeParse({
        ...parameters,
        targetBody: { ...target, outputRole: "pattern.instance.2" },
      }).success,
    ).toBe(false)
  })
  it("retains all legacy versions and validates exact modifying body ownership", () => {
    expect(extrusionFeatureParametersV5Schema.safeParse(base).success).toBe(false)
    const feature = featureRecordSchema.parse({
      ...extrusion(),
      type: extrusionFeatureTypeV6.type,
      parameters: { ...base, operation: "remove", targetBody: target },
      dependencies: [target.featureId],
    })
    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(readExtrusionFeatureParameters(feature)).toMatchObject({
      targetBody: target,
      startOffset: { value: -3 },
      draftAngle: { value: (5 * Math.PI) / 180 },
    })
    expect(registry().validateFeature({ ...feature, dependencies: [] })).toMatchObject({
      ok: false,
    })
  })
  it("requires one directional dynamic extent and preserves target-first dependency order", () => {
    const parameters = {
      ...base,
      endCondition: { kind: "up-to-body", targetBody: target, sourceContentHash: "a".repeat(64) },
    }
    const feature = featureRecordSchema.parse({
      ...extrusion(),
      type: extrusionFeatureTypeV6.type,
      parameters,
      dependencies: [target.featureId],
    })
    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(
      extrusionFeatureParametersV6Schema.safeParse({ ...parameters, symmetric: true }).success,
    ).toBe(false)
    expect(
      extrusionFeatureParametersV6Schema.safeParse({
        ...parameters,
        secondDistance: createLengthQuantity(2),
      }).success,
    ).toBe(false)
    expect(
      extrusionFeatureParametersV6Schema.safeParse({
        ...parameters,
        operation: "add",
        targetBody: { ...target, outputRole: "pattern.instance.2" },
      }).success,
    ).toBe(false)
  })
  it("retains the endpoint body and consumes only one selected target output", () => {
    const endpoint = {
      ...target,
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3410",
      outputRole: "result",
    }
    const feature = featureRecordSchema.parse({
      ...extrusion(),
      type: extrusionFeatureTypeV6.type,
      parameters: {
        ...base,
        operation: "remove",
        targetBody: target,
        endCondition: {
          kind: "through-all",
          targetBody: endpoint,
          sourceContentHash: "a".repeat(64),
        },
      },
      dependencies: [target.featureId, endpoint.featureId],
    })
    expect(featureBodyDependencies(feature)).toEqual([
      { featureId: target.featureId, outputRole: target.outputRole },
    ])
    expect(featureGeometryDependencies(feature)).toEqual([
      { featureId: target.featureId, outputRole: target.outputRole },
      endpoint,
    ])
    const kept = { featureId: target.featureId, outputRole: "pattern.instance.0" },
      consumed = { featureId: target.featureId, outputRole: target.outputRole },
      support = { featureId: endpoint.featureId, outputRole: "result" },
      result = { featureId: feature.id, outputRole: "result" }
    expect(
      terminalBodyOutputs(
        [feature],
        new Map([
          [target.featureId, [kept, consumed]],
          [endpoint.featureId, [support]],
          [feature.id, [result]],
        ]),
      ),
    ).toEqual([kept, support, result])
  })
  it("resolves signed offset and draft expressions before evaluating the versioned contract", () => {
    const feature = featureRecordSchema.parse({
      ...extrusion(),
      type: extrusionFeatureTypeV6.type,
      parameters: {
        ...base,
        startOffset: createLengthQuantity(-1, "mm", "-#offset"),
        draftAngle: createAngleQuantity(1, "deg", "#angle"),
      },
    })
    const values = evaluateVariableDefinitions([
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3402",
        name: "offset",
        expression: "4 mm",
      },
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3403",
        name: "angle",
        expression: "10 deg",
      },
    ])
    if (!values.ok) throw new Error("Expected valid variables.")
    expect(registry().resolveFeatureParameters(feature, values.valuesByName)).toMatchObject({
      ok: true,
      feature: { parameters: { startOffset: { value: -4 }, draftAngle: { value: Math.PI / 18 } } },
    })
  })
})
