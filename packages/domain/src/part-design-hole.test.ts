import { describe, expect, it } from "vitest"
import { featureRecordSchema } from "./feature-graph"
import { featureIdSchema } from "./identifiers"
import {
  expectedHoleDependencyIds,
  holeFeatureParametersSchema,
  holeFeatureType,
  holeFeatureTypeHandler,
  holeFeatureTypeHandlerV2,
  holeFeatureTypeV2,
  readHoleBodyTarget,
  readHoleFeatureParameters,
} from "./part-design-hole"
import { topoRefSchema } from "./topology"
import { createLengthQuantity } from "./units"
import { evaluateVariableDefinitions } from "./variables"

const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const pointA = "0195b5ac-b220-7a2c-8c33-67a36a7f3211"
const pointB = "0195b5ac-b220-7a2c-8c33-67a36a7f3212"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3301"
const targetId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3302")
const supportId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3303")

function parameters(overrides: Record<string, unknown> = {}) {
  return {
    sketchId,
    pointIds: [pointB, pointA],
    diameter: createLengthQuantity(8, "mm", "#diameter"),
    direction: "forward" as const,
    extent: "blind" as const,
    depth: createLengthQuantity(12, "mm", "#depth"),
    ...overrides,
  }
}

function feature(overrides: Record<string, unknown> = {}) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: holeFeatureType.type,
    parameters: parameters(),
    dependencies: [],
    references: [],
    suppressed: false,
    ...overrides,
  })
}

function supportReference(owner: string) {
  return topoRefSchema.parse({
    schemaVersion: 0,
    featureId: owner,
    kind: "face",
    semanticRole: "support.face",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 1,
      centroid: [0, 0, 0],
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      boundaryCount: 4,
      adjacentGeometryClasses: [],
    },
  })
}

describe("sketch-point hole contract", () => {
  it("canonicalizes point IDs and accepts blind and through-all extents", () => {
    const parsed = holeFeatureParametersSchema.parse(parameters())
    expect(parsed.pointIds).toEqual([pointA, pointB])
    expect(
      holeFeatureParametersSchema.parse({
        ...(({ depth: _, ...rest }) => rest)(parameters()),
        extent: "through-all",
      }).extent,
    ).toEqual("through-all")
  })

  it("rejects duplicate points, invalid bounds, and a depth on through-all", () => {
    expect(
      holeFeatureParametersSchema.safeParse({ ...parameters(), pointIds: [pointA, pointA] })
        .success,
    ).toBe(false)
    expect(
      holeFeatureParametersSchema.safeParse({
        ...parameters(),
        diameter: createLengthQuantity(1_000_001),
      }).success,
    ).toBe(false)
    expect(
      holeFeatureParametersSchema.safeParse({
        ...parameters(),
        extent: "through-all",
        depth: createLengthQuantity(4),
      }).success,
    ).toBe(false)
    expect(holeFeatureParametersSchema.safeParse({ ...parameters(), pointIds: [] }).success).toBe(
      false,
    )
    expect(
      holeFeatureParametersSchema.safeParse({
        ...parameters(),
        pointIds: Array.from(
          { length: 257 },
          (_, index) =>
            `0195b5ac-b220-7a2c-8c33-67a36a${(4000 + index).toString(16).padStart(6, "0")}`,
        ),
      }).success,
    ).toBe(false)
    expect(
      holeFeatureParametersSchema.safeParse({
        ...parameters(),
        diameter: createLengthQuantity(0),
      }).success,
    ).toBe(false)
    expect(
      holeFeatureParametersSchema.safeParse({
        ...parameters(),
        depth: createLengthQuantity(-1),
      }).success,
    ).toBe(false)
    expect(
      holeFeatureParametersSchema.safeParse({ ...parameters(), direction: "sideways" }).success,
    ).toBe(false)
  })

  it("requires an exact feature type when reading parameters", () => {
    expect(readHoleFeatureParameters(feature())).not.toBeNull()
    expect(
      readHoleFeatureParameters(
        feature({
          type: holeFeatureTypeV2.type,
          parameters: {
            ...parameters(),
            targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "result" },
          },
        }),
      ),
    ).not.toBeNull()
    expect(
      readHoleFeatureParameters(
        feature({ type: { ...holeFeatureType.type, moduleVersion: "0.2.0" } }),
      ),
    ).toBeNull()
    expect(
      readHoleFeatureParameters(
        feature({ type: { ...holeFeatureType.type, moduleId: "org.vibeshape.other" } }),
      ),
    ).toBeNull()
  })

  it("resolves length expressions and rejects unknown variables and dimensions", () => {
    const variables = evaluateVariableDefinitions([
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3401",
        name: "diameter",
        expression: "8 mm",
      },
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3402",
        name: "depth",
        expression: "12 mm",
      },
    ])
    expect(variables.ok).toBe(true)
    if (!variables.ok) return
    const resolved = holeFeatureTypeHandler.resolveParameters?.(
      parameters(),
      variables.valuesByName,
    )
    expect(resolved).toMatchObject({ ok: true })
    expect(holeFeatureTypeHandler.contentParameters(parameters())).toMatchObject({
      diameter: 8,
      depth: 12,
      extent: "blind",
      pointIds: [pointA, pointB],
    })
    expect(
      holeFeatureTypeHandler.resolveParameters?.(
        parameters({ diameter: createLengthQuantity(8, "mm", "#missing") }),
        variables.valuesByName,
      ),
    ).toMatchObject({ ok: false })
    expect(
      holeFeatureTypeHandler.resolveParameters?.(
        parameters({ diameter: createLengthQuantity(8, "mm", "-1 mm") }),
        variables.valuesByName,
      ),
    ).toMatchObject({ ok: false })
    expect(
      holeFeatureTypeHandler.resolveParameters?.(
        parameters({ diameter: createLengthQuantity(8, "mm", "1000001 mm") }),
        variables.valuesByName,
      ),
    ).toMatchObject({ ok: false })
    const authored = parameters()
    const failed = holeFeatureTypeHandler.resolveParameters?.(
      authored,
      new Map([["depth", { dimension: "angle" as const, value: 1 }]]),
    )
    expect(failed).toMatchObject({ ok: false })
    expect(authored).toEqual(parameters())
    expect(
      holeFeatureTypeHandler.resolveParameters?.(
        parameters({ diameter: createLengthQuantity(8, "mm", "90 deg") }),
        variables.valuesByName,
      ),
    ).toMatchObject({ ok: false })
  })

  it("orders target and distinct support dependencies", () => {
    expect(expectedHoleDependencyIds(targetId, supportId)).toEqual([targetId, supportId])
    expect(expectedHoleDependencyIds(targetId, targetId)).toEqual([targetId])
    expect(holeFeatureTypeHandler.validateFeature?.(feature({ dependencies: [] }))).toMatchObject([
      { path: "dependencies" },
    ])
    expect(holeFeatureTypeHandler.validateFeature?.(feature({ dependencies: [targetId] }))).toEqual(
      [],
    )
    expect(
      holeFeatureTypeHandler.validateFeature?.(feature({ dependencies: [supportId, targetId] })),
    ).toMatchObject([{ path: "dependencies" }])
  })

  it("validates version 2 body targets and keeps target roles out of content parameters", () => {
    const targetBody = {
      schemaVersion: 0 as const,
      featureId: targetId,
      outputRole: "pattern.instance.1",
    }
    const v2 = feature({
      type: holeFeatureTypeV2.type,
      parameters: { ...parameters(), targetBody },
      dependencies: [targetId],
    })
    expect(readHoleBodyTarget(v2)).toEqual(targetBody)
    const throughAllParameters = (({ depth: _, ...rest }) => rest)({
      ...parameters({ extent: "through-all" }),
      targetBody,
    })
    const throughAll = feature({
      type: holeFeatureTypeV2.type,
      parameters: throughAllParameters,
      dependencies: [targetId],
    })
    expect(readHoleBodyTarget(throughAll)).toEqual(targetBody)
    expect(holeFeatureTypeHandlerV2.validateFeature?.(throughAll)).toEqual([])
    expect(holeFeatureTypeHandlerV2.validateFeature?.(v2)).toEqual([])
    expect(holeFeatureTypeHandlerV2.contentParameters(v2.parameters)).not.toHaveProperty(
      "targetBody",
    )
    expect(
      holeFeatureTypeHandlerV2.validateFeature?.(
        feature({
          type: holeFeatureTypeV2.type,
          parameters: { ...parameters(), targetBody: { ...targetBody, featureId: supportId } },
          dependencies: [targetId],
        }),
      ),
    ).toMatchObject([{ path: "parameters.targetBody.featureId" }])
    expect(
      holeFeatureTypeHandlerV2.validateFeature?.({
        ...v2,
        references: [supportReference(targetId)],
      }),
    ).toMatchObject([{ path: "parameters.targetBody.outputRole" }])
  })

  it("rejects malformed body roles and resolves version 2 expressions", () => {
    expect(
      holeFeatureTypeV2.type &&
        holeFeatureTypeHandlerV2.parametersSchema.safeParse({
          ...parameters(),
          targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "Bad Role" },
        }).success,
    ).toBe(false)
    const variables = evaluateVariableDefinitions([
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3401",
        name: "diameter",
        expression: "8 mm",
      },
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3402",
        name: "depth",
        expression: "12 mm",
      },
    ])
    if (!variables.ok) return
    expect(
      holeFeatureTypeHandlerV2.resolveParameters?.(
        {
          ...parameters({ diameter: createLengthQuantity(8, "mm", "#diameter") }),
          targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "result" },
        },
        variables.valuesByName,
      ),
    ).toMatchObject({ ok: true })
  })
})
