import { describe, expect, it } from "bun:test"
import { featureRecordSchema } from "./feature-graph"
import { featureIdSchema } from "./identifiers"
import {
  expectedSweepDependencyIds,
  readSweepFeatureParameters,
  readSweepFeatureParametersV2,
  sweepFeatureParametersSchema,
  sweepFeatureParametersV2Schema,
  sweepFeatureType,
  sweepFeatureTypeHandler,
  sweepFeatureTypeHandlerV2,
  sweepFeatureTypeV2,
  sweepV2AxisOwnerIds,
} from "./part-design-sweep"
import { createAngleQuantity, createLengthQuantity } from "./units"
import type { ExpressionValue } from "./variables"

const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
const parameters = {
  profile: {
    schemaVersion: 0,
    sketchId: id(1),
    outerBoundaryEntityIds: [id(2)],
    holeBoundaryEntityIds: [[id(3)]],
  },
  path: { schemaVersion: 0, sketchId: id(4), entityIds: [id(5), id(6)], startPointId: id(7) },
}

describe("new-body Sweep contract", () => {
  it("preserves profile holes and directed path without coordinates or consumed body intent", () => {
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: id(10),
      type: sweepFeatureType.type,
      parameters,
      dependencies: [],
      references: [],
      suppressed: false,
    })
    expect(readSweepFeatureParameters(feature)).toEqual<unknown>(parameters)
    expect(sweepFeatureTypeHandler.contentParameters(feature.parameters)).toEqual(parameters)
    expect(
      readSweepFeatureParameters({ ...feature, type: { ...feature.type, schemaVersion: 2 } }),
    ).toBeNull()
  })
  it.each([
    { operation: "remove" },
    { path: { ...parameters.path, entityIds: [] } },
    { profile: { ...parameters.profile, holeBoundaryEntityIds: [[id(2)]] } },
  ])("rejects unsupported authoring %j", (replacement) => {
    expect(sweepFeatureParametersSchema.safeParse({ ...parameters, ...replacement }).success).toBe(
      false,
    )
  })
  it("retains first profile/path support owner occurrences", () => {
    const owners = [3, 1, 3, 2].map((value) => featureIdSchema.parse(id(value)))
    expect(expectedSweepDependencyIds(owners)).toEqual<unknown>([id(3), id(1), id(2)])
  })
})

describe("helical Sweep v2 contract", () => {
  const helixPath = {
    kind: "helix",
    axis: { kind: "datum-axis", featureId: id(20), axis: "normal" },
    handedness: "left",
    radius: createLengthQuantity(10, "mm", "#r"),
    pitch: createLengthQuantity(4),
    extent: { kind: "height", height: createLengthQuantity(20) },
    startAngle: createAngleQuantity(0),
  }
  const v2 = { profile: parameters.profile, path: helixPath }
  function record(dependencies: string[]) {
    return featureRecordSchema.parse({
      schemaVersion: 0,
      id: id(11),
      type: sweepFeatureTypeV2.type,
      parameters: v2,
      dependencies,
      references: [],
      suppressed: false,
    })
  }

  it("keeps version 1 planar records replaying unchanged and separate from version 2", () => {
    const v1 = featureRecordSchema.parse({
      schemaVersion: 0,
      id: id(10),
      type: sweepFeatureType.type,
      parameters,
      dependencies: [],
      references: [],
      suppressed: false,
    })
    expect(sweepFeatureType.type.schemaVersion).toBe(1)
    expect(readSweepFeatureParameters(v1)).toEqual<unknown>(parameters)
    expect(readSweepFeatureParametersV2(v1)).toBeNull()
    expect(sweepFeatureParametersV2Schema.safeParse(parameters).success).toBe(false)
    expect(readSweepFeatureParameters(record([id(20)]))).toBeNull()
    expect(readSweepFeatureParametersV2(record([id(20)]))).toEqual<unknown>(v2)
  })

  it("requires the helix-axis producer as a dependency", () => {
    expect(sweepV2AxisOwnerIds(v2 as never)).toEqual<unknown>([id(20)])
    expect(sweepFeatureTypeHandlerV2.validateFeature?.(record([id(20)]))).toEqual([])
    expect(sweepFeatureTypeHandlerV2.validateFeature?.(record([]))).toHaveLength(1)
  })

  it("resolves helix expressions and bounds derived turns", () => {
    const values = new Map<string, ExpressionValue>([["r", { dimension: "length", value: 15 }]])
    expect(sweepFeatureTypeHandlerV2.resolveParameters?.(v2, values)).toMatchObject({
      ok: true,
      parameters: { path: { radius: { value: 15 } } },
    })
    expect(
      sweepFeatureParametersV2Schema.safeParse({
        ...v2,
        path: { ...helixPath, extent: { kind: "height", height: createLengthQuantity(400) } },
      }).success,
    ).toBe(false)
    expect(
      sweepFeatureTypeHandlerV2.resolveParameters?.(
        v2,
        new Map([["r", { dimension: "angle", value: 1 }]]),
      ),
    ).toMatchObject({ ok: false, diagnostic: { issues: [{ path: "path.radius" }] } })
  })
})
