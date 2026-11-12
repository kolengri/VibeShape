import type { DrawingSettings } from "@vibeshape/domain/drawing"
import { TITLE_BLOCK_HEIGHT_MM, TITLE_BLOCK_WIDTH_MM } from "./layout"
import type { DrawingSheetCopy, SheetPoint, SheetPrimitive } from "./sheet"
import { textWidthMm } from "./text-metrics"

/** Published sheet-size names; these are standard designations, not translatable copy. */
const SHEET_NAMES: Readonly<Record<DrawingSettings["sheetSize"], string>> = {
  "iso-a4": "ISO A4",
  "iso-a3": "ISO A3",
  "iso-a2": "ISO A2",
  "iso-a1": "ISO A1",
  "iso-a0": "ISO A0",
  "us-letter": "ANSI A (Letter)",
  "us-tabloid": "ANSI B (Tabloid)",
}
const CAPTION_HEIGHT_MM = 1.8
const VALUE_HEIGHT_MM = 3.5
const TITLE_HEIGHT_MM = 5

type Cell = Readonly<{
  x: number
  y: number
  width: number
  height: number
  caption: string
  value: string
  valueHeight?: number
}>

export type TitleBlockInput = Readonly<{
  origin: SheetPoint
  settings: DrawingSettings
  copy: DrawingSheetCopy
  scaleText: string
}>

/** ISO 7200-style 180 × 32 mm block: identification row above material, author and sheet data. */
export function titleBlock({
  origin,
  settings,
  copy,
  scaleText,
}: TitleBlockInput): SheetPrimitive[] {
  const fields = settings.titleBlock
  const captions = copy.captions
  const cells: Cell[] = [
    {
      x: 0,
      y: 20,
      width: 120,
      height: 12,
      caption: captions.title,
      value: fields.title,
      valueHeight: TITLE_HEIGHT_MM,
    },
    {
      x: 120,
      y: 20,
      width: 60,
      height: 12,
      caption: captions.drawingNumber,
      value: fields.drawingNumber,
    },
    { x: 0, y: 10, width: 70, height: 10, caption: captions.material, value: fields.material },
    { x: 70, y: 10, width: 50, height: 10, caption: captions.author, value: fields.author },
    { x: 120, y: 10, width: 60, height: 10, caption: captions.date, value: fields.date },
    { x: 0, y: 0, width: 40, height: 10, caption: captions.scale, value: scaleText },
    {
      x: 40,
      y: 0,
      width: 30,
      height: 10,
      caption: captions.units,
      value: copy.units[settings.units],
    },
    {
      x: 70,
      y: 0,
      width: 50,
      height: 10,
      caption: captions.projection,
      value: copy.projections[settings.projection],
    },
    {
      x: 120,
      y: 0,
      width: 60,
      height: 10,
      caption: captions.sheet,
      value: SHEET_NAMES[settings.sheetSize],
    },
  ]
  const at = (x: number, y: number): SheetPoint => [origin[0] + x, origin[1] + y]
  const result: SheetPrimitive[] = [
    {
      kind: "polyline",
      layer: "title",
      points: [
        at(0, 0),
        at(TITLE_BLOCK_WIDTH_MM, 0),
        at(TITLE_BLOCK_WIDTH_MM, TITLE_BLOCK_HEIGHT_MM),
        at(0, TITLE_BLOCK_HEIGHT_MM),
        at(0, 0),
      ],
    },
    { kind: "line", layer: "title", start: at(0, 10), end: at(TITLE_BLOCK_WIDTH_MM, 10) },
    { kind: "line", layer: "title", start: at(0, 20), end: at(TITLE_BLOCK_WIDTH_MM, 20) },
  ]
  for (const cell of cells) {
    if (cell.x > 0)
      result.push({
        kind: "line",
        layer: "title",
        start: at(cell.x, cell.y),
        end: at(cell.x, cell.y + cell.height),
      })
    const valueHeight = cell.valueHeight ?? VALUE_HEIGHT_MM
    const reserved = cell.caption === captions.projection ? 16 : 3
    result.push({
      kind: "text",
      layer: "title",
      position: at(cell.x + 1.5, cell.y + cell.height - 1 - CAPTION_HEIGHT_MM),
      height: CAPTION_HEIGHT_MM,
      text: fit(cell.caption, cell.width - 3, CAPTION_HEIGHT_MM),
      align: "start",
      rotation: 0,
    })
    if (cell.value)
      result.push({
        kind: "text",
        layer: "title",
        position: at(cell.x + 1.5, cell.y + 1.6),
        height: valueHeight,
        text: fit(cell.value, cell.width - reserved, valueHeight),
        align: "start",
        rotation: 0,
      })
  }
  return [...result, ...projectionSymbol(at(105, 4.5), settings.projection)]
}

/**
 * Truncates text with an ellipsis until its measured Helvetica advance fits the cell, using the
 * same metrics as annotation clearance and the PDF writer.
 */
function fit(value: string, width: number, height: number) {
  if (textWidthMm(value, height) <= width) return value
  const characters = [...value]
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (textWidthMm(`${characters.slice(0, middle).join("")}…`, height) <= width) low = middle
    else high = middle - 1
  }
  return `${characters.slice(0, low).join("")}…`
}

/**
 * ISO 5456-2 projection symbol of a truncated cone: first-angle shows the elevation left of the
 * end view, third-angle shows the end view left of the elevation.
 */
function projectionSymbol(center: SheetPoint, projection: DrawingSettings["projection"]) {
  const [cx, cy] = center
  const coneX = projection === "first-angle" ? cx - 5 : cx + 5
  const circlesX = projection === "first-angle" ? cx + 5 : cx - 5
  const result: SheetPrimitive[] = [
    {
      kind: "polyline",
      layer: "title",
      points: [
        [coneX - 3, cy - 3],
        [coneX + 3, cy - 1.5],
        [coneX + 3, cy + 1.5],
        [coneX - 3, cy + 3],
        [coneX - 3, cy - 3],
      ],
    },
    { kind: "circle", layer: "title", center: [circlesX, cy], radius: 3 },
    { kind: "circle", layer: "title", center: [circlesX, cy], radius: 1.5 },
  ]
  return result
}
