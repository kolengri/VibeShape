import { describe, expect, it } from "bun:test"
import { featureBodyDependencies, featureBodyDependencyIds } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { featureIdSchema } from "./identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import { partDesignFeatureTypeHandlers } from "./part-design"
import {
  draftFeatureParametersSchema,
  draftFeatureType,
  draftFeatureTypeHandler,
  readDraftFeatureParameters,
} from "./part-design-draft"
import {
  readScaleFeatureParameters,
  scaleFeatureParametersSchema,
  scaleFeatureType,
  scaleFeatureTypeHandler,
} from "./part-design-scale"
import { classifyPartOperation } from "./part-operation"
import { createAngleQuantity, createLengthQuantity, createScalarQuantity } from "./units"
import type { ExpressionValue } from "./variables"

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3402")
const datumId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3404")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3403")
const outputRole = "pattern.instance.1"
const targetBody = { schemaVersion: 0 as const, featureId: sourceId, outputRole }
const face = (index: number, overrides: object = {}) => ({
  schemaVersion: 1,
  featureId: sourceId,
  outputRole,
  kind: "face",
  lineageToken: `face-${index}`,
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 200,
    centroid: [index, 0, 5],
    bounds: { min: [0, 0, 0], max: [20, 0, 10] },
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE", "PLANE", "PLANE", "PLANE"],
    direction: [1, 0, 0],
    directionMode: "oriented",
  },
  ...overrides,
})
function draftParameters(overrides: object = {}) {
  return {
    targetBody,
    faces: [face(1), face(2)],
    neutralPlane: { kind: "origin-plane", plane: "XY" },
    angle: createAngleQuantity(5, "deg"),
    flip: false,
    ...overrides,
  }
}
function scaleParameters(overrides: object = {}) {
  return {
    targetBody,
    factor: createScalarQuantity(2),
    center: { kind: "origin" },
    ...overrides,
  }
}
function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}
function record(type: typeof draftFeatureType.type, parameters: unknown, dependencies: string[]) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type,
    parameters,
    dependencies,
    references: [],
    suppressed: false,
  })
}

describe("Draft feature contract", () => {
  it("accepts 1 to 256 unique faces of one exact named body", () => {
    expect(draftFeatureParametersSchema.safeParse(draftParameters()).success).toBe(true)
    const many = Array.from({ length: 256 }, (_, index) => face(index))
    expect(draftFeatureParametersSchema.safeParse(draftParameters({ faces: many })).success).toBe(
      true,
    )
    for (const faces of [[], [...many, face(999)], [face(1), face(1)]])
      expect(draftFeatureParametersSchema.safeParse(draftParameters({ faces })).success).toBe(false)
  })

  it("rejects faces and neutral faces outside the target body and drafting the neutral face", () => {
    const foreign = face(3, { outputRole: "result" })
    expect(
      draftFeatureParametersSchema.safeParse(draftParameters({ faces: [foreign] })).success,
    ).toBe(false)
    const neutral = (reference: object) =>
      draftParameters({ neutralPlane: { kind: "planar-face", reference } })
    expect(draftFeatureParametersSchema.safeParse(neutral(face(9))).success).toBe(true)
    expect(draftFeatureParametersSchema.safeParse(neutral(face(1))).success).toBe(false)
    expect(
      draftFeatureParametersSchema.safeParse(neutral(face(9, { featureId: datumId }))).success,
    ).toBe(false)
  })

  it.each([0, 0.005, 89, 90, -5])("rejects a %s degree angle", (degrees) => {
    expect(
      draftFeatureParametersSchema.safeParse(
        draftParameters({ angle: createAngleQuantity(degrees, "deg") }),
      ).success,
    ).toBe(false)
  })

  it("validates ordered target and datum-plane support dependencies", () => {
    const types = registry()
    const origin = record(draftFeatureType.type, draftParameters(), [sourceId])
    expect(types.validateFeature(origin)).toMatchObject({ ok: true })
    const datum = draftParameters({ neutralPlane: { kind: "datum-plane", featureId: datumId } })
    expect(
      types.validateFeature(record(draftFeatureType.type, datum, [sourceId, datumId])),
    ).toMatchObject({ ok: true })
    expect(types.validateFeature(record(draftFeatureType.type, datum, [sourceId]))).toMatchObject({
      ok: false,
    })
    expect(featureBodyDependencies(origin)).toEqual([{ featureId: sourceId, outputRole }])
    expect(
      featureBodyDependencyIds(record(draftFeatureType.type, datum, [sourceId, datumId])),
    ).toEqual([sourceId])
    expect(classifyPartOperation({ ...origin, schemaVersion: 1, semanticInputs: [] })).toEqual({
      kind: "modify",
      target: targetBody,
      consumed: [],
    })
    expect(readDraftFeatureParameters(origin)?.faces).toHaveLength(2)
    expect(
      readDraftFeatureParameters({ ...origin, type: { ...origin.type, schemaVersion: 2 } }),
    ).toBeNull()
  })

  it("resolves angle expressions and reports wrong dimensions and out-of-range values", () => {
    const { parameters: value } = record(
      draftFeatureType.type,
      draftParameters({ angle: createAngleQuantity(1, "deg", "#taper") }),
      [sourceId],
    )
    const resolve = (variables: Map<string, ExpressionValue>) =>
      draftFeatureTypeHandler.resolveParameters?.(value, variables)
    expect(
      resolve(
        new Map<string, ExpressionValue>([["taper", { dimension: "angle", value: Math.PI / 36 }]]),
      ),
    ).toMatchObject({ ok: true, parameters: { angle: { value: Math.PI / 36 } } })
    expect(resolve(new Map())).toMatchObject({ ok: false })
    expect(
      resolve(new Map<string, ExpressionValue>([["taper", { dimension: "length", value: 3 }]])),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "expression-dimension-mismatch" },
    })
    expect(
      resolve(new Map<string, ExpressionValue>([["taper", { dimension: "angle", value: 1.6 }]])),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-draft-angle" },
    })
    // 0.005 degrees is below the minimum OCCT actually applies.
    expect(
      resolve(
        new Map<string, ExpressionValue>([
          ["taper", { dimension: "angle", value: (0.005 * Math.PI) / 180 }],
        ]),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-draft-angle",
        issues: [
          { message: "The angle must resolve to at least 0.01 degrees and less than 89 degrees." },
        ],
      },
    })
  })

  it("excludes document UUIDs from content parameters", () => {
    const content = draftFeatureTypeHandler.contentParameters(
      record(
        draftFeatureType.type,
        draftParameters({ neutralPlane: { kind: "planar-face", reference: face(9) } }),
        [sourceId],
      ).parameters,
    )
    expect(JSON.stringify(content)).not.toContain(sourceId)
    expect(content).toMatchObject({ angle: (5 * Math.PI) / 180, flip: false })
  })
})

describe("Scale feature contract", () => {
  it("bounds the factor and explicit center coordinates", () => {
    expect(scaleFeatureParametersSchema.safeParse(scaleParameters()).success).toBe(true)
    for (const factor of [0.001, 1000])
      expect(
        scaleFeatureParametersSchema.safeParse(
          scaleParameters({ factor: createScalarQuantity(factor) }),
        ).success,
      ).toBe(true)
    for (const factor of [0, 0.0009, 1000.5, -2])
      expect(
        scaleFeatureParametersSchema.safeParse(
          scaleParameters({ factor: createScalarQuantity(factor) }),
        ).success,
      ).toBe(false)
    const point = (x: number) => ({
      kind: "point",
      point: { x: createLengthQuantity(x), y: createLengthQuantity(0), z: createLengthQuantity(0) },
    })
    expect(
      scaleFeatureParametersSchema.safeParse(scaleParameters({ center: point(5) })).success,
    ).toBe(true)
    expect(
      scaleFeatureParametersSchema.safeParse(scaleParameters({ center: point(100_001) })).success,
    ).toBe(false)
  })

  it("owns exactly one target dependency and modifies that body", () => {
    const types = registry()
    const feature = record(scaleFeatureType.type, scaleParameters(), [sourceId])
    expect(types.validateFeature(feature)).toMatchObject({ ok: true })
    expect(types.validateFeature({ ...feature, dependencies: [datumId] })).toMatchObject({
      ok: false,
    })
    expect(readScaleFeatureParameters(feature)?.center.kind).toBe("origin")
    expect(featureBodyDependencies(feature)).toEqual([{ featureId: sourceId, outputRole }])
    expect(
      classifyPartOperation({ ...feature, schemaVersion: 1, semanticInputs: [] }),
    ).toMatchObject({ kind: "modify", target: targetBody })
  })

  it("resolves factor and point expressions and rejects resolved overflow", () => {
    const value = scaleFeatureParametersSchema.parse(
      scaleParameters({
        factor: createScalarQuantity(1, "#ratio"),
        center: {
          kind: "point",
          point: {
            x: createLengthQuantity(0, "mm", "#offset"),
            y: createLengthQuantity(0),
            z: createLengthQuantity(0),
          },
        },
      }),
    )
    const resolve = (variables: Map<string, ExpressionValue>) =>
      scaleFeatureTypeHandler.resolveParameters?.(value, variables)
    expect(
      resolve(
        new Map<string, ExpressionValue>([
          ["ratio", { dimension: "scalar", value: 2.5 }],
          ["offset", { dimension: "length", value: 12 }],
        ]),
      ),
    ).toMatchObject({
      ok: true,
      parameters: { factor: { value: 2.5 }, center: { point: { x: { value: 12 } } } },
    })
    expect(
      resolve(
        new Map<string, ExpressionValue>([
          ["ratio", { dimension: "scalar", value: 5000 }],
          ["offset", { dimension: "length", value: 12 }],
        ]),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-scale-bound" } })
    expect(
      resolve(new Map<string, ExpressionValue>([["ratio", { dimension: "length", value: 2 }]])),
    ).toMatchObject({ ok: false })
  })

  it("projects canonical content parameters without the body identity", () => {
    const content = scaleFeatureTypeHandler.contentParameters(
      scaleFeatureParametersSchema.parse(
        scaleParameters({
          center: {
            kind: "point",
            point: {
              x: createLengthQuantity(1, "cm"),
              y: createLengthQuantity(2),
              z: createLengthQuantity(3),
            },
          },
        }),
      ),
    )
    expect(content).toEqual({ factor: 2, center: { kind: "point", point: [10, 2, 3] } })
  })
})
