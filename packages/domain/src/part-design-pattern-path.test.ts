import { describe, expect, it } from "bun:test"
import { featureBodyDependencies } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  patternFeatureType,
  patternFeatureTypeV2,
  readPatternFeatureParameters,
  readPatternFeatureParametersV2,
} from "./part-design-pattern"
import {
  patternFeatureParametersV3Schema,
  patternFeatureTypeHandlerV3,
  patternFeatureTypeV3,
  readPatternFeatureParametersV3,
} from "./part-design-pattern-path"
import { classifyPartOperation } from "./part-operation"
import { createLengthQuantity, createScalarQuantity } from "./units"
import type { ExpressionValue } from "./variables"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f7b01"
const patternId = "0195b5ac-b220-7a2c-8c33-67a36a7f7b02"
const supportId = "0195b5ac-b220-7a2c-8c33-67a36a7f7b03"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f7b04"
const curveId = "0195b5ac-b220-7a2c-8c33-67a36a7f7b05"
const pointId = "0195b5ac-b220-7a2c-8c33-67a36a7f7b06"
const targetBody = { schemaVersion: 0, featureId: sourceId, outputRole: "pattern.instance.1" }
const path = { schemaVersion: 0, sketchId, entityIds: [curveId], startPointId: pointId }
const authored = {
  targetBody,
  kind: "path",
  count: createScalarQuantity(4),
  path,
  spacing: { mode: "fixed", distance: createLengthQuantity(2, "cm") },
  startOffset: createLengthQuantity(5),
  orientation: "follow",
  reverse: true,
}

function feature(parameters: unknown = authored, dependencies = [sourceId]) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: patternId,
    type: patternFeatureTypeV3.type,
    parameters,
    dependencies,
    references: [],
    suppressed: false,
  })
}

function registry() {
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    { ...partDesignModule, featureTypes: [patternFeatureTypeV3] },
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, [patternFeatureTypeHandlerV3])
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}

describe("path Pattern v3 intent", () => {
  it("validates the leading exact target and emits numeric content", () => {
    const types = registry()
    expect(types.validateFeature(feature())).toMatchObject({
      ok: true,
      contentParameters: {
        kind: "path",
        count: 4,
        path,
        spacing: { mode: "fixed", distance: 20 },
        startOffset: 5,
        orientation: "follow",
        reverse: true,
      },
    })
    expect(types.validateFeature(feature(authored, [sourceId, supportId])).ok).toBe(true)
    expect(types.validateFeature(feature(authored, [supportId, sourceId])).ok).toBe(false)
  })

  it("keeps v1 and v2 records on their own readers", () => {
    const record = feature()
    expect(readPatternFeatureParametersV3(record)?.kind).toBe("path")
    expect(readPatternFeatureParameters(record)).toBeNull()
    expect(readPatternFeatureParametersV2(record)).toBeNull()
    for (const type of [patternFeatureType.type, patternFeatureTypeV2.type])
      expect(readPatternFeatureParametersV3({ ...record, type })).toBeNull()
  })

  it("names instances, consumes only the target and depends on the path sketch", () => {
    const record = feature(authored, [sourceId, supportId])
    expect(featureBodyDependencies(record)).toEqual([
      { featureId: sourceId, outputRole: "pattern.instance.1" },
    ])
    expect(projectFirstPartyFeatureSemanticInputs(record)).toEqual({
      recognized: true,
      ok: true,
      inputs: [{ kind: "sketch", id: sketchId }],
    })
    expect(classifyPartOperation(record, 4)).toMatchObject({
      kind: "fan-out",
      target: targetBody,
      continuation: { featureId: patternId, outputRole: "pattern.instance.0" },
      createdOutputs: [1, 2, 3].map((index) => ({
        featureId: patternId,
        outputRole: `pattern.instance.${index}`,
      })),
    })
  })

  it("accepts equal spacing without a distance", () => {
    expect(
      patternFeatureParametersV3Schema.safeParse({ ...authored, spacing: { mode: "equal" } })
        .success,
    ).toBe(true)
  })

  it.each([
    { count: createScalarQuantity(1) },
    { count: createScalarQuantity(257) },
    { spacing: { mode: "fixed", distance: createLengthQuantity(0) } },
    { spacing: { mode: "fixed", distance: createLengthQuantity(-1) } },
    { spacing: { mode: "fixed" } },
    { spacing: { mode: "equal", distance: createLengthQuantity(1) } },
    { spacing: { mode: "fixed", distance: createLengthQuantity(40_000) } },
    { startOffset: createLengthQuantity(-1) },
    { startOffset: createScalarQuantity(1) },
    { orientation: "frenet" },
    { reverse: "yes" },
    { kind: "linear" },
    { path: { ...path, entityIds: [] } },
    { path: { ...path, startPointId: undefined } },
    { axis: "X" },
  ])("rejects unsupported path intent %j", (changes) => {
    expect(patternFeatureParametersV3Schema.safeParse({ ...authored, ...changes }).success).toBe(
      false,
    )
  })

  it("resolves count, spacing and offset expressions without replacing their sources", () => {
    const variables = new Map<string, ExpressionValue>([
      ["copies", { dimension: "scalar", value: 6 }],
      ["pitch", { dimension: "length", value: 12.5 }],
      ["lead", { dimension: "length", value: 3 }],
    ])
    const expressions = {
      ...authored,
      count: createScalarQuantity(2, "#copies"),
      spacing: { mode: "fixed", distance: createLengthQuantity(1, "mm", "#pitch") },
      startOffset: createLengthQuantity(0, "mm", "#lead"),
    }
    expect(patternFeatureTypeHandlerV3.resolveParameters?.(expressions, variables)).toMatchObject({
      ok: true,
      parameters: {
        count: { value: 6, source: { expression: "#copies" } },
        spacing: { distance: { value: 12.5, source: { expression: "#pitch" } } },
        startOffset: { value: 3, source: { expression: "#lead" } },
      },
    })
  })

  it.each([
    ["copies", { dimension: "scalar", value: 2.5 }],
    ["pitch", { dimension: "length", value: 0 }],
    ["pitch", { dimension: "length", value: 50_000 }],
    ["lead", { dimension: "length", value: -2 }],
    ["lead", { dimension: "angle", value: 1 }],
  ] as [string, ExpressionValue][])("fails closed when %s resolves to %j", (name, value) => {
    const variables = new Map<string, ExpressionValue>([
      ["copies", { dimension: "scalar", value: 4 }],
      ["pitch", { dimension: "length", value: 10 }],
      ["lead", { dimension: "length", value: 0 }],
      [name, value],
    ])
    const expressions = {
      ...authored,
      count: createScalarQuantity(2, "#copies"),
      spacing: { mode: "fixed", distance: createLengthQuantity(1, "mm", "#pitch") },
      startOffset: createLengthQuantity(0, "mm", "#lead"),
    }
    expect(patternFeatureTypeHandlerV3.resolveParameters?.(expressions, variables)).toMatchObject({
      ok: false,
    })
  })
})
