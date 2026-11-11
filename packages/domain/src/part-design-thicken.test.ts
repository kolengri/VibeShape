import { describe, expect, it } from "bun:test"
import {
  featureBodyDependencies,
  featureBodyDependencyIds,
  terminalFeatureIds,
} from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { featureIdSchema } from "./identifiers"
import { terminalBodyOutputs } from "./model-bodies"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import { partDesignFeatureTypeHandlers } from "./part-design"
import {
  pressPullFeatureType,
  pressPullFeatureTypeHandlerV2,
  pressPullFeatureTypeV2,
  readPressPullFeatureParameters,
} from "./part-design-press-pull"
import {
  readThickenFeatureParameters,
  thickenFeatureParametersSchema,
  thickenFeatureType,
  thickenFeatureTypeHandler,
  thickenPreservesSource,
} from "./part-design-thicken"
import { classifyPartOperation } from "./part-operation"
import { createLengthQuantity } from "./units"
import type { ExpressionValue } from "./variables"

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f5501")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f5502")
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
    geometryClass: "CYLINDRE",
    measure: 314,
    centroid: [index, 0, 5],
    bounds: { min: [-5, -5, 0], max: [5, 5, 10] },
    boundaryCount: 2,
    adjacentGeometryClasses: ["PLANE", "PLANE"],
  },
  ...overrides,
})
function thickenParameters(overrides: object = {}) {
  return {
    targetBody,
    faces: [face(1), face(2)],
    thickness: createLengthQuantity(2, "mm"),
    side: "outward",
    operation: "new",
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
function record(type: typeof thickenFeatureType.type, parameters: unknown, dependencies: string[]) {
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

describe("Thicken feature contract", () => {
  it("accepts 1 to 256 unique faces of the exact target body", () => {
    expect(thickenFeatureParametersSchema.safeParse(thickenParameters()).success).toBe(true)
    const many = Array.from({ length: 256 }, (_, index) => face(index))
    expect(
      thickenFeatureParametersSchema.safeParse(thickenParameters({ faces: many })).success,
    ).toBe(true)
    for (const faces of [
      [],
      [...many, face(999)],
      [face(1), face(1)],
      [face(3, { outputRole: "result" })],
    ])
      expect(thickenFeatureParametersSchema.safeParse(thickenParameters({ faces })).success).toBe(
        false,
      )
  })

  it.each([
    ["side", "outward", true],
    ["side", "inward", true],
    ["side", "symmetric", true],
    ["side", "both", false],
    ["operation", "new", true],
    ["operation", "add", true],
    ["operation", "remove", true],
    ["operation", "intersect", false],
  ] as const)("validates %s %s", (key, value, valid) => {
    expect(
      thickenFeatureParametersSchema.safeParse(thickenParameters({ [key]: value })).success,
    ).toBe(valid)
  })

  it.each([0, -1, 0.0009, 10_000.001])("rejects a %s mm thickness", (value) => {
    expect(
      thickenFeatureParametersSchema.safeParse(
        thickenParameters({ thickness: createLengthQuantity(value, "mm") }),
      ).success,
    ).toBe(false)
  })

  it("resolves thickness expressions and reports invalid values", () => {
    const { parameters: value } = record(
      thickenFeatureType.type,
      thickenParameters({ thickness: createLengthQuantity(1, "mm", "#wall") }),
      [sourceId],
    )
    const resolve = (variables: Map<string, ExpressionValue>) =>
      thickenFeatureTypeHandler.resolveParameters?.(value, variables)
    expect(
      resolve(new Map<string, ExpressionValue>([["wall", { dimension: "length", value: 3 }]])),
    ).toMatchObject({ ok: true, parameters: { thickness: { value: 3 } } })
    expect(resolve(new Map())).toMatchObject({ ok: false })
    expect(
      resolve(new Map<string, ExpressionValue>([["wall", { dimension: "angle", value: 1 }]])),
    ).toMatchObject({ ok: false, diagnostic: { code: "expression-dimension-mismatch" } })
    expect(
      resolve(new Map<string, ExpressionValue>([["wall", { dimension: "length", value: 20_000 }]])),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-thicken-thickness" } })
  })

  it("excludes document UUIDs from content parameters and keeps face order", () => {
    const content = thickenFeatureTypeHandler.contentParameters(
      record(thickenFeatureType.type, thickenParameters({ faces: [face(2), face(1)] }), [sourceId])
        .parameters,
    )
    expect(JSON.stringify(content)).not.toContain(sourceId)
    expect(content).toMatchObject({
      thickness: 2,
      side: "outward",
      operation: "new",
      faces: [{ lineageToken: "face-2" }, { lineageToken: "face-1" }],
    })
  })

  it("keeps the source body for New and modifies it for Add and Remove", () => {
    const types = registry()
    const created = record(thickenFeatureType.type, thickenParameters(), [sourceId])
    expect(types.validateFeature(created)).toMatchObject({ ok: true })
    const otherId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f5503")
    expect(
      types.validateFeature(record(thickenFeatureType.type, thickenParameters(), [otherId])),
    ).toMatchObject({ ok: false })
    expect(thickenPreservesSource(created)).toBe(true)
    expect(featureBodyDependencies(created)).toEqual([{ featureId: sourceId, outputRole }])
    expect(featureBodyDependencyIds(created)).toEqual([])
    expect(classifyPartOperation({ ...created, schemaVersion: 1, semanticInputs: [] })).toEqual({
      kind: "new",
    })
    const source = { featureId: sourceId, outputRole }
    const result = { featureId, outputRole: "result" }
    const outputs = new Map([
      [sourceId, [source]],
      [featureId, [result]],
    ])
    expect(terminalBodyOutputs([created], outputs)).toEqual([source, result])
    for (const operation of ["add", "remove"] as const) {
      const modifying = record(thickenFeatureType.type, thickenParameters({ operation }), [
        sourceId,
      ])
      expect(thickenPreservesSource(modifying)).toBe(false)
      expect(featureBodyDependencyIds(modifying)).toEqual([sourceId])
      expect(terminalFeatureIds([modifying])).toEqual(new Set([featureId]))
      expect(classifyPartOperation({ ...modifying, schemaVersion: 1, semanticInputs: [] })).toEqual(
        { kind: "modify", target: targetBody, consumed: [] },
      )
      expect(terminalBodyOutputs([modifying], outputs)).toEqual([result])
    }
    expect(readThickenFeatureParameters(created)?.faces).toHaveLength(2)
    expect(
      readThickenFeatureParameters({ ...created, type: { ...created.type, schemaVersion: 2 } }),
    ).toBeNull()
  })
})

describe("Press Pull version compatibility", () => {
  const curved = {
    targetBody,
    face: face(1),
    sourceContentHash: "a".repeat(64),
    distance: createLengthQuantity(1, "mm"),
  }
  const planar = {
    ...curved,
    face: face(1, { signature: { ...face(1).signature, geometryClass: "PLANE" } }),
  }

  it("keeps version 1 planar-only and accepts curved faces in version 2", () => {
    const v1 = record(pressPullFeatureType.type, planar, [sourceId])
    expect(readPressPullFeatureParameters(v1)).not.toBeNull()
    expect(readPressPullFeatureParameters({ ...v1, parameters: curved })).toBeNull()
    const v2 = record(pressPullFeatureTypeV2.type, curved, [sourceId])
    expect(readPressPullFeatureParameters(v2)?.face.signature.geometryClass).toBe("CYLINDRE")
    expect(readPressPullFeatureParameters({ ...v2, parameters: planar })).not.toBeNull()
    const types = registry()
    expect(types.validateFeature(v1)).toMatchObject({ ok: true })
    expect(types.validateFeature(v2)).toMatchObject({ ok: true })
    expect(classifyPartOperation({ ...v2, schemaVersion: 1, semanticInputs: [] })).toEqual({
      kind: "modify",
      target: targetBody,
      consumed: [],
    })
    expect(pressPullFeatureTypeHandlerV2.contentParameters(curved)).toMatchObject({
      distance: 1,
      face: { lineageToken: "face-1" },
    })
  })
})
