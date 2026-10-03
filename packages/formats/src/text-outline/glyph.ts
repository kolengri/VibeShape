/// <reference path="./upstream.d.ts" />
import type { Font, Glyph } from "opentype.js/dist/opentype.mjs"
import { OutlineFailure } from "./failure"

export function readTextGlyph(
  font: Font,
  character: string,
  ordinal: number,
): {
  glyph: Glyph
  glyphIndex: number
  codePoint: number
} {
  const glyphIndex = font.charToGlyphIndex(character)
  const codePoint = character.codePointAt(0)
  if (
    codePoint === undefined ||
    !Number.isInteger(glyphIndex) ||
    glyphIndex <= 0 ||
    glyphIndex >= font.numGlyphs
  ) {
    throw new OutlineFailure(
      "missing-glyph",
      `The pinned font has no glyph for U+${codePoint?.toString(16).toUpperCase() ?? "UNKNOWN"}.`,
      { glyphOrdinal: ordinal, ...(codePoint === undefined ? {} : { codePoint }) },
    )
  }
  return { glyph: font.glyphs.get(glyphIndex), glyphIndex, codePoint }
}

export function glyphAdvanceMm(glyph: Glyph, scale: number, ordinal: number): number {
  const advance = glyph.advanceWidth === undefined ? Number.NaN : glyph.advanceWidth * scale
  if (!Number.isFinite(advance))
    throw new OutlineFailure("invalid-font-outline", "A font glyph has invalid advance metrics.", {
      glyphOrdinal: ordinal,
    })
  return advance
}

export function glyphKerningMm(
  font: Font,
  previousGlyph: number | undefined,
  glyphIndex: number,
  scale: number,
  enabled: boolean,
  ordinal: number,
): number {
  if (previousGlyph === undefined || !enabled) return 0
  const kerning = font.getKerningValue(previousGlyph, glyphIndex) * scale
  if (!Number.isFinite(kerning))
    throw new OutlineFailure("invalid-font-outline", "A font pair has invalid kerning metrics.", {
      glyphOrdinal: ordinal,
    })
  return kerning || 0
}
