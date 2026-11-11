import type { SheetPrimitive } from "./sheet"

/** Helvetica advance widths (1/1000 em) for printable ASCII, from the standard AFM metrics. */
const HELVETICA_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
const WIN_ANSI_EXTRA: Readonly<Record<string, readonly [code: number, width: number]>> = {
  "…": [0x85, 1000],
  "–": [0x96, 556],
  "—": [0x97, 1000],
  "€": [0x80, 556],
}
/** Helvetica advances for the Latin-1 characters drawings use; others take the digit width. */
const LATIN_WIDTHS: Readonly<Record<number, number>> = { 176: 400, 215: 584, 216: 778 }

/** WinAnsi code and Helvetica advance of one character; unsupported characters become "?". */
export function encodeHelveticaCharacter(
  character: string,
): readonly [code: number, width: number] {
  const extra = WIN_ANSI_EXTRA[character]
  if (extra) return extra
  const code = character.codePointAt(0) ?? 63
  if (code >= 32 && code < 127) return [code, HELVETICA_ASCII[code - 32] ?? 556]
  if (code >= 160 && code <= 255) return [code, LATIN_WIDTHS[code] ?? 556]
  return [63, 556]
}

/**
 * Estimated advance of `text` at `height` mm. WinAnsi characters use Helvetica metrics; wide
 * East Asian characters count one em so layout clearance stays conservative in SVG and DXF.
 */
function textWidthMm(text: string, height: number) {
  let units = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 63
    units += code >= 0x2e80 ? 1000 : encodeHelveticaCharacter(character)[1]
  }
  return (units / 1000) * height
}

/** Descender and ascender extents of Helvetica text, as fractions of the text height. */
const DESCENT = 0.25
const ASCENT = 1

export type SheetBox = readonly [minX: number, minY: number, maxX: number, maxY: number]

function textBox(text: Extract<SheetPrimitive, { kind: "text" }>): SheetBox {
  const width = textWidthMm(text.text, text.height)
  const shift = { start: 0, middle: width / 2, end: width }[text.align]
  const [x, y] = text.position
  const along: readonly [number, number] = [-shift, width - shift]
  const across: readonly [number, number] = [-DESCENT * text.height, ASCENT * text.height]
  // Rotated text reads upward: its advance runs along +Y and its ascent points to -X.
  return text.rotation === 90
    ? [x - across[1], y + along[0], x - across[0], y + along[1]]
    : [x + along[0], y + across[0], x + along[1], y + across[1]]
}

/** Conservative sheet bounding box of one primitive, including estimated text extents. */
export function primitiveBox(primitive: SheetPrimitive): SheetBox {
  if (primitive.kind === "text") return textBox(primitive)
  const points =
    primitive.kind === "line"
      ? [primitive.start, primitive.end]
      : primitive.kind === "polyline" || primitive.kind === "arrow"
        ? primitive.points
        : [
            [
              primitive.center[0] - primitive.radius,
              primitive.center[1] - primitive.radius,
            ] as const,
            [
              primitive.center[0] + primitive.radius,
              primitive.center[1] + primitive.radius,
            ] as const,
          ]
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export function unionBoxes(boxes: readonly SheetBox[]): SheetBox | null {
  if (boxes.length === 0) return null
  return boxes.reduce((total, box) => [
    Math.min(total[0], box[0]),
    Math.min(total[1], box[1]),
    Math.max(total[2], box[2]),
    Math.max(total[3], box[3]),
  ])
}
