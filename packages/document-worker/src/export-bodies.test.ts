import { describe, expect, it } from "bun:test"
import { documentExportBodiesSchema } from "@vibeshape/protocol"
import { exportBodyName, selectExportBodies } from "./export-bodies"

const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const source = { featureId, contentHash: "a".repeat(64) }

describe("exact terminal export selection", () => {
  it("preserves the actual legacy cache dependency while accepting its normalized result reference", () => {
    const selected = selectExportBodies(
      [source],
      [{ featureId, outputRole: "result", name: "Housing" }],
    )
    expect(selected.features[0]).toBe(source)
    expect(selected.features[0]).not.toHaveProperty("outputRole")
    expect(exportBodyName(source, selected.names)).toBe("Housing")
  })
  it("selects only the requested semantic sibling without changing its content hash", () => {
    const first = { ...source, outputRole: "body.first" }
    const second = { ...source, outputRole: "body.second" }
    const selected = selectExportBodies([first, second], [{ featureId, outputRole: "body.second" }])
    expect(selected.features).toEqual([second])
    expect(selected.features[0]).toBe(second)
  })
  it("rejects historical, unknown and duplicated bodies without substituting another output", () => {
    expect(() => selectExportBodies([source], [{ featureId, outputRole: "missing" }])).toThrow()
    expect(() => selectExportBodies([], [{ featureId }])).toThrow()
    expect(() =>
      selectExportBodies([source], [{ featureId }, { featureId, outputRole: "result" }]),
    ).toThrow()
  })
  it("bounds and closes the untrusted selection payload", () => {
    for (const input of [
      [],
      [{ featureId, contentHash: source.contentHash }],
      [{ featureId, outputRole: "../../secret" }],
      [{ featureId, name: "x".repeat(121) }],
      Array.from({ length: 4097 }, () => ({ featureId })),
      [{ featureId }, { featureId, outputRole: "result" }],
    ]) {
      expect(documentExportBodiesSchema.safeParse(input).success).toBe(false)
    }
    expect(
      documentExportBodiesSchema.safeParse([{ featureId, name: "Left housing" }]).success,
    ).toBe(true)
  })
})
