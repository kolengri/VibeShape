import { describe, expect, it } from "vitest"
import { featureBodyDependencies, featureBodyDependencyIds } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { featureIdSchema } from "./identifiers"
import { holeFeatureType, holeFeatureTypeV2 } from "./part-design-hole"
import { createLengthQuantity } from "./units"

const id = (suffix: string) => featureIdSchema.parse(`0195b5ac-b220-7a2c-8c33-${suffix}`)
const targetId = id("000000000101")

const holeParameters = {
  sketchId: "0195b5ac-b220-7a2c-8c33-000000000201",
  pointIds: ["0195b5ac-b220-7a2c-8c33-000000000301"],
  diameter: createLengthQuantity(8),
  direction: "forward" as const,
  extent: "through-all" as const,
}

describe("feature body dependencies", () => {
  it("projects a version 2 hole target role and excludes sketch support", () => {
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: id("000000000001"),
      type: holeFeatureTypeV2.type,
      parameters: {
        ...holeParameters,
        targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "pattern.instance.1" },
      },
      dependencies: [targetId],
      references: [],
      suppressed: false,
    })

    expect(featureBodyDependencies(feature)).toEqual([
      { featureId: targetId, outputRole: "pattern.instance.1" },
    ])
    expect(featureBodyDependencyIds(feature)).toEqual([targetId])
  })

  it("keeps legacy hole dependencies whole-result and role-free", () => {
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: id("000000000002"),
      type: holeFeatureType.type,
      parameters: holeParameters,
      dependencies: [targetId],
      references: [],
      suppressed: false,
    })

    expect(featureBodyDependencies(feature)).toEqual([{ featureId: targetId }])
  })
})
