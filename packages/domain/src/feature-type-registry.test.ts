import { describe, expect, it } from "vitest"
import { z } from "zod"
import { type FeatureRecord, featureRecordSchema, featureTypeSchema } from "./feature-graph"
import { featureTypeKey } from "./feature-type-contracts"
import { createFeatureTypeRegistry, type TrustedFeatureTypeHandler } from "./feature-type-registry"
import { featureIdSchema } from "./identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  booleanFeatureType,
  boxFeatureParametersSchema,
  boxFeatureType,
  extrusionFeatureType,
  partDesignFeatureTypeHandlers,
  revolveFeatureType,
} from "./part-design"
import { createLengthQuantity } from "./units"
import { evaluateVariableDefinitions } from "./variables"

const featureIds = {
  box: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101"),
  dependency: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102"),
  tool: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3103"),
  boolean: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3104"),
} as const

function modules() {
  const result = createModuleRegistry([partDesignModule, featureCoreModule, documentCoreModule])

  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.registry
}

function feature(
  parameters: Record<string, unknown>,
  values: Partial<FeatureRecord> = {},
): FeatureRecord {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureIds.box,
    type: boxFeatureType.type,
    parameters,
    dependencies: [],
    references: [],
    suppressed: false,
    ...values,
  })
}

function boxParameters() {
  return {
    width: createLengthQuantity(20),
    depth: createLengthQuantity(30),
    height: createLengthQuantity(1, "in"),
    centered: true,
    origin: {
      x: createLengthQuantity(5),
      y: createLengthQuantity(-3),
      z: createLengthQuantity(10),
    },
  }
}

function booleanFeature(dependencies = [featureIds.dependency, featureIds.tool]) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureIds.boolean,
    type: booleanFeatureType.type,
    parameters: { operation: "subtract" },
    dependencies,
    references: [],
    suppressed: false,
  })
}

function registry(handlers: readonly TrustedFeatureTypeHandler[] = partDesignFeatureTypeHandlers) {
  return createFeatureTypeRegistry(modules(), handlers)
}

describe("feature type registry", () => {
  it("validates unit-aware primitive parameters through their owning module", () => {
    const result = registry()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const validated = result.registry.validateFeature(feature(boxParameters()))

    expect(validated.ok).toBe(true)
    if (validated.ok) {
      expect(validated.descriptor).toEqual(boxFeatureType)
      expect(validated.feature.parameters).toEqual(boxParameters())
      expect(validated.contentParameters).toEqual({
        width: 20,
        depth: 30,
        height: 25.4,
        centered: true,
        origin: [5, -3, 10],
      })
      expect(result.registry.getDescriptor(boxFeatureType.type)).toEqual(boxFeatureType)
      expect(result.registry.descriptors).toHaveLength(13)
      expect(
        result.registry.descriptors
          .filter(({ type }) => type.typeId === extrusionFeatureType.type.typeId)
          .map(({ type }) => type.schemaVersion),
      ).toEqual([1, 2, 3, 4])
      expect(
        result.registry.descriptors
          .filter(({ type }) => type.typeId === revolveFeatureType.type.typeId)
          .map(({ type }) => type.schemaVersion),
      ).toEqual([1, 2, 3, 4, 5, 6])
    }
  })

  it("resolves registered quantity expressions without rewriting their authored source", () => {
    const result = registry()
    const variables = evaluateVariableDefinitions([
      {
        schemaVersion: 0,
        id: "0195b5ac-b240-7a2c-8c33-67a36a7f21ac",
        name: "width",
        expression: "24 mm",
      },
    ])
    expect(result.ok).toBe(true)
    expect(variables.ok).toBe(true)
    if (!result.ok || !variables.ok) return

    const authored = feature({
      ...boxParameters(),
      width: createLengthQuantity(20, "mm", "#width"),
      depth: createLengthQuantity(10, "mm", "#width / 2"),
      origin: {
        ...boxParameters().origin,
        x: createLengthQuantity(5, "mm", "#width"),
      },
    })
    const resolved = result.registry.resolveFeatureParameters(authored, variables.valuesByName)

    expect(resolved).toMatchObject({
      ok: true,
      feature: {
        parameters: {
          width: { value: 24, source: { value: 24, expression: "#width" } },
          depth: { value: 12, source: { value: 12, expression: "#width / 2" } },
          origin: { x: { value: 24, source: { value: 24, expression: "#width" } } },
        },
      },
    })
    expect(authored.parameters).toMatchObject({ width: { value: 20 }, depth: { value: 10 } })
  })

  it("defaults legacy primitive placement to the world origin", () => {
    const result = registry()
    if (!result.ok) throw new Error("Expected a valid registry fixture.")
    const parameters = boxParameters()
    const legacy = feature({
      width: parameters.width,
      depth: parameters.depth,
      height: parameters.height,
      centered: parameters.centered,
    })

    expect(result.registry.validateFeature(legacy)).toMatchObject({
      ok: true,
      feature: {
        parameters: {
          origin: { x: { value: 0 }, y: { value: 0 }, z: { value: 0 } },
        },
      },
      contentParameters: { origin: [0, 0, 0] },
    })
  })

  it("returns bounded diagnostics for missing or dimensionally invalid parameter variables", () => {
    const result = registry()
    const variables = evaluateVariableDefinitions([])
    if (!result.ok || !variables.ok) throw new Error("Expected a valid registry fixture.")

    expect(
      result.registry.resolveFeatureParameters(
        feature({ ...boxParameters(), width: createLengthQuantity(20, "mm", "#missing") }),
        variables.valuesByName,
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature-expression",
        issues: [{ path: "parameters.width", message: expect.stringContaining("#missing") }],
      },
    })
    expect(
      result.registry.resolveFeatureParameters(
        feature({ ...boxParameters(), width: createLengthQuantity(20, "mm", "2") }),
        variables.valuesByName,
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { issues: [{ path: "parameters.width" }] },
    })
  })

  it("rejects invalid parameter values and primitive dependency cardinality", () => {
    const result = registry()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(
      result.registry.validateFeature(
        feature({ ...boxParameters(), width: createLengthQuantity(0) }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-parameters", issues: [{ path: "parameters.width" }] },
    })
    expect(
      result.registry.validateFeature(
        feature({
          ...boxParameters(),
          origin: {
            ...boxParameters().origin,
            x: createLengthQuantity(100_001),
          },
        }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature-parameters",
        issues: [{ path: "parameters.origin.x" }],
      },
    })
    expect(
      result.registry.validateFeature(
        feature(boxParameters(), { dependencies: [featureIds.dependency] }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-dependency-count" },
    })
  })

  it("validates Boolean subtraction as an ordered two-input feature", () => {
    const result = registry()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.registry.validateFeature(booleanFeature())).toMatchObject({
      ok: true,
      descriptor: booleanFeatureType,
      contentParameters: { operation: "subtract" },
    })
    expect(result.registry.validateFeature(booleanFeature([featureIds.dependency]))).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-dependency-count" },
    })
  })

  it("classifies structurally valid unknown types as unavailable without rewriting them", () => {
    const result = registry()
    const unknown = featureRecordSchema.parse({
      ...feature(boxParameters()),
      type: {
        moduleId: "org.example.custom-features",
        moduleVersion: "1.0.0",
        typeId: "org.example.feature.threaded-insert",
        schemaVersion: 1,
      },
      parameters: { pitch: 1.5 },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.registry.validateFeature(unknown)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "feature-type-unavailable",
          message: expect.stringContaining("org.example.feature.threaded-insert"),
        },
      })
      expect(featureRecordSchema.parse(unknown)).toEqual(unknown)
    }
  })

  it("rejects missing, duplicate, orphaned, and malformed trusted handlers", () => {
    const first = partDesignFeatureTypeHandlers[0]

    if (!first) throw new Error("The part design fixture must expose a handler.")

    expect(registry(partDesignFeatureTypeHandlers.slice(0, 1))).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-feature-type-handler" },
    })
    expect(registry([...partDesignFeatureTypeHandlers, first])).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-feature-type-handler" },
    })
    expect(
      registry([
        ...partDesignFeatureTypeHandlers,
        {
          type: featureTypeSchema.parse({
            moduleId: "org.example.custom-features",
            moduleVersion: "1.0.0",
            typeId: "org.example.feature.custom",
            schemaVersion: 1,
          }),
          parametersSchema: z.object({}).strict(),
          contentParameters: () => ({}),
        },
      ]),
    ).toMatchObject({ ok: false, diagnostic: { code: "orphan-feature-type-handler" } })
    expect(
      registry([
        {
          ...first,
          parametersSchema: {},
        } as unknown as TrustedFeatureTypeHandler,
        ...partDesignFeatureTypeHandlers.slice(1),
      ]),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-type-handler" } })
  })

  it("contains trusted schema transforms that return non-JSON parameter objects", () => {
    const boxHandler = partDesignFeatureTypeHandlers[0]
    if (!boxHandler) throw new Error("The part design fixture must expose every handler.")

    const malformed: TrustedFeatureTypeHandler = {
      ...boxHandler,
      parametersSchema: boxFeatureParametersSchema.transform(() => new Date(0)),
    }
    const result = registry([malformed, ...partDesignFeatureTypeHandlers.slice(1)])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.registry.validateFeature(feature(boxParameters()))).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      })
    }
  })

  it("contains trusted parameter normalizer exceptions as stable diagnostics", () => {
    const boxHandler = partDesignFeatureTypeHandlers[0]
    if (!boxHandler) throw new Error("The part design fixture must expose every handler.")

    const throwing: TrustedFeatureTypeHandler = {
      ...boxHandler,
      parametersSchema: z.unknown().transform(() => {
        throw new Error("fixture detail")
      }),
    }
    const result = registry([throwing, ...partDesignFeatureTypeHandlers.slice(1)])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(() => result.registry.validateFeature(feature(boxParameters()))).not.toThrow()
      expect(result.registry.validateFeature(feature(boxParameters()))).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-feature-parameters",
          message: "The trusted feature parameter normalizer failed.",
        },
      })
    }
  })

  it("contains invalid and throwing content normalizers as stable diagnostics", () => {
    const boxHandler = partDesignFeatureTypeHandlers[0]
    if (!boxHandler) throw new Error("The part design fixture must expose every handler.")

    const invalid = registry([
      { ...boxHandler, contentParameters: () => new Date(0) },
      ...partDesignFeatureTypeHandlers.slice(1),
    ])
    expect(invalid.ok).toBe(true)
    if (invalid.ok) {
      expect(invalid.registry.validateFeature(feature(boxParameters()))).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-content-parameters" },
      })
    }

    const throwing = registry([
      {
        ...boxHandler,
        contentParameters() {
          throw new Error("fixture detail")
        },
      },
      ...partDesignFeatureTypeHandlers.slice(1),
    ])
    expect(throwing.ok).toBe(true)
    if (throwing.ok) {
      expect(() => throwing.registry.validateFeature(feature(boxParameters()))).not.toThrow()
      expect(throwing.registry.validateFeature(feature(boxParameters()))).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-content-parameters" },
      })
    }
  })

  it("uses exact module, version, type, and schema identity", () => {
    expect(featureTypeKey(boxFeatureType.type)).toBe(
      "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.box#1",
    )
  })
})
