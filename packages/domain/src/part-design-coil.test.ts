import { describe, expect, it } from "bun:test"
import { bodyReferenceSchema } from "./body-reference"
import { featureBodyDependencies, featureBodyDependencyIds } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  coilDependencyIds,
  coilFeatureParametersSchema,
  coilFeatureType,
  coilFeatureTypeHandler,
  readCoilFeatureParameters,
} from "./part-design-coil"
import { coilMeridianSpan, helixTurns, minimumCoilPitch } from "./part-design-helix"
import { classifyPartOperation } from "./part-operation"
import { referenceAxisSchema } from "./reference-frame"
import { createAngleQuantity, createLengthQuantity, createScalarQuantity } from "./units"
import type { ExpressionValue } from "./variables"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f5101"
const datumId = "0195b5ac-b220-7a2c-8c33-67a36a7f5102"
const coilId = "0195b5ac-b220-7a2c-8c33-67a36a7f5103"
const target = bodyReferenceSchema.parse({
  schemaVersion: 0,
  featureId: sourceId,
  outputRole: "result",
})
const parameters = {
  axis: { kind: "origin-axis", axis: "Z" },
  handedness: "right",
  radius: createLengthQuantity(10),
  pitch: createLengthQuantity(5),
  extent: { kind: "turns", turns: createScalarQuantity(3) },
  startAngle: createAngleQuantity(0),
  section: { kind: "circular", diameter: createLengthQuantity(2) },
  operation: "new",
  targetBody: null,
} as const
function feature(overrides: Record<string, unknown> = {}, dependencies: string[] = []) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: coilId,
    type: coilFeatureType.type,
    parameters: { ...parameters, ...overrides },
    dependencies,
    references: [],
    suppressed: false,
  })
}
function registry() {
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    { ...partDesignModule, featureTypes: [coilFeatureType] },
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, [coilFeatureTypeHandler])
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}
function issues(overrides: Record<string, unknown>) {
  const parsed = coilFeatureParametersSchema.safeParse({ ...parameters, ...overrides })
  return parsed.success ? [] : parsed.error.issues.map(({ path, message }) => ({ path, message }))
}

describe("Coil authored intent", () => {
  it("projects unit-free canonical content for a new right-handed coil", () => {
    const validated = registry().validateFeature(feature())
    expect(validated).toMatchObject({
      ok: true,
      contentParameters: {
        handedness: "right",
        radius: 10,
        pitch: 5,
        turns: 3,
        startAngle: 0,
        axis: { kind: "origin-axis", axis: "Z" },
        section: { kind: "circular", diameter: 2 },
        operation: "new",
      },
    })
    expect(classifyPartOperation({ ...feature(), schemaVersion: 1, semanticInputs: [] })).toEqual({
      kind: "new",
    })
    expect(featureBodyDependencyIds(feature())).toEqual([])
  })

  it("derives turns from height and keeps both handednesses", () => {
    expect(helixTurns({ kind: "height", height: createLengthQuantity(25) }, 5)).toBe(5)
    const left = readCoilFeatureParameters(
      feature({
        handedness: "left",
        extent: { kind: "height", height: createLengthQuantity(12.5) },
      }),
    )
    expect(left?.handedness).toBe("left")
    expect(left && helixTurns(left.extent, left.pitch.value)).toBe(2.5)
    expect(issues({ handedness: "up" })).not.toEqual([])
  })

  it.each([
    ["radius", { radius: createLengthQuantity(0) }],
    ["pitch", { pitch: createLengthQuantity(20_000) }],
    ["turns", { extent: { kind: "turns", turns: createScalarQuantity(51) } }],
    ["height", { extent: { kind: "height", height: createLengthQuantity(1000) } }],
    ["start angle", { startAngle: createAngleQuantity(7) }],
    ["section", { section: { kind: "circular", diameter: createLengthQuantity(0) } }],
  ])("rejects an out-of-bounds %s", (_name, overrides) => {
    expect(issues(overrides)).not.toEqual([])
  })

  it("rejects self-intersecting pitches with the minimum actionable pitch", () => {
    const minimum = minimumCoilPitch(10, { kind: "circular", diameter: 2 })
    expect(minimum).toBeGreaterThan(2)
    expect(minimum).toBeLessThan(2.01)
    expect(issues({ pitch: createLengthQuantity(2) })).toEqual([
      {
        path: ["pitch"],
        message: expect.stringContaining(`above ${Math.ceil(minimum * 1000) / 1000} mm`),
      },
    ])
    expect(issues({ pitch: createLengthQuantity(2.01) })).toEqual([])
    const rectangular = {
      section: {
        kind: "rectangular",
        width: createLengthQuantity(1),
        height: createLengthQuantity(4),
      },
    }
    expect(issues({ ...rectangular, pitch: createLengthQuantity(4) })[0]?.path).toEqual(["pitch"])
    expect(issues({ ...rectangular, pitch: createLengthQuantity(4.1) })).toEqual([])
    expect(issues({ radius: createLengthQuantity(0.2) })[0]?.message).toContain("helix axis")
  })

  it.each([
    { radius: 5, kind: "rectangular", width: 8, height: 2, low: 2.02, high: 2.05, at: 2.0377 },
    { radius: 1, kind: "circular", diameter: 1.9, low: 1.994, high: 2.0, at: 1.9964 },
  ] as const)("uses the exact meridian span for the $kind reproduction", (sample) => {
    const section =
      sample.kind === "circular"
        ? { kind: "circular", diameter: createLengthQuantity(sample.diameter) }
        : {
            kind: "rectangular",
            width: createLengthQuantity(sample.width),
            height: createLengthQuantity(sample.height),
          }
    const numeric =
      sample.kind === "circular"
        ? ({ kind: "circular", diameter: sample.diameter } as const)
        : ({ kind: "rectangular", width: sample.width, height: sample.height } as const)
    const at = (pitch: number) =>
      issues({
        radius: createLengthQuantity(sample.radius),
        pitch: createLengthQuantity(pitch),
        section,
      })
    expect(at(sample.low)[0]?.path).toEqual(["pitch"])
    expect(at(sample.high)).toEqual([])
    const minimum = minimumCoilPitch(sample.radius, numeric)
    expect(minimum).toBeCloseTo(sample.at, 4)
    expect(coilMeridianSpan(sample.radius, minimum, numeric)).toBeCloseTo(minimum, 9)
    // R − w/2 must stay positive: the section may not reach the axis.
    const half = (sample.kind === "circular" ? sample.diameter : sample.width) / 2
    expect(issues({ radius: createLengthQuantity(half), section })[0]?.path).toEqual(["section"])
  })

  it("requires a target exactly for modifying operations and orders target before axis", () => {
    expect(issues({ operation: "add" })[0]?.path).toEqual(["targetBody"])
    expect(issues({ targetBody: target })[0]?.path).toEqual(["targetBody"])
    const datumAxis = referenceAxisSchema.parse({
      kind: "datum-axis",
      featureId: datumId,
      axis: "normal",
    })
    expect(coilDependencyIds({ axis: datumAxis, targetBody: null })).toEqual<unknown>([datumId])
    expect(coilDependencyIds({ axis: datumAxis, targetBody: target })).toEqual<unknown>([
      sourceId,
      datumId,
    ])
    const modifying = feature({ operation: "remove", targetBody: target, axis: datumAxis }, [
      sourceId,
      datumId,
    ])
    expect(registry().validateFeature(modifying)).toMatchObject({ ok: true })
    expect(classifyPartOperation({ ...modifying, schemaVersion: 1, semanticInputs: [] })).toEqual({
      kind: "modify",
      target,
      consumed: [],
    })
    expect(featureBodyDependencies(modifying)).toEqual<unknown>([
      { featureId: sourceId, outputRole: "result" },
    ])
    expect(
      registry().validateFeature(
        feature({ operation: "remove", targetBody: target, axis: datumAxis }, [datumId, sourceId]),
      ),
    ).toMatchObject({ ok: false })
  })

  it("resolves every expression and re-applies the self-intersection rule", () => {
    const values = new Map<string, ExpressionValue>([
      ["r", { dimension: "length", value: 12 }],
      ["p", { dimension: "length", value: 6 }],
      ["n", { dimension: "scalar", value: 4 }],
      ["a", { dimension: "angle", value: Math.PI / 2 }],
      ["d", { dimension: "length", value: 3 }],
      ["tight", { dimension: "length", value: 2 }],
    ])
    const authored = {
      ...parameters,
      radius: createLengthQuantity(10, "mm", "#r"),
      pitch: createLengthQuantity(5, "mm", "#p"),
      extent: { kind: "turns", turns: createScalarQuantity(3, "#n") },
      startAngle: createAngleQuantity(0, "rad", "#a"),
      section: { kind: "circular", diameter: createLengthQuantity(2, "mm", "#d") },
    }
    expect(coilFeatureTypeHandler.resolveParameters?.(authored, values)).toMatchObject({
      ok: true,
      parameters: {
        radius: { value: 12, source: { expression: "#r" } },
        pitch: { value: 6 },
        extent: { turns: { value: 4 } },
        startAngle: { value: Math.PI / 2 },
        section: { diameter: { value: 3 } },
      },
    })
    expect(
      coilFeatureTypeHandler.resolveParameters?.(
        { ...authored, pitch: createLengthQuantity(5, "mm", "#tight") },
        values,
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-coil-geometry", issues: [{ path: "pitch" }] },
    })
    expect(
      coilFeatureTypeHandler.resolveParameters?.(
        { ...authored, radius: createLengthQuantity(10, "mm", "#n") },
        values,
      ),
    ).toMatchObject({ ok: false, diagnostic: { issues: [{ path: "radius" }] } })
  })
})
