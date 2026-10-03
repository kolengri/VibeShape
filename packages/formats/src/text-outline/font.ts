/// <reference path="./upstream.d.ts" />
import { BUNDLED_SKETCH_TEXT_FONT } from "@vibeshape/domain/sketch-text"
import { type Font, parse } from "opentype.js/dist/opentype.mjs"
import { z } from "zod"
import { OutlineFailure } from "./failure"

let verifiedFont: Font | undefined

function verifyMetrics(font: Font): void {
  const metrics = z
    .object({
      unitsPerEm: z.literal(BUNDLED_SKETCH_TEXT_FONT.unitsPerEm),
      ascender: z.literal(BUNDLED_SKETCH_TEXT_FONT.ascender),
      descender: z.literal(BUNDLED_SKETCH_TEXT_FONT.descender),
      capHeight: z.literal(BUNDLED_SKETCH_TEXT_FONT.capHeight),
      xHeight: z.literal(BUNDLED_SKETCH_TEXT_FONT.xHeight),
      revision: z.literal(Number(BUNDLED_SKETCH_TEXT_FONT.revision)),
      glyphCount: z.literal(3_748),
    })
    .safeParse({
      unitsPerEm: font.unitsPerEm,
      ascender: font.ascender,
      descender: font.descender,
      capHeight: font.tables.os2?.sCapHeight,
      xHeight: font.tables.os2?.sxHeight,
      revision: font.tables.head?.fontRevision,
      glyphCount: font.numGlyphs,
    })
  if (!metrics.success) {
    throw new OutlineFailure(
      "font-metrics-mismatch",
      "The pinned font capital-height and face metrics do not match the saved text policy.",
    )
  }
}

export async function loadPinnedTextFont(value: Uint8Array): Promise<Font> {
  if (!(value instanceof Uint8Array) || value.byteLength !== BUNDLED_SKETCH_TEXT_FONT.byteLength) {
    throw new OutlineFailure(
      "font-resource-mismatch",
      "The bundled font byte length does not match its immutable identity.",
    )
  }
  // Own the source before the asynchronous digest; callers may transfer or mutate their buffer.
  const bytes = Uint8Array.from(value)
  const subtle = (
    globalThis as typeof globalThis & {
      crypto?: { subtle?: { digest(algorithm: string, bytes: Uint8Array): Promise<ArrayBuffer> } }
    }
  ).crypto?.subtle
  if (!subtle)
    throw new OutlineFailure(
      "font-resource-unavailable",
      "Font verification requires WebCrypto SHA-256.",
    )
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes))
  const digestHex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
  if (digestHex !== BUNDLED_SKETCH_TEXT_FONT.digest) {
    throw new OutlineFailure(
      "font-resource-mismatch",
      "The bundled font digest does not match its immutable identity.",
    )
  }
  if (!verifiedFont) {
    const font = parse(bytes.buffer)
    verifyMetrics(font)
    verifiedFont = font
  }
  return verifiedFont
}
