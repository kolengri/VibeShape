import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  BUNDLED_SKETCH_TEXT_FONT,
  SKETCH_TEXT_LAYOUT_ENGINE,
  SKETCH_TEXT_OUTLINE_SDK,
  sketchTextParametersSchema,
} from "./sketch-text"

function parameters(text = "Text") {
  return {
    schemaVersion: 0,
    text,
    font: { ...BUNDLED_SKETCH_TEXT_FONT },
    layoutEngine: SKETCH_TEXT_LAYOUT_ENGINE,
    outlineSdk: SKETCH_TEXT_OUTLINE_SDK,
    heightMm: 10,
    alignment: { horizontal: "left", vertical: "baseline" },
    trackingMm: 0,
    kerning: true,
  }
}

describe("immutable editable sketch text intent", () => {
  it("normalizes NFC while preserving case, spaces and scalar order", () => {
    const input = parameters("  Cafe\u0301 AV fi  ")
    const parsed = sketchTextParametersSchema.parse(input)
    expect(parsed.text).toBe("  Café AV fi  ")
    expect(input.text).toBe("  Cafe\u0301 AV fi  ")
    expect(parsed).toEqual(JSON.parse(JSON.stringify(parsed)))
  })

  it("keeps fixed-font text intent representable in input and output JSON Schema", () => {
    for (const io of ["input", "output"] as const) {
      const schema = z.toJSONSchema(sketchTextParametersSchema, { io })
      expect(schema.type).toBe("object")
      expect(schema.properties?.text).toMatchObject({ type: "string", minLength: 1 })
    }
    expect(sketchTextParametersSchema.parse(parameters("Cafe\u0301")).text).toBe("Café")
  })

  it("accepts basic Latin, Greek and Cyrillic without changing entered characters", () => {
    for (const text of ["VibeShape", "Ελλάδα", "Привет", "123 + Ω / é", "😀"]) {
      expect(sketchTextParametersSchema.parse(parameters(text)).text).toBe(text)
    }
  })

  it("bounds Unicode code points and rejects malformed scalar strings", () => {
    expect(sketchTextParametersSchema.safeParse(parameters("A".repeat(64))).success).toBe(true)
    expect(sketchTextParametersSchema.safeParse(parameters("😀".repeat(64))).success).toBe(true)
    expect(sketchTextParametersSchema.parse(parameters("Ω\u0313\u0342".repeat(64))).text).toBe(
      "Ὦ".repeat(64),
    )
    for (const text of ["A".repeat(65), "😀".repeat(65), "", "\ud800"]) {
      expect(sketchTextParametersSchema.safeParse(parameters(text)).success).toBe(false)
    }
  })

  it("fails explicitly for contextual shaping, controls, multiline text and remaining combining marks", () => {
    for (const text of [
      "مرحبا",
      "नमस्ते",
      "漢字",
      "a\u200db",
      "A\nB",
      "A\tB",
      "A\u0305",
      "A\u2028B",
      "A\u2029B",
    ]) {
      const parsed = sketchTextParametersSchema.safeParse(parameters(text))
      expect(parsed.success).toBe(false)
      if (!parsed.success)
        expect(
          parsed.error.issues.some((issue) => issue.message.includes("contextual shaping")),
        ).toBe(true)
    }
  })

  it("pins the font face, digest, metrics, SDK and layout policy without defaults", () => {
    expect(Object.isFrozen(BUNDLED_SKETCH_TEXT_FONT)).toBe(true)
    const input = parameters()
    for (const patch of [
      { font: { ...input.font, digest: "0".repeat(64) } },
      { font: { ...input.font, faceIndex: 1 } },
      { font: { ...input.font, capHeight: 700 } },
      { font: { ...input.font, url: "https://example.test/font.ttf" } },
      { layoutEngine: "shaped-v1" },
      { outlineSdk: "opentype.js@1.3.4" },
      { kerning: undefined },
      { trackingMm: undefined },
    ])
      expect(sketchTextParametersSchema.safeParse({ ...input, ...patch }).success).toBe(false)
  })

  it("requires finite bounded dimensions and explicit alignment", () => {
    for (const patch of [
      { heightMm: 0 },
      { heightMm: 1_001 },
      { heightMm: NaN },
      { trackingMm: Infinity },
      { trackingMm: -1_001 },
      { alignment: { horizontal: "left" } },
      { alignment: { horizontal: "justify", vertical: "baseline" } },
      { sourceUrl: "https://example.test/font.ttf" },
    ])
      expect(sketchTextParametersSchema.safeParse({ ...parameters(), ...patch }).success).toBe(
        false,
      )
  })
})
