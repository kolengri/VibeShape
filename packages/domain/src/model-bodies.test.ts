import { describe, expect, it } from "vitest"
import type { FeatureRecord } from "./feature-graph"
import { terminalBodyOutputs } from "./model-bodies"
import { holeFeatureTypeV2 } from "./part-design-hole"
import { createLengthQuantity } from "./units"

const ids = {
  source: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
  consumer: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
} as const

function feature(
  id: string,
  dependencies: string[] = [],
  parameters: Record<string, unknown> = { operation: "new" },
  type = holeFeatureTypeV2.type,
) {
  return {
    schemaVersion: 0,
    id,
    type,
    parameters,
    dependencies,
    references: [],
    suppressed: false,
  } as unknown as FeatureRecord
}

describe("terminalBodyOutputs", () => {
  it("consumes one named role and preserves its sibling", () => {
    const source = feature(ids.source)
    const consumer = feature(ids.consumer, [ids.source], {
      sketchId: ids.consumer,
      pointIds: [ids.consumer],
      diameter: createLengthQuantity(2),
      direction: "forward",
      extent: "blind",
      depth: createLengthQuantity(3),
      targetBody: { schemaVersion: 0, featureId: ids.source, outputRole: "pattern.instance.0" },
    })
    const seed = { featureId: ids.source, outputRole: "pattern.instance.0" }
    const sibling = { featureId: ids.source, outputRole: "pattern.instance.1" }
    const selected = { featureId: ids.consumer, outputRole: "result" }
    const byFeature: ReadonlyMap<string, readonly { featureId: string; outputRole?: string }[]> =
      new Map([
        [ids.source, [seed, sibling]],
        [ids.consumer, [selected]],
      ])
    expect(terminalBodyOutputs([source, consumer], byFeature)).toEqual([sibling, selected])
  })

  it("fails closed for an unknown named role instead of using the aggregate", () => {
    const source = feature(ids.source)
    const consumer = feature(ids.consumer, [ids.source], {
      sketchId: ids.consumer,
      pointIds: [ids.consumer],
      diameter: createLengthQuantity(2),
      direction: "forward",
      extent: "blind",
      depth: createLengthQuantity(3),
      targetBody: { schemaVersion: 0, featureId: ids.source, outputRole: "missing" },
    })
    const aggregate = { featureId: ids.source }
    const byFeature: ReadonlyMap<string, readonly { featureId: string; outputRole?: string }[]> =
      new Map([
        [ids.source, [aggregate]],
        [ids.consumer, [{ featureId: ids.consumer }]],
      ])
    expect(terminalBodyOutputs([source, consumer], byFeature)).toBeNull()
  })
})
