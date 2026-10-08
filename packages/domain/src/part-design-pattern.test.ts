import { describe, expect, it } from "bun:test"
import { bodyOutputRoleSchema } from "./body-reference"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  patternFeatureParametersSchema,
  patternFeatureType,
  patternFeatureTypeHandler,
  patternInstanceOutputRole,
  patternOutputRoles,
  readPatternFeatureParameters,
} from "./part-design-pattern"
import { createAngleQuantity, createLengthQuantity, createScalarQuantity } from "./units"
import type { ExpressionValue } from "./variables"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f7a01"
const patternId = "0195b5ac-b220-7a2c-8c33-67a36a7f7a02"
const targetBody = { schemaVersion: 0, featureId: sourceId, outputRole: "body.primary" }
const linear = {
  targetBody,
  kind: "linear",
  axis: "Y",
  count: createScalarQuantity(4),
  spacing: createLengthQuantity(-2, "cm"),
}
const circular = {
  targetBody,
  kind: "circular",
  axis: "Z",
  count: createScalarQuantity(4),
  angle: createAngleQuantity(360, "deg"),
  center: {
    x: createLengthQuantity(1, "cm"),
    y: createLengthQuantity(-2),
    z: createLengthQuantity(0),
  },
}
function feature(parameters = linear) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: patternId,
    type: patternFeatureType.type,
    parameters,
    dependencies: [sourceId],
    references: [],
    suppressed: false,
  })
}
function registry() {
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    { ...partDesignModule, featureTypes: [patternFeatureType] },
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, [patternFeatureTypeHandler])
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}

describe("exact-body pattern intent", () => {
  it("validates a sole exact dependency and canonical numeric content", () => {
    const types = registry()
    expect(types.validateFeature(feature())).toMatchObject({
      ok: true,
      contentParameters: { kind: "linear", count: 4, axis: "Y", spacing: -20 },
    })
    expect(types.validateFeature({ ...feature(), parameters: circular })).toMatchObject({
      ok: true,
      contentParameters: {
        kind: "circular",
        count: 4,
        axis: "Z",
        angle: 2 * Math.PI,
        center: [10, -2, 0],
      },
    })
    expect(types.validateFeature({ ...feature(), dependencies: [patternId] }).ok).toBe(false)
    expect(types.validateFeature({ ...feature(), dependencies: [sourceId, patternId] }).ok).toBe(
      false,
    )
    expect(readPatternFeatureParameters(feature())?.targetBody.outputRole).toBe("body.primary")
    expect(
      readPatternFeatureParameters({
        ...feature(),
        type: { ...patternFeatureType.type, schemaVersion: 2 },
      }),
    ).toBeNull()
  })

  it("excludes source and feature UUIDs from numeric content", () => {
    const original = registry().validateFeature(feature())
    const remapped = registry().validateFeature({
      ...feature(),
      id: sourceId,
      dependencies: [patternId],
      parameters: { ...linear, targetBody: { ...targetBody, featureId: patternId } },
    })
    expect(original.ok).toBe(true)
    expect(remapped.ok).toBe(true)
    if (!original.ok || !remapped.ok) throw new Error("Pattern fixture did not validate")
    expect(remapped.contentParameters).toEqual(original.contentParameters)
  })

  it("keeps semantic role prefixes through count shrink and restore", () => {
    const full = patternOutputRoles(256)
    const reduced = patternOutputRoles(3)
    expect(full).toHaveLength(256)
    expect(full[0]).toBe("pattern.instance.0")
    expect(full[255]).toBe("pattern.instance.255")
    expect(reduced).toEqual(full.slice(0, 3))
    expect(patternOutputRoles(256)).toEqual(full)
    for (const role of full) expect(bodyOutputRoleSchema.safeParse(role).success).toBe(true)
  })

  it.each([1, 257, 2.5, Number.NaN, Infinity])("rejects count %s", (count) => {
    const quantity = {
      ...createScalarQuantity(2),
      value: count,
      source: { value: count, unit: "1", expression: null },
    }
    expect(patternFeatureParametersSchema.safeParse({ ...linear, count: quantity }).success).toBe(
      false,
    )
    expect(() => patternOutputRoles(count)).toThrow()
  })

  it.each([-1, 256, 1.5, Number.NaN])("rejects semantic instance index %s", (index) => {
    expect(() => patternInstanceOutputRole(index)).toThrow()
  })

  it.each([
    { spacing: createLengthQuantity(0) },
    { spacing: createLengthQuantity(100_001) },
    { spacing: createLengthQuantity(40_000) },
    { spacing: createAngleQuantity(1) },
    { count: createLengthQuantity(4) },
    { axis: "custom" },
    { kind: "unknown" },
    { keepSource: true },
    { targetBody: { ...targetBody, outputRole: "Unknown" } },
  ])("rejects unsupported linear intent %j", (changes) => {
    expect(patternFeatureParametersSchema.safeParse({ ...linear, ...changes }).success).toBe(false)
  })

  it.each([
    { angle: createAngleQuantity(0) },
    { angle: createAngleQuantity(361, "deg") },
    { angle: createLengthQuantity(1) },
    { center: undefined },
    { center: { ...circular.center, x: createLengthQuantity(100_001) } },
    { center: { ...circular.center, x: createScalarQuantity(1) } },
    { center: { ...circular.center, automatic: true } },
    { fuse: true },
  ])("rejects unsupported circular intent %j", (changes) => {
    expect(patternFeatureParametersSchema.safeParse({ ...circular, ...changes }).success).toBe(
      false,
    )
  })

  it("resolves variable-driven count, signed spacing, angle, and explicit center without replacing expressions", () => {
    const variables = new Map<string, ExpressionValue>([
      ["copies", { dimension: "scalar", value: 5 }],
      ["pitch", { dimension: "length", value: -25 }],
      ["turn", { dimension: "angle", value: -2 * Math.PI }],
      ["origin", { dimension: "length", value: 42 }],
    ])
    const authoredLinear = {
      ...linear,
      count: createScalarQuantity(2, "#copies"),
      spacing: createLengthQuantity(1, "mm", "#pitch"),
    }
    expect(patternFeatureTypeHandler.resolveParameters?.(authoredLinear, variables)).toMatchObject({
      ok: true,
      parameters: {
        count: { value: 5, source: { expression: "#copies" } },
        spacing: { value: -25, source: { expression: "#pitch" } },
      },
    })
    const authoredCircular = {
      ...circular,
      count: authoredLinear.count,
      angle: createAngleQuantity(1, "rad", "#turn"),
      center: { ...circular.center, x: createLengthQuantity(0, "mm", "#origin") },
    }
    expect(
      patternFeatureTypeHandler.resolveParameters?.(authoredCircular, variables),
    ).toMatchObject({
      ok: true,
      parameters: {
        count: { value: 5 },
        angle: { value: -2 * Math.PI },
        center: { x: { value: 42 } },
      },
    })
    expect(authoredLinear.count.value).toBe(2)
    expect(authoredLinear.spacing.value).toBe(1)
  })

  it.each([
    { name: "missing", values: [] },
    { name: "fractional", values: [["copies", { dimension: "scalar", value: 2.5 }]] },
    { name: "too many", values: [["copies", { dimension: "scalar", value: 257 }]] },
    { name: "wrong dimension", values: [["copies", { dimension: "length", value: 3 }]] },
    {
      name: "zero spacing",
      values: [
        ["copies", { dimension: "scalar", value: 3 }],
        ["pitch", { dimension: "length", value: 0 }],
      ],
    },
    {
      name: "span overflow",
      values: [
        ["copies", { dimension: "scalar", value: 4 }],
        ["pitch", { dimension: "length", value: 40_000 }],
      ],
    },
  ] as { name: string; values: [string, ExpressionValue][] }[])(
    "fails closed for $name expressions",
    ({ values }) => {
      const authored = {
        ...linear,
        count: createScalarQuantity(2, "#copies"),
        spacing: createLengthQuantity(1, "mm", "#pitch"),
      }
      expect(
        patternFeatureTypeHandler.resolveParameters?.(authored, new Map(values)),
      ).toMatchObject({ ok: false })
    },
  )

  it("rejects circular angle and center expressions outside the canonical limits", () => {
    const authored = {
      ...circular,
      angle: createAngleQuantity(1, "rad", "#turn"),
      center: { ...circular.center, x: createLengthQuantity(0, "mm", "#origin") },
    }
    expect(
      patternFeatureTypeHandler.resolveParameters?.(
        authored,
        new Map([["turn", { dimension: "angle", value: 2 * Math.PI + 0.01 }]]),
      ),
    ).toMatchObject({ ok: false, diagnostic: { issues: [{ path: "angle" }] } })
    expect(
      patternFeatureTypeHandler.resolveParameters?.(
        authored,
        new Map([
          ["turn", { dimension: "angle", value: Math.PI }],
          ["origin", { dimension: "length", value: 100_001 }],
        ]),
      ),
    ).toMatchObject({ ok: false, diagnostic: { issues: [{ path: "center.x" }] } })
  })
})
