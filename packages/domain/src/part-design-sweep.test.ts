import { describe, expect, it } from "bun:test"
import { featureRecordSchema } from "./feature-graph"
import { featureIdSchema } from "./identifiers"
import {
  expectedSweepDependencyIds,
  readSweepFeatureParameters,
  sweepFeatureParametersSchema,
  sweepFeatureType,
  sweepFeatureTypeHandler,
} from "./part-design-sweep"

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
