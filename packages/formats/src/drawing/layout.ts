import { DRAWING_STANDARD_SCALES, type DrawingSettings } from "@vibeshape/domain/drawing"
import type { DrawingBounds, DrawingViewId, DrawingViewProjection } from "@vibeshape/protocol"

export const SHEET_BORDER_MM = 10
export const TITLE_BLOCK_WIDTH_MM = 180
export const TITLE_BLOCK_HEIGHT_MM = 32
/** Space between view cells and around the area, sized for one dimension row plus a label. */
const CELL_GAP_MM = 24
const AREA_MARGIN_MM = 14

type Cell = readonly [column: number, row: number]
type Rect = Readonly<{ x: number; y: number; width: number; height: number }>

/**
 * Orthographic cells relative to the front view (column right, row up). First-angle places each
 * view on the side opposite to where it is seen from; third-angle places it on the same side.
 */
const ORTHOGRAPHIC_CELLS: Readonly<
  Record<DrawingSettings["projection"], Readonly<Record<Exclude<DrawingViewId, "isometric">, Cell>>>
> = {
  "first-angle": {
    front: [0, 0],
    top: [0, -1],
    bottom: [0, 1],
    right: [-1, 0],
    left: [1, 0],
    back: [2, 0],
  },
  "third-angle": {
    front: [0, 0],
    top: [0, 1],
    bottom: [0, -1],
    right: [1, 0],
    left: [-1, 0],
    back: [2, 0],
  },
}

export type ViewPlacement = Readonly<{
  projection: DrawingViewProjection
  /** Sheet rectangle of the view's projected extents at the chosen scale. */
  rect: Rect
  /** Maps a projected point (model millimetres) onto the sheet. */
  origin: readonly [number, number]
  orthographic: boolean
}>

export type SheetLayout = Readonly<{
  scale: Readonly<{ numerator: number; denominator: number }>
  fits: boolean
  placements: readonly ViewPlacement[]
}>

type Span = { min: number; max: number }
function grow(spans: Map<number, Span>, key: number, min: number, max: number) {
  const span = spans.get(key)
  spans.set(
    key,
    span ? { min: Math.min(span.min, min), max: Math.max(span.max, max) } : { min, max },
  )
}
const size = (bounds: DrawingBounds, axis: 0 | 1) => bounds.max[axis] - bounds.min[axis]

function viewCells(
  views: readonly DrawingViewProjection[],
  projection: DrawingSettings["projection"],
  isoCell: Cell,
) {
  const ortho = views.flatMap((view) =>
    view.view === "isometric" ? [] : [{ view, cell: ORTHOGRAPHIC_CELLS[projection][view.view] }],
  )
  const iso = views.find((view) => view.view === "isometric")
  const columns = new Map<number, Span>()
  const rows = new Map<number, Span>()
  for (const { view, cell } of ortho) {
    grow(columns, cell[0], view.bounds.min[0], view.bounds.max[0])
    grow(rows, cell[1], view.bounds.min[1], view.bounds.max[1])
  }
  return { ortho, iso, isoCell: iso ? isoCell : null, columns, rows }
}

/**
 * Candidate pictorial cells: the four corners around the front view, then the free cell right of
 * the arrangement. A corner whose row and column already exist costs no extra sheet space.
 */
function isometricCandidates(
  views: readonly DrawingViewProjection[],
  projection: DrawingSettings["projection"],
) {
  const used = views.flatMap((view) =>
    view.view === "isometric" ? [] : [ORTHOGRAPHIC_CELLS[projection][view.view]],
  )
  if (!used.length) return [[0, 0] as Cell]
  const right = Math.max(...used.map(([column]) => column))
  const left = Math.min(...used.map(([column]) => column))
  const corners: Cell[] = [
    [Math.max(1, right), 1],
    [Math.min(-1, left), 1],
    [Math.max(1, right), -1],
    [Math.min(-1, left), -1],
    [right + 1, 0],
  ]
  return corners.filter(
    (cell, index) =>
      !used.some(([column, row]) => column === cell[0] && row === cell[1]) &&
      corners.findIndex((other) => other[0] === cell[0] && other[1] === cell[1]) === index,
  )
}

/** Per-cell content extent in model millimetres; scaling is linear, gaps are fixed sheet millimetres. */
function extents(cells: ReturnType<typeof viewCells>) {
  const widths = new Map<number, number>()
  const heights = new Map<number, number>()
  for (const [column, span] of cells.columns) widths.set(column, span.max - span.min)
  for (const [row, span] of cells.rows) heights.set(row, span.max - span.min)
  if (cells.iso && cells.isoCell) {
    const [column, row] = cells.isoCell
    widths.set(column, Math.max(widths.get(column) ?? 0, size(cells.iso.bounds, 0)))
    heights.set(row, Math.max(heights.get(row) ?? 0, size(cells.iso.bounds, 1)))
  }
  const sortedColumns = [...widths.keys()].sort((a, b) => a - b)
  const sortedRows = [...heights.keys()].sort((a, b) => b - a)
  const modelWidth = sortedColumns.reduce((sum, column) => sum + (widths.get(column) ?? 0), 0)
  const modelHeight = sortedRows.reduce((sum, row) => sum + (heights.get(row) ?? 0), 0)
  return { widths, heights, sortedColumns, sortedRows, modelWidth, modelHeight }
}

function chooseScale(scale: DrawingSettings["scale"], maximum: number) {
  if (scale.mode === "explicit") {
    const value = scale.numerator / scale.denominator
    return {
      numerator: scale.numerator,
      denominator: scale.denominator,
      fits: value <= maximum * (1 + 1e-9),
    }
  }
  const standard = DRAWING_STANDARD_SCALES.find(
    ([numerator, denominator]) => numerator / denominator <= maximum * (1 + 1e-9),
  )
  const [numerator, denominator] = standard ?? DRAWING_STANDARD_SCALES.at(-1) ?? [1, 1]
  return { numerator, denominator, fits: standard !== undefined }
}

/** Places views in projection-aligned cells and centres the arrangement in the drawing area. */
export function layoutViews(
  views: readonly DrawingViewProjection[],
  settings: Pick<DrawingSettings, "projection" | "scale">,
  area: Rect,
): SheetLayout {
  let best: { cells: ReturnType<typeof viewCells>; maximum: number } | null = null
  for (const candidate of isometricCandidates(views, settings.projection)) {
    const cells = viewCells(views, settings.projection, candidate)
    const maximum = maximumScale(cells, area)
    if (!best || maximum > best.maximum * (1 + 1e-9)) best = { cells, maximum }
  }
  if (!best) throw new Error("A drawing needs at least one view.")
  return placeViews(best.cells, best.maximum, settings.scale, area, views)
}

function maximumScale(cells: ReturnType<typeof viewCells>, area: Rect) {
  const { sortedColumns, sortedRows, modelWidth, modelHeight } = extents(cells)
  const availableWidth =
    area.width - 2 * AREA_MARGIN_MM - CELL_GAP_MM * Math.max(0, sortedColumns.length - 1)
  const availableHeight =
    area.height - 2 * AREA_MARGIN_MM - CELL_GAP_MM * Math.max(0, sortedRows.length - 1)
  return Math.max(
    0,
    Math.min(
      modelWidth > 0 ? availableWidth / modelWidth : Number.POSITIVE_INFINITY,
      modelHeight > 0 ? availableHeight / modelHeight : Number.POSITIVE_INFINITY,
    ),
  )
}

function placeViews(
  cells: ReturnType<typeof viewCells>,
  maximum: number,
  scale: DrawingSettings["scale"],
  area: Rect,
  views: readonly DrawingViewProjection[],
): SheetLayout {
  const { widths, heights, sortedColumns, sortedRows, modelWidth, modelHeight } = extents(cells)
  const chosen = chooseScale(scale, maximum)
  const factor = chosen.numerator / chosen.denominator
  const totalWidth = modelWidth * factor + CELL_GAP_MM * Math.max(0, sortedColumns.length - 1)
  const totalHeight = modelHeight * factor + CELL_GAP_MM * Math.max(0, sortedRows.length - 1)
  const columnLeft = new Map<number, number>()
  let cursor = area.x + (area.width - totalWidth) / 2
  for (const column of sortedColumns) {
    columnLeft.set(column, cursor)
    cursor += (widths.get(column) ?? 0) * factor + CELL_GAP_MM
  }
  const rowBottom = new Map<number, number>()
  cursor = area.y + (area.height + totalHeight) / 2
  for (const row of sortedRows) {
    cursor -= (heights.get(row) ?? 0) * factor
    rowBottom.set(row, cursor)
    cursor -= CELL_GAP_MM
  }
  const place = (
    projection: DrawingViewProjection,
    cell: Cell,
    reference: { x: Span; y: Span },
    orthographic: boolean,
  ): ViewPlacement => {
    const [column, row] = cell
    const cellWidth = (widths.get(column) ?? 0) * factor
    const cellHeight = (heights.get(row) ?? 0) * factor
    const left =
      (columnLeft.get(column) ?? area.x) +
      (cellWidth - (reference.x.max - reference.x.min) * factor) / 2
    const bottom =
      (rowBottom.get(row) ?? area.y) +
      (cellHeight - (reference.y.max - reference.y.min) * factor) / 2
    const origin = [left - reference.x.min * factor, bottom - reference.y.min * factor] as const
    const { min, max } = projection.bounds
    return {
      projection,
      orthographic,
      origin,
      rect: {
        x: origin[0] + min[0] * factor,
        y: origin[1] + min[1] * factor,
        width: (max[0] - min[0]) * factor,
        height: (max[1] - min[1]) * factor,
      },
    }
  }
  const placements = cells.ortho.map(({ view, cell }) =>
    place(
      view,
      cell,
      {
        x: cells.columns.get(cell[0]) ?? { min: 0, max: 0 },
        y: cells.rows.get(cell[1]) ?? { min: 0, max: 0 },
      },
      true,
    ),
  )
  if (cells.iso && cells.isoCell) {
    const { min, max } = cells.iso.bounds
    placements.push(
      place(
        cells.iso,
        cells.isoCell,
        { x: { min: min[0], max: max[0] }, y: { min: min[1], max: max[1] } },
        false,
      ),
    )
  }
  return {
    scale: { numerator: chosen.numerator, denominator: chosen.denominator },
    fits: chosen.fits,
    placements: views.flatMap((view) => placements.filter((item) => item.projection === view)),
  }
}
