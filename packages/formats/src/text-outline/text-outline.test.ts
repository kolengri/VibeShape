import { beforeAll, describe, expect, it } from "bun:test"
import {
  BUNDLED_SKETCH_TEXT_FONT,
  SKETCH_TEXT_LAYOUT_ENGINE,
  SKETCH_TEXT_OUTLINE_SDK,
  type SketchTextParameters,
} from "@vibeshape/domain/sketch-text"
import { z } from "zod"
import {
  prepareSketchTextOutline,
  type SketchTextOutline,
  sketchTextOutlineResultSchema,
} from "./index"

let fontBytes: Uint8Array
beforeAll(async () => {
  // Test-only host IO keeps Node declarations out of the browser library configuration.
  const { readFile } = await import("node:fs/promises")
  const module = z.object({ url: z.string().startsWith("file://") }).parse(import.meta)
  const filePath = decodeURIComponent(module.url.slice("file://".length))
  fontBytes = Uint8Array.from(
    await readFile(filePath.replace(/[^/]+$/, "fonts/NotoSans-Regular.ttf")),
  )
})

function parameters(text: string, patch: Partial<SketchTextParameters> = {}): SketchTextParameters {
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
    ...patch,
  }
}

async function outline(
  text: string,
  patch: Partial<SketchTextParameters> = {},
): Promise<SketchTextOutline> {
  const result = await prepareSketchTextOutline(parameters(text, patch), fontBytes)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.outline
}

describe("pinned Noto Sans exact text outlines", () => {
  it.each(["VibeShape", "Ελλάδα", "Привет", "Café"])(
    "retains %s characters and exact closed contours",
    async (text) => {
      const result = await outline(text)
      expect(result.parameters.text).toBe(text)
      expect(result.glyphs.map((glyph) => glyph.character).join("")).toBe(text)
      expect(result.glyphs.every((glyph) => glyph.glyphIndex > 0)).toBe(true)
      expect(
        result.contours.some((contour) =>
          contour.segments.some((segment) => segment.kind === "cubic-bezier"),
        ),
      ).toBe(true)
      for (const contour of result.contours) {
        expect(contour.closed).toBe(true)
        expect(contour.segments.at(-1)?.end).toEqual(contour.segments[0]?.start)
      }
      expect(
        sketchTextOutlineResultSchema.parse(
          JSON.parse(JSON.stringify({ ok: true, outline: result })),
        ),
      ).toEqual({ ok: true, outline: result })
    },
  )

  it("scales cap height in millimeters and preserves the inner contour of O", async () => {
    const capital = await outline("H")
    expect(capital.metrics.bounds.max[1]).toBeCloseTo(10, 12)
    expect(capital.metrics.bounds.min[1]).toBe(0)
    expect(capital.metrics.scaleMmPerFontUnit).toBe(10 / 714)
    const ring = await outline("O")
    expect(ring.contours).toHaveLength(2)
    expect(
      ring.contours.every((contour) =>
        contour.segments.every((segment) => segment.kind === "cubic-bezier"),
      ),
    ).toBe(true)
    // Round-letter overshoot is preserved; declared cap height does not resize the ink box.
    expect(ring.metrics.bounds.max[1]).toBeGreaterThan(10)
  })

  it("uses scalar glyphs without a hidden fi ligature or contextual GSUB", async () => {
    const result = await outline("fi")
    expect(result.glyphs.map((glyph) => glyph.glyphIndex)).toEqual([73, 76])
    expect(result.parameters.layoutEngine).toBe("unicode-scalar-kerning-v1")
    expect(result.parameters.outlineSdk).toBe("opentype.js@2.0.0")
  })

  it("applies supported pair kerning and explicit tracking only between characters", async () => {
    const plain = await outline("AV", { kerning: false })
    const kerned = await outline("AV")
    const tracked = await outline("AV", { trackingMm: 2 })
    expect(kerned.glyphs[1]?.kerningBeforeMm).toBeCloseTo((-40 * 10) / 714, 12)
    expect(plain.metrics.advanceMm - kerned.metrics.advanceMm).toBeCloseTo((40 * 10) / 714, 12)
    expect(tracked.metrics.advanceMm - kerned.metrics.advanceMm).toBeCloseTo(2, 12)
    expect((await outline("A", { trackingMm: 100 })).metrics.advanceMm).toBe(
      (await outline("A")).metrics.advanceMm,
    )
  })

  it("anchors horizontal advance and vertical ink bounds with explicit policies", async () => {
    const original = await outline("Ag")
    const centered = await outline("Ag", {
      alignment: { horizontal: "center", vertical: "center" },
    })
    const rightTop = await outline("Ag", { alignment: { horizontal: "right", vertical: "top" } })
    const bottom = await outline("Ag", { alignment: { horizontal: "left", vertical: "bottom" } })
    expect(centered.glyphs[0]?.origin[0]).toBeCloseTo(-original.metrics.advanceMm / 2, 12)
    expect(centered.metrics.bounds.min[1] + centered.metrics.bounds.max[1]).toBeCloseTo(0, 12)
    expect(rightTop.glyphs[0]?.origin[0]).toBeCloseTo(-original.metrics.advanceMm, 12)
    expect(rightTop.metrics.bounds.max[1]).toBeCloseTo(0, 12)
    expect(bottom.metrics.bounds.min[1]).toBe(0)
    expect(original.metrics.bounds.min[1]).toBeLessThan(0)
  })

  it("preserves entered spaces and NFC composite accents without font fallback", async () => {
    const result = await outline(" A e\u0301 ")
    expect(result.parameters.text).toBe(" A é ")
    expect(result.glyphs).toHaveLength(5)
    expect(result.glyphs[0]?.glyphIndex).toBe(3)
    expect(result.contours.filter((contour) => contour.glyphOrdinal === 3)).toHaveLength(3)
    const missing = await prepareSketchTextOutline(parameters("A😀"), fontBytes)
    expect(missing).toMatchObject({
      ok: false,
      diagnostics: [{ code: "missing-glyph", glyphOrdinal: 1, codePoint: 0x1f600 }],
    })
  })
})

describe("text outline resource and failure boundaries", () => {
  it("rejects inconsistent untrusted outline metadata and broken contour closure", async () => {
    const source = await outline("O")
    for (const change of [
      { metrics: { ...source.metrics, poleCount: 1 } },
      { glyphs: source.glyphs.map((glyph) => ({ ...glyph, character: "A" })) },
      { contours: source.contours.map((contour) => ({ ...contour, glyphOrdinal: 1 })) },
      { metrics: { ...source.metrics, bounds: { min: [1, 1], max: [0, 0] } } },
      {
        contours: source.contours.map((contour) => ({
          ...contour,
          segments: contour.segments.map((segment, index) =>
            index === 0 ? { ...segment, start: [123, 456] } : segment,
          ),
        })),
      },
    ])
      expect(
        sketchTextOutlineResultSchema.safeParse({ ok: true, outline: { ...source, ...change } })
          .success,
      ).toBe(false)
  })
  it("rejects geometry beyond the canonical world limits", async () => {
    expect(
      await prepareSketchTextOutline(
        parameters("—".repeat(64), { heightMm: 1_000, trackingMm: 1_000 }),
        fontBytes,
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: "text-world-limit-exceeded" }] })
  })
  it("rejects corrupted and truncated font data even after the parsed-font cache is warm", async () => {
    await outline("A")
    const corrupt = Uint8Array.from(fontBytes)
    corrupt[100] = (corrupt[100] ?? 0) ^ 1
    for (const bytes of [corrupt, fontBytes.subarray(1), new Uint8Array()]) {
      expect(await prepareSketchTextOutline(parameters("A"), bytes)).toMatchObject({
        ok: false,
        diagnostics: [{ code: "font-resource-mismatch" }],
      })
    }
    expect((await prepareSketchTextOutline(parameters("A"), fontBytes)).ok).toBe(true)
  })

  it("owns bytes and parameters before asynchronous verification and returns fresh contours", async () => {
    const bytes = Uint8Array.from(fontBytes)
    const input = parameters("O")
    const pending = prepareSketchTextOutline(input, bytes)
    bytes.fill(0)
    input.text = "changed"
    input.font = { ...input.font }
    const first = await pending
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error("The owned font bytes must still verify.")
    expect(first.outline.parameters.text).toBe("O")
    const second = await outline("O")
    first.outline.contours[0]?.segments.splice(0)
    expect(second.contours[0]?.segments.length).toBeGreaterThan(0)
    expect(fontBytes[0]).toBe(0)
    expect(fontBytes[1]).toBe(1)
  })

  it("rejects shaping requirements before font work and rejects text without ink", async () => {
    expect(await prepareSketchTextOutline(parameters("A\u0305"), new Uint8Array())).toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid-text-parameters" }],
    })
    expect(await prepareSketchTextOutline(parameters("   "), fontBytes)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "empty-text-outline" }],
    })
  })

  it("fails closed at the aggregate pole budget and recovers for a smaller run", async () => {
    expect(await prepareSketchTextOutline(parameters("O".repeat(64)), fontBytes)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "outline-budget-exceeded" }],
    })
    const result = await outline("O".repeat(10))
    expect(result.metrics.poleCount).toBeLessThanOrEqual(2_000)
    expect(result.metrics.segmentCount).toBe(
      result.contours.reduce((count, contour) => count + contour.segments.length, 0),
    )
    expect(result.metrics.poleCount).toBe(
      result.contours.reduce(
        (count, contour) =>
          count +
          contour.segments.reduce((poles, segment) => poles + (segment.kind === "line" ? 2 : 4), 0),
        0,
      ),
    )
  })
})
