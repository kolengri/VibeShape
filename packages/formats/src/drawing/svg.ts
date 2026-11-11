import { type DrawingSheet, type SheetPrimitive, sheetNumber } from "./sheet"

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

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * Standalone SVG 1.1 sheet in millimetres. Each view, the dimensions and the title block are
 * separate groups; line types come from CSS classes named after the sheet layers.
 */
export function writeDrawingSvg(sheet: DrawingSheet): string {
  const n = sheetNumber
  const y = (value: number) => n(sheet.height - value)
  const primitive = (item: SheetPrimitive): string => {
    switch (item.kind) {
      case "line":
        return `<line class="${item.layer}" x1="${n(item.start[0])}" y1="${y(item.start[1])}" x2="${n(item.end[0])}" y2="${y(item.end[1])}"/>`
      case "circle":
        return `<circle class="${item.layer}" cx="${n(item.center[0])}" cy="${y(item.center[1])}" r="${n(item.radius)}"/>`
      case "arc": {
        const start = [
          item.center[0] + item.radius * Math.cos(item.startAngle),
          item.center[1] + item.radius * Math.sin(item.startAngle),
        ] as const
        const end = [
          item.center[0] + item.radius * Math.cos(item.endAngle),
          item.center[1] + item.radius * Math.sin(item.endAngle),
        ] as const
        const large = item.endAngle - item.startAngle > Math.PI ? 1 : 0
        // Counter-clockwise in Y-up sheet space is clockwise (sweep 0) after the Y flip.
        return `<path class="${item.layer}" d="M${n(start[0])} ${y(start[1])}A${n(item.radius)} ${n(item.radius)} 0 ${large} 0 ${n(end[0])} ${y(end[1])}"/>`
      }
      case "polyline":
        return `<polyline class="${item.layer}" points="${item.points.map((point) => `${n(point[0])},${y(point[1])}`).join(" ")}"/>`
      case "arrow":
        return `<polygon points="${item.points.map((point) => `${n(point[0])},${y(point[1])}`).join(" ")}"/>`
      case "text": {
        const anchor = item.align === "start" ? "" : ` text-anchor="${item.align}"`
        const rotate =
          item.rotation === 90
            ? ` transform="rotate(-90 ${n(item.position[0])} ${y(item.position[1])})"`
            : ""
        return `<text x="${n(item.position[0])}" y="${y(item.position[1])}" font-size="${n(item.height)}"${anchor}${rotate}>${escapeXml(item.text)}</text>`
      }
    }
  }
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
