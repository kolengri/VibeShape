// OpenType 2 has no declarations; its older DefinitelyTyped package requires DOM canvas types.
declare module "opentype.js/dist/opentype.mjs" {
  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Z" }

  export interface Glyph {
    advanceWidth: number | undefined
    path: { commands: PathCommand[] }
  }

  export interface Font {
    unitsPerEm: number
    ascender: number
    descender: number
    numGlyphs: number
    tables: {
      os2?: { sCapHeight?: number; sxHeight?: number }
      head?: { fontRevision?: number }
    }
    charToGlyphIndex(character: string): number
    glyphs: { get(index: number): Glyph }
    getKerningValue(leftGlyph: number, rightGlyph: number): number
  }

  export function parse(buffer: ArrayBuffer): Font
}
