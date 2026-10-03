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
  readThreadFeatureParameters,
  threadFeatureParametersSchema,
  threadFeatureType,
  threadFeatureTypeHandler,
} from "./part-design-thread"
import { createAngleQuantity, createLengthQuantity, createScalarQuantity } from "./units"
import type { ExpressionValue } from "./variables"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f7b01"
const threadId = "0195b5ac-b220-7a2c-8c33-67a36a7f7b02"
const parameters = {
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "body.primary" },
  kind: "external",
  axis: "Z",
  origin: {
    x: createLengthQuantity(1, "cm"),
    y: createLengthQuantity(-2),
    z: createLengthQuantity(0),
  },
  nominalDiameter: createLengthQuantity(10),
  pitch: createLengthQuantity(2),
  length: createLengthQuantity(8),
  depth: createLengthQuantity(0.8),
  clearance: createLengthQuantity(0.1),
  handedness: "right",
  starts: createScalarQuantity(1),
  phase: createAngleQuantity(90, "deg"),
  runIn: createLengthQuantity(1),
  runOut: createLengthQuantity(1),
}
function feature() {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: threadId,
    type: threadFeatureType.type,
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
    { ...partDesignModule, featureTypes: [threadFeatureType] },
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, [threadFeatureTypeHandler])
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}
describe("exact-body modeled thread intent", () => {
  it("validates the sole exact dependency and projects UUID-free canonical mm/radian/scalar content", () => {
    const types = registry()
    const original = types.validateFeature(feature())
    expect(original).toMatchObject({
      ok: true,
      contentParameters: {
        kind: "external",
        axis: "Z",
        origin: [10, -2, 0],
        nominalDiameter: 10,
        pitch: 2,
        length: 8,
        depth: 0.8,
        clearance: 0.1,
        handedness: "right",
        starts: 1,
        phase: Math.PI / 2,
        runIn: 1,
        runOut: 1,
      },
    })
    const remapped = types.validateFeature({
      ...feature(),
      id: sourceId,
      dependencies: [threadId],
      parameters: { ...parameters, targetBody: { ...parameters.targetBody, featureId: threadId } },
    })
    if (!original.ok || !remapped.ok) throw new Error("Thread fixture did not validate")
    expect(remapped.contentParameters).toEqual(original.contentParameters)
    expect(types.validateFeature({ ...feature(), dependencies: [threadId] }).ok).toBe(false)
    expect(types.validateFeature({ ...feature(), dependencies: [sourceId, threadId] }).ok).toBe(
      false,
    )
    expect(readThreadFeatureParameters(feature())?.targetBody.outputRole).toBe("body.primary")
    expect(
      readThreadFeatureParameters({
        ...feature(),
        type: { ...threadFeatureType.type, schemaVersion: 2 },
      }),
    ).toBeNull()
  })
  it.each([
    { kind: "cosmetic" },
    { axis: "surface" },
    { origin: { ...parameters.origin, x: createLengthQuantity(100_001) } },
    { nominalDiameter: createLengthQuantity(0) },
    { nominalDiameter: createLengthQuantity(1001) },
    { pitch: createLengthQuantity(0.19) },
    { pitch: createLengthQuantity(21) },
    { depth: createLengthQuantity(1.51) },
    { depth: createLengthQuantity(0) },
    { clearance: createLengthQuantity(-1) },
    { clearance: createLengthQuantity(4.3) },
    { starts: createScalarQuantity(0) },
    { starts: createScalarQuantity(5) },
    { starts: createScalarQuantity(1.5) },
    { starts: createLengthQuantity(2) },
    { phase: createAngleQuantity(361, "deg") },
    { phase: createLengthQuantity(1) },
    { handedness: "automatic" },
    { runIn: createLengthQuantity(-1) },
    { length: createLengthQuantity(2) },
    { length: createLengthQuantity(131) },
    { standard: "ISO" },
    { targetBody: { ...parameters.targetBody, outputRole: "Unknown" } },
  ])("rejects unsupported or unsafe authored parameters %j", (changes) => {
    expect(threadFeatureParametersSchema.safeParse({ ...parameters, ...changes }).success).toBe(
      false,
    )
  })
  it("resolves the total-turn boundary without dividing the budget by the number of starts", () => {
    const authored = {
      ...parameters,
      length: createLengthQuantity(8, "mm", "#length"),
    }
    for (const starts of [1, 2, 3, 4]) {
      const value = { ...authored, starts: createScalarQuantity(starts) }
      expect(
        threadFeatureTypeHandler.resolveParameters?.(
          value,
          new Map([["length", { dimension: "length", value: 34 }]]),
        ),
      ).toMatchObject({ ok: true, parameters: { length: { value: 34 } } })
      expect(
        threadFeatureTypeHandler.resolveParameters?.(
          value,
          new Map([["length", { dimension: "length", value: 36 }]]),
        ),
      ).toMatchObject({
        ok: false,
        diagnostic: {
          issues: [{ path: "pitch", message: expect.stringContaining("Reduce the band length") }],
        },
      })
    }
  })
  it("resolves every quantity expression to its canonical dimension while preserving authored expressions", () => {
    const values = new Map<string, ExpressionValue>([
      ["diameter", { dimension: "length", value: 12 }],
      ["pitch", { dimension: "length", value: 3 }],
      ["length", { dimension: "length", value: 9 }],
      ["depth", { dimension: "length", value: 1 }],
      ["fit", { dimension: "length", value: 0.2 }],
      ["starts", { dimension: "scalar", value: 2 }],
      ["phase", { dimension: "angle", value: -Math.PI }],
      ["in", { dimension: "length", value: 0.5 }],
      ["out", { dimension: "length", value: 1.5 }],
      ["x", { dimension: "length", value: 5 }],
      ["y", { dimension: "length", value: -4 }],
      ["z", { dimension: "length", value: 2 }],
    ])
    const authored = {
      ...parameters,
      nominalDiameter: createLengthQuantity(10, "mm", "#diameter"),
      pitch: createLengthQuantity(2, "mm", "#pitch"),
      length: createLengthQuantity(8, "mm", "#length"),
      depth: createLengthQuantity(0.8, "mm", "#depth"),
      clearance: createLengthQuantity(0.1, "mm", "#fit"),
      starts: createScalarQuantity(1, "#starts"),
      phase: createAngleQuantity(0, "rad", "#phase"),
      runIn: createLengthQuantity(1, "mm", "#in"),
      runOut: createLengthQuantity(1, "mm", "#out"),
      origin: {
        x: createLengthQuantity(0, "mm", "#x"),
        y: createLengthQuantity(0, "mm", "#y"),
        z: createLengthQuantity(0, "mm", "#z"),
      },
    }
    expect(threadFeatureTypeHandler.resolveParameters?.(authored, values)).toMatchObject({
      ok: true,
      parameters: {
        nominalDiameter: { value: 12 },
        pitch: { value: 3 },
        length: { value: 9 },
        depth: { value: 1 },
        clearance: { value: 0.2 },
        starts: { value: 2, source: { expression: "#starts" } },
        phase: { value: -Math.PI },
        runIn: { value: 0.5 },
        runOut: { value: 1.5 },
        origin: { x: { value: 5 }, y: { value: -4 }, z: { value: 2 } },
      },
    })
    expect(authored.starts.value).toBe(1)
    expect(authored.origin.x.value).toBe(0)
  })
  it.each([
    { name: "missing", value: null },
    { name: "fractional", value: { dimension: "scalar", value: 1.5 } },
    { name: "excessive", value: { dimension: "scalar", value: 5 } },
    { name: "wrong dimension", value: { dimension: "length", value: 2 } },
  ] as { name: string; value: ExpressionValue | null }[])(
    "rejects $name starts expressions",
    ({ value }) => {
      expect(
        threadFeatureTypeHandler.resolveParameters?.(
          { ...parameters, starts: createScalarQuantity(1, "#count") },
          new Map(value ? [["count", value]] : []),
        ),
      ).toMatchObject({ ok: false, diagnostic: { issues: [{ path: "starts" }] } })
    },
  )
  it("rejects cross-field depth, band, and turn overflow after expression resolution", () => {
    const authored = {
      ...parameters,
      length: createLengthQuantity(8, "mm", "#length"),
      pitch: createLengthQuantity(2, "mm", "#pitch"),
    }
    for (const [length, pitch] of [
      [1, 2],
      [131, 2],
      [8, 0.5],
    ] as const) {
      expect(
        threadFeatureTypeHandler.resolveParameters?.(
          authored,
          new Map([
            ["length", { dimension: "length", value: length }],
            ["pitch", { dimension: "length", value: pitch }],
          ]),
        ),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-thread-geometry" } })
    }
  })
})
