import {
  type DrawingSheet,
  type PrimitiveWriters,
  pointOnCircle,
  type SheetLayer,
  type SheetPoint,
  sheetNumber,
  writePrimitive,
} from "./sheet"

const POINTS_PER_MM = 72 / 25.4
/** Line width (mm) and dash pattern per layer, matching the SVG writer. */
const LAYER_STYLE: Readonly<Record<SheetLayer, Readonly<{ width: number; dash: string }>>> = {
  visible: { width: 0.5, dash: "[] 0 d" },
  hidden: { width: 0.25, dash: "[3 1.5] 0 d" },
  dimension: { width: 0.18, dash: "[] 0 d" },
  title: { width: 0.35, dash: "[] 0 d" },
  frame: { width: 0.7, dash: "[] 0 d" },
}

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
function encodeCharacter(character: string): readonly [code: number, width: number] {
  const extra = WIN_ANSI_EXTRA[character]
  if (extra) return extra
  const code = character.codePointAt(0) ?? 63
  if (code >= 32 && code < 127) return [code, HELVETICA_ASCII[code - 32] ?? 556]
  if (code >= 160 && code <= 255) return [code, LATIN_WIDTHS[code] ?? 556]
  return [63, 556]
}

function literalCharacter(code: number) {
  if (code === 40 || code === 41 || code === 92) return `\\${String.fromCharCode(code)}`
  if (code < 32 || code > 126) return `\\${code.toString(8).padStart(3, "0")}`
  return String.fromCharCode(code)
}

/** Encodes text for the standard WinAnsi Helvetica font as a PDF literal and its em width. */
function winAnsi(value: string) {
  const encoded = [...value].map(encodeCharacter)
  return {
    literal: `(${encoded.map(([code]) => literalCharacter(code)).join("")})`,
    width: encoded.reduce((sum, [, width]) => sum + width, 0) / 1000,
  }
}

/** Cubic Bézier segments of at most a quarter turn approximating a counter-clockwise arc. */
function arcCurves(center: SheetPoint, radius: number, start: number, end: number) {
  const n = sheetNumber
  const segments = Math.max(1, Math.ceil((end - start) / (Math.PI / 2) - 1e-9))
  const step = (end - start) / segments
  const handle = (4 / 3) * Math.tan(step / 4) * radius
  const [sx, sy] = pointOnCircle(center, radius, start)
  const parts = [`${n(sx)} ${n(sy)} m`]
  for (let index = 0; index < segments; index += 1) {
    const a = start + step * index
    const b = a + step
    const [ax, ay] = pointOnCircle(center, radius, a)
    const [bx, by] = pointOnCircle(center, radius, b)
    const controls = [
      ax - handle * Math.sin(a),
      ay + handle * Math.cos(a),
      bx + handle * Math.sin(b),
      by - handle * Math.cos(b),
      bx,
      by,
    ]
    parts.push(`${controls.map((value) => n(value)).join(" ")} c`)
  }
  return parts
}

function path(points: readonly SheetPoint[]) {
  return points
    .map(
      (point, index) =>
        `${sheetNumber(point[0])} ${sheetNumber(point[1])} ${index === 0 ? "m" : "l"}`,
    )
    .join(" ")
}

const OPERATORS: PrimitiveWriters<string[]> = {
  line: (item) => [`${path([item.start, item.end])} S`],
  circle: (item) => [...arcCurves(item.center, item.radius, 0, 2 * Math.PI), "h S"],
  arc: (item) => [...arcCurves(item.center, item.radius, item.startAngle, item.endAngle), "S"],
  polyline: (item) => [`${path(item.points)} S`],
  arrow: (item) => [`${path(item.points)} h f`],
  text: (item) => {
    const n = sheetNumber
    const encoded = winAnsi(item.text)
    const shift = encoded.width * item.height * { start: 0, middle: 0.5, end: 1 }[item.align]
    const [x, y] = item.position
    const matrix =
      item.rotation === 90 ? `0 1 -1 0 ${n(x)} ${n(y - shift)}` : `1 0 0 1 ${n(x - shift)} ${n(y)}`
    return [`BT /F1 ${n(item.height)} Tf ${matrix} Tm ${encoded.literal} Tj ET`]
  },
}

function content(sheet: DrawingSheet) {
  const lines = [`${n6(POINTS_PER_MM)} 0 0 ${n6(POINTS_PER_MM)} 0 0 cm`, "1 J 1 j 0 g 0 G"]
  let current: SheetLayer | null = null
  for (const group of sheet.groups)
    for (const primitive of group.primitives) {
      if (primitive.layer !== current) {
        current = primitive.layer
        const style = LAYER_STYLE[current]
        lines.push(`${sheetNumber(style.width)} w ${style.dash}`)
      }
      lines.push(...writePrimitive(OPERATORS, primitive))
    }
  return lines.join("\n")
}

function n6(value: number) {
  return sheetNumber(value, 6)
}

/**
 * Document information is a PDF text string, not font-encoded content: UTF-16BE hex with a byte
 * order mark preserves every character, including non-BMP ones as surrogate pairs.
 */
function infoString(value: string) {
  const units = Array.from({ length: value.length }, (_, index) =>
    value.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0"),
  )
  return `<FEFF${units.join("")}>`
}

/**
 * Single-page vector PDF 1.4 with the standard Helvetica font (not embedded). Objects are written
 * in fixed order without dates or identifiers, so identical sheets produce identical bytes.
 */
export function writeDrawingPdf(sheet: DrawingSheet): Uint8Array {
  const stream = content(sheet)
  const width = sheet.width * POINTS_PER_MM
  const height = sheet.height * POINTS_PER_MM
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n6(width)} ${n6(height)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Title ${infoString(sheet.title)} /Producer (VibeShape) >>`,
  ]
  let body = "%PDF-1.4\n%âãÏÓ\n"
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // Every character is single-byte (the binary marker is Latin-1), so string offsets are byte offsets.
  return Uint8Array.from(body, (character) => character.charCodeAt(0))
}
