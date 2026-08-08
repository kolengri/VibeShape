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
  cylinderFeatureType,
  partDesignFeatureTypeHandlers,
} from "./part-design"
import { createLengthQuantity } from "./units"

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
      })
      expect(result.registry.getDescriptor(boxFeatureType.type)).toEqual(boxFeatureType)
      expect(result.registry.descriptors.map(({ type }) => type.typeId)).toEqual([
        booleanFeatureType.type.typeId,
        boxFeatureType.type.typeId,
        cylinderFeatureType.type.typeId,
      ])
    }
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
    const cylinderHandler = partDesignFeatureTypeHandlers[1]
    const booleanHandler = partDesignFeatureTypeHandlers[2]
    if (!boxHandler || !cylinderHandler || !booleanHandler) {
      throw new Error("The part design fixture must expose every handler.")
    }

    const malformed: TrustedFeatureTypeHandler = {
      ...boxHandler,
      parametersSchema: boxFeatureParametersSchema.transform(() => new Date(0)),
    }
    const result = registry([malformed, cylinderHandler, booleanHandler])

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
    const cylinderHandler = partDesignFeatureTypeHandlers[1]
    const booleanHandler = partDesignFeatureTypeHandlers[2]
    if (!boxHandler || !cylinderHandler || !booleanHandler) {
      throw new Error("The part design fixture must expose every handler.")
    }

    const throwing: TrustedFeatureTypeHandler = {
      ...boxHandler,
      parametersSchema: z.unknown().transform(() => {
        throw new Error("fixture detail")
      }),
    }
    const result = registry([throwing, cylinderHandler, booleanHandler])

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
    const [boxHandler, cylinderHandler, booleanHandler] = partDesignFeatureTypeHandlers
    if (!boxHandler || !cylinderHandler || !booleanHandler) {
      throw new Error("The part design fixture must expose every handler.")
    }

    const invalid = registry([
      { ...boxHandler, contentParameters: () => new Date(0) },
      cylinderHandler,
      booleanHandler,
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
      cylinderHandler,
      booleanHandler,
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
