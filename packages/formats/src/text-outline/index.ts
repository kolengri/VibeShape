/// <reference path="./upstream.d.ts" />
import {
  BUNDLED_SKETCH_TEXT_FONT,
  type SketchTextParameters,
  sketchTextParametersSchema,
} from "@vibeshape/domain/sketch-text"
import type { Font } from "opentype.js/dist/opentype.mjs"
import { glyphContours, type OutlineBudget } from "./contours"
import {
  type SketchTextOutline,
  type SketchTextOutlineResult,
  sketchTextOutlineResultSchema,
} from "./contracts"
import { OutlineFailure } from "./failure"
import { loadPinnedTextFont } from "./font"
import { outlineBounds, translateOutlineSegment } from "./geometry"
import { glyphAdvanceMm, glyphKerningMm, readTextGlyph } from "./glyph"

export {
  type SketchTextOutline,
  type SketchTextOutlinePoint,
  type SketchTextOutlineResult,
  type SketchTextOutlineSegment,
  sketchTextOutlinePointSchema,
  sketchTextOutlineResultSchema,
  sketchTextOutlineSchema,
  sketchTextOutlineSegmentSchema,
} from "./contracts"

function layOutGlyphs(
  parameters: SketchTextParameters,
  font: Font,
  scale: number,
): {
  glyphs: SketchTextOutline["glyphs"]
  contours: SketchTextOutline["contours"]
  budget: OutlineBudget
  advanceMm: number
} {
  const glyphs: SketchTextOutline["glyphs"] = []
  const contours: SketchTextOutline["contours"] = []
  const budget: OutlineBudget = { segmentCount: 0, poleCount: 0 }
  let advanceMm = 0
  let previousGlyph: number | undefined
  for (const [ordinal, character] of [...parameters.text].entries()) {
    const { glyph, glyphIndex, codePoint } = readTextGlyph(font, character, ordinal)
    const kerningBeforeMm = glyphKerningMm(
      font,
      previousGlyph,
      glyphIndex,
      scale,
      parameters.kerning,
      ordinal,
    )
    const glyphAdvance = glyphAdvanceMm(glyph, scale, ordinal)
    if (previousGlyph !== undefined) advanceMm += parameters.trackingMm + kerningBeforeMm
    contours.push(...glyphContours(glyph.path.commands, advanceMm, scale, ordinal, budget))
    glyphs.push({
      ordinal,
      character,
      codePoint,
      glyphIndex,
      origin: [advanceMm || 0, 0],
      advanceMm: glyphAdvance,
      kerningBeforeMm: kerningBeforeMm || 0,
    })
    advanceMm += glyphAdvance
    previousGlyph = glyphIndex
  }
  if (!contours.length)
    throw new OutlineFailure("empty-text-outline", "The text contains no drawable font contours.")
  return { glyphs, contours, budget, advanceMm }
}

function buildOutline(parameters: SketchTextParameters, font: Font): SketchTextOutline {
  const scale = parameters.heightMm / BUNDLED_SKETCH_TEXT_FONT.capHeight
  const run = layOutGlyphs(parameters, font, scale)
  const bounds = outlineBounds(run.contours.flatMap((contour) => contour.segments))
  const horizontalAnchor =
    parameters.alignment.horizontal === "left"
      ? 0
      : parameters.alignment.horizontal === "center"
        ? run.advanceMm / 2
        : run.advanceMm
  const verticalAnchor =
    parameters.alignment.vertical === "baseline"
      ? 0
      : parameters.alignment.vertical === "bottom"
        ? bounds.min[1]
        : parameters.alignment.vertical === "top"
          ? bounds.max[1]
          : (bounds.min[1] + bounds.max[1]) / 2
  const offset: [number, number] = [-horizontalAnchor || 0, -verticalAnchor || 0]
  const contours = run.contours.map((contour) => ({
    ...contour,
    segments: contour.segments.map((segment) => translateOutlineSegment(segment, offset)),
  }))
  const glyphs = run.glyphs.map((glyph) => ({
    ...glyph,
    origin: [glyph.origin[0] + offset[0] || 0, offset[1]] as [number, number],
  }))
  return {
    schemaVersion: 0,
    parameters,
    contours,
    glyphs,
    metrics: {
      scaleMmPerFontUnit: scale,
      advanceMm: run.advanceMm || 0,
      capHeightMm: parameters.heightMm,
      ascenderMm: BUNDLED_SKETCH_TEXT_FONT.ascender * scale,
      descenderMm: BUNDLED_SKETCH_TEXT_FONT.descender * scale,
      baselineY: offset[1],
      bounds: outlineBounds(contours.flatMap((contour) => contour.segments)),
      ...run.budget,
    },
  }
}

/** Exact fixed-font outlines. No font loading, shaping substitution or authored identity allocation. */
export async function prepareSketchTextOutline(
  value: unknown,
  fontBytes: Uint8Array,
): Promise<SketchTextOutlineResult> {
  const parameters = sketchTextParametersSchema.safeParse(value)
  if (!parameters.success) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "invalid-text-parameters",
          message: parameters.error.issues
            .map((issue) => issue.message)
            .join(" ")
            .slice(0, 1_024),
        },
      ],
    }
  }
  try {
    const font = await loadPinnedTextFont(fontBytes)
    const result = sketchTextOutlineResultSchema.safeParse({
      ok: true,
      outline: buildOutline(parameters.data, font),
    })
    if (!result.success)
      throw new OutlineFailure(
        "text-world-limit-exceeded",
        "Text geometry or metrics exceed the finite +/-100,000 mm world limits.",
      )
    return result.data
  } catch (error) {
    if (error instanceof OutlineFailure) return { ok: false, diagnostics: [error.diagnostic] }
    return {
      ok: false,
      diagnostics: [
        {
          code: "invalid-font-outline",
          message:
            error instanceof Error
              ? error.message.slice(0, 1_024) || "The pinned font outline could not be prepared."
              : "The pinned font outline could not be prepared.",
        },
      ],
    }
  }
}
