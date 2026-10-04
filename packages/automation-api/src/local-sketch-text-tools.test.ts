import { createAngleQuantity, createLengthQuantity } from "@vibeshape/domain/units"
import { describe, expect, it } from "vitest"
import { localOperationSchema } from "./local-tools"
import { remoteOperationSchema } from "./remote-session"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const command = { draftId: id(1), baseRevision: 3, commandId: id(2) }
const text = {
  ...command,
  sketchId: id(3),
  groupId: id(4),
  intent: {
    text: "Cafe\u0301 Ω Ж",
    heightMm: 10,
    trackingMm: 0,
    alignment: { horizontal: "left", vertical: "baseline" },
    kerning: true,
  },
  origin: [0, 0],
}
const placement = {
  ...command,
  featureId: id(5),
  label: "Placed body",
  dependencies: [id(6)],
  references: [],
  suppressed: false,
  parameters: {
    targetBody: { schemaVersion: 0, featureId: id(6), outputRole: "result" },
    translation: {
      x: createLengthQuantity(12),
      y: createLengthQuantity(0),
      z: createLengthQuantity(0),
    },
    rotation: {
      x: createAngleQuantity(0),
      y: createAngleQuantity(0),
      z: createAngleQuantity(30, "deg"),
    },
  },
}
describe("named text and Placement schemas", () => {
  it("shares normalized text intent and exact body placement across local and remote transports", () => {
    const created = localOperationSchema.parse({ tool: "create_sketch_text", arguments: text })
    expect(created.arguments).toMatchObject({ intent: { text: "Café Ω Ж" } })
    for (const value of [
      { tool: "create_sketch_text", arguments: text },
      { tool: "update_sketch_text", arguments: { ...text, removeAttachedConstraints: false } },
      { tool: "detach_sketch_text", arguments: { ...command, sketchId: id(3), groupId: id(4) } },
      { tool: "create_placement", arguments: placement },
      { tool: "update_placement", arguments: placement },
    ])
      expect(remoteOperationSchema.parse(value)).toEqual(localOperationSchema.parse(value))
  })
  it("rejects caller font identity/digests, unsupported text and nonfinite/out-of-range layout", () => {
    for (const args of [
      { ...text, intent: { ...text.intent, font: { digest: "a".repeat(64) } } },
      { ...text, outlineDigest: "a".repeat(64) },
      { ...text, intent: { ...text.intent, text: "a".repeat(65) } },
      { ...text, intent: { ...text.intent, text: "مرحبا" } },
      { ...text, intent: { ...text.intent, heightMm: Infinity } },
      { ...text, origin: [100_001, 0] },
    ])
      expect(
        localOperationSchema.safeParse({ tool: "create_sketch_text", arguments: args }).success,
      ).toBe(false)
    expect(
      localOperationSchema.safeParse({ tool: "update_sketch_text", arguments: text }).success,
    ).toBe(false)
  })
  it("requires the precise sole target dependency and valid bounded quantities for Placement", () => {
    for (const args of [
      { ...placement, dependencies: [id(7)] },
      { ...placement, dependencies: [id(6), id(7)] },
      {
        ...placement,
        parameters: {
          ...placement.parameters,
          translation: { ...placement.parameters.translation, x: createLengthQuantity(100_001) },
        },
      },
      {
        ...placement,
        parameters: {
          ...placement.parameters,
          rotation: { ...placement.parameters.rotation, z: createAngleQuantity(361, "deg") },
        },
      },
    ])
      expect(
        localOperationSchema.safeParse({ tool: "create_placement", arguments: args }).success,
      ).toBe(false)
  })
})
