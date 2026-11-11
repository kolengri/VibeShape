import { stripDrawingControlCharacters } from "@vibeshape/domain/drawing"
import {
  type DrawingSheet,
  type PrimitiveWriters,
  pointOnCircle,
  type SheetPoint,
  type SheetPrimitive,
  sheetNumber,
  writePrimitive,
} from "./sheet"

/** ISO 128 line widths in millimetres; hidden lines use a 3 mm dash and 1.5 mm gap. */
const STYLE = [
  ".visible{stroke:#000;stroke-width:0.5;fill:none;stroke-linecap:round;stroke-linejoin:round}",
  ".hidden{stroke:#000;stroke-width:0.25;fill:none;stroke-dasharray:3 1.5}",
  ".dimension{stroke:#000;stroke-width:0.18;fill:none}",
  ".title{stroke:#000;stroke-width:0.35;fill:none}",
  ".frame{stroke:#000;stroke-width:0.7;fill:none}",
  "polygon{fill:#000;stroke:none}",
  "text{fill:#000;stroke:none;font-family:Helvetica,Arial,sans-serif}",
].join("")

/** Drops characters XML 1.0 forbids (same rule as drawing text fields) before escaping markup. */
function escapeXml(value: string) {
  return stripDrawingControlCharacters(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** SVG elements in a Y-down viewBox; `height` flips the Y-up sheet coordinates. */
function svgWriters(height: number): PrimitiveWriters<string> {
  const n = sheetNumber
  const y = (value: number) => n(height - value)
  const points = (values: readonly SheetPoint[]) =>
    values.map((point) => `${n(point[0])},${y(point[1])}`).join(" ")
  return {
    line: (item) =>
      `<line class="${item.layer}" x1="${n(item.start[0])}" y1="${y(item.start[1])}" x2="${n(item.end[0])}" y2="${y(item.end[1])}"/>`,
    circle: (item) =>
      `<circle class="${item.layer}" cx="${n(item.center[0])}" cy="${y(item.center[1])}" r="${n(item.radius)}"/>`,
    arc: (item) => {
      const start = pointOnCircle(item.center, item.radius, item.startAngle)
      const end = pointOnCircle(item.center, item.radius, item.endAngle)
      const large = item.endAngle - item.startAngle > Math.PI ? 1 : 0
      // Counter-clockwise in Y-up sheet space is clockwise (sweep 0) after the Y flip.
      return `<path class="${item.layer}" d="M${n(start[0])} ${y(start[1])}A${n(item.radius)} ${n(item.radius)} 0 ${large} 0 ${n(end[0])} ${y(end[1])}"/>`
    },
    polyline: (item) => `<polyline class="${item.layer}" points="${points(item.points)}"/>`,
    arrow: (item) => `<polygon points="${points(item.points)}"/>`,
    text: (item) => {
      const anchor = item.align === "start" ? "" : ` text-anchor="${item.align}"`
      const [x, yValue] = [n(item.position[0]), y(item.position[1])]
      const rotate = item.rotation === 90 ? ` transform="rotate(-90 ${x} ${yValue})"` : ""
      return `<text x="${x}" y="${yValue}" font-size="${n(item.height)}"${anchor}${rotate}>${escapeXml(item.text)}</text>`
    },
  }
}

/**
 * Standalone SVG 1.1 sheet in millimetres. Each view, the dimensions and the title block are
 * separate groups; line types come from CSS classes named after the sheet layers.
 */
export function writeDrawingSvg(sheet: DrawingSheet): string {
  const writers = svgWriters(sheet.height)
  const primitive = (item: SheetPrimitive) => writePrimitive(writers, item)
  const n = sheetNumber
  const groups = sheet.groups.map(
    (group) => `<g id="${escapeXml(group.id)}">${group.primitives.map(primitive).join("")}</g>`,
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${n(sheet.width)}mm" height="${n(sheet.height)}mm" viewBox="0 0 ${n(sheet.width)} ${n(sheet.height)}">`,
    `<title>${escapeXml(sheet.title)}</title>`,
    `<style>${STYLE}</style>`,
    `<rect x="0" y="0" width="${n(sheet.width)}" height="${n(sheet.height)}" fill="#fff"/>`,
    ...groups,
    "</svg>",
    "",
  ].join("\n")
}
