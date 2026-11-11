import { DRAWING_STANDARD_SCALES, type DrawingSettings } from "@vibeshape/domain/drawing"
import type { DrawingViewId, DrawingViewProjection } from "@vibeshape/protocol"

export const SHEET_BORDER_MM = 10
export const TITLE_BLOCK_WIDTH_MM = 180
export const TITLE_BLOCK_HEIGHT_MM = 32
/** Clear space between the annotation envelopes of neighbouring views. */
const ENVELOPE_SEPARATION_MM = 6

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
  /** True when every view and its annotation envelope lies inside the drawing area. */
  fits: boolean
  placements: readonly ViewPlacement[]
}>

/** Sheet millimetres that a view's annotations extend beyond its projected rectangle. */
export type AnnotationMargins = Readonly<{
  left: number
  right: number
  bottom: number
  top: number
}>

/**
 * Measures the annotations (dimensions, callouts, label) of one view placed at `factor`. Margins
 * depend only on the view and scale, never on the view's position on the sheet.
 */
export type MeasureAnnotations = (
  projection: DrawingViewProjection,
  orthographic: boolean,
  factor: number,
) => AnnotationMargins

type Span = { min: number; max: number }
function grow(spans: Map<number, Span>, key: number, min: number, max: number) {
  const span = spans.get(key)
  spans.set(
    key,
    span ? { min: Math.min(span.min, min), max: Math.max(span.max, max) } : { min, max },
  )
}

type CellView = Readonly<{
  projection: DrawingViewProjection
  cell: Cell
  orthographic: boolean
  /** Coordinate ranges shared with the view's column and row; the isometric view uses its own. */
  reference: Readonly<{ x: Span; y: Span }>
}>

function cellViews(
  views: readonly DrawingViewProjection[],
  projection: DrawingSettings["projection"],
  isoCell: Cell,
): CellView[] {
  const ortho = views.flatMap((view) =>
    view.view === "isometric" ? [] : [{ view, cell: ORTHOGRAPHIC_CELLS[projection][view.view] }],
  )
  const columns = new Map<number, Span>()
  const rows = new Map<number, Span>()
  for (const { view, cell } of ortho) {
    grow(columns, cell[0], view.bounds.min[0], view.bounds.max[0])
    grow(rows, cell[1], view.bounds.min[1], view.bounds.max[1])
  }
  const placed: CellView[] = ortho.map(({ view, cell }) => ({
    projection: view,
    cell,
    orthographic: true,
    reference: {
      x: columns.get(cell[0]) ?? { min: 0, max: 0 },
      y: rows.get(cell[1]) ?? { min: 0, max: 0 },
    },
  }))
  const iso = views.find((view) => view.view === "isometric")
  if (iso)
    placed.push({
      projection: iso,
      cell: isoCell,
      orthographic: false,
      reference: {
        x: { min: iso.bounds.min[0], max: iso.bounds.max[0] },
        y: { min: iso.bounds.min[1], max: iso.bounds.max[1] },
      },
    })
  return placed
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

type Band = { size: number; before: number; after: number }
const NO_MARGINS: AnnotationMargins = { left: 0, right: 0, bottom: 0, top: 0 }

/** Model span plus annotation margins before and after the view along one axis. */
function axisExtent(view: CellView, axis: 0 | 1, margins: AnnotationMargins): Band {
  const span = axis === 0 ? view.reference.x : view.reference.y
  return axis === 0
    ? { size: span.max - span.min, before: margins.left, after: margins.right }
    : { size: span.max - span.min, before: margins.bottom, after: margins.top }
}

/** Bands along one axis (columns or rows) with model size and annotation margins on each side. */
function bands(
  views: readonly CellView[],
  axis: 0 | 1,
  margins: ReadonlyMap<CellView, AnnotationMargins>,
) {
  const result = new Map<number, Band>()
  for (const view of views) {
    const extent = axisExtent(view, axis, margins.get(view) ?? NO_MARGINS)
    const band = result.get(view.cell[axis]) ?? { size: 0, before: 0, after: 0 }
    result.set(view.cell[axis], {
      size: Math.max(band.size, extent.size),
      before: Math.max(band.before, extent.before),
      after: Math.max(band.after, extent.after),
    })
  }
  return result
}

/** Sheet length of the bands at `factor`, including annotation margins and separations. */
function bandLength(bandMap: ReadonlyMap<number, Band>, factor: number) {
  const values = [...bandMap.values()]
  return (
    values.reduce((sum, band) => sum + band.before + band.size * factor + band.after, 0) +
    ENVELOPE_SEPARATION_MM * Math.max(0, values.length - 1)
  )
}

type Arrangement = Readonly<{
  factor: number
  fits: boolean
  placements: ViewPlacement[]
}>

function arrange(
  views: readonly CellView[],
  factor: number,
  area: Rect,
  measure: (view: CellView) => AnnotationMargins,
): Arrangement {
  const margins = new Map(views.map((view) => [view, measure(view)]))
  const columns = bands(views, 0, margins)
  const rows = bands(views, 1, margins)
  const width = bandLength(columns, factor)
  const height = bandLength(rows, factor)
  const columnLeft = new Map<number, number>()
  let cursor = area.x + (area.width - width) / 2
  for (const column of [...columns.keys()].sort((a, b) => a - b)) {
    const band = columns.get(column)
    if (!band) continue
    columnLeft.set(column, cursor + band.before)
    cursor += band.before + band.size * factor + band.after + ENVELOPE_SEPARATION_MM
  }
  const rowBottom = new Map<number, number>()
  cursor = area.y + (area.height + height) / 2
  for (const row of [...rows.keys()].sort((a, b) => b - a)) {
    const band = rows.get(row)
    if (!band) continue
    cursor -= band.after + band.size * factor
    rowBottom.set(row, cursor)
    cursor -= band.before + ENVELOPE_SEPARATION_MM
  }
  const placements = views.map((view): ViewPlacement => {
    const [column, row] = view.cell
    const { x, y } = view.reference
    const cellWidth = (columns.get(column)?.size ?? 0) * factor
    const cellHeight = (rows.get(row)?.size ?? 0) * factor
    const left = (columnLeft.get(column) ?? area.x) + (cellWidth - (x.max - x.min) * factor) / 2
    const bottom = (rowBottom.get(row) ?? area.y) + (cellHeight - (y.max - y.min) * factor) / 2
    const origin = [left - x.min * factor, bottom - y.min * factor] as const
    const { min, max } = view.projection.bounds
    return {
      projection: view.projection,
      orthographic: view.orthographic,
      origin,
      rect: {
        x: origin[0] + min[0] * factor,
        y: origin[1] + min[1] * factor,
        width: (max[0] - min[0]) * factor,
        height: (max[1] - min[1]) * factor,
      },
    }
  })
  const tolerance = 1e-9
  return {
    factor,
    fits: width <= area.width + tolerance && height <= area.height + tolerance,
    placements,
  }
}

/**
 * Places views in projection-aligned cells and centres the arrangement in the drawing area. Each
 * view reserves its measured annotation margins, so a layout reported as fitting keeps every view,
 * dimension, callout and label inside the area. Automatic scale takes the largest ISO 5455 scale
 * that fits for the best isometric cell; an explicit scale reports `fits: false` when it does not.
 */
export function layoutViews(
  views: readonly DrawingViewProjection[],
  settings: Pick<DrawingSettings, "projection" | "scale">,
  area: Rect,
  measureAnnotations: MeasureAnnotations,
): SheetLayout {
  const cache = new Map<string, AnnotationMargins>()
  const measured = (factor: number) => (view: CellView) => {
    const key = `${view.projection.view}:${factor}`
    const cached = cache.get(key)
    if (cached) return cached
    const margins = measureAnnotations(view.projection, view.orthographic, factor)
    cache.set(key, margins)
    return margins
  }
  const scales: readonly (readonly [number, number])[] =
    settings.scale.mode === "explicit"
      ? [[settings.scale.numerator, settings.scale.denominator]]
      : DRAWING_STANDARD_SCALES
  const candidates = isometricCandidates(views, settings.projection).map((cell) =>
    cellViews(views, settings.projection, cell),
  )
  for (const scale of scales) {
    const factor = scale[0] / scale[1]
    for (const cells of candidates) {
      const arrangement = arrange(cells, factor, area, measured(factor))
      if (arrangement.fits) return result(arrangement, scale, views)
    }
  }
  // Nothing fits: keep the explicit scale, or the smallest standard scale, and say so.
  const scale = scales.at(-1) ?? [1, 1]
  const factor = scale[0] / scale[1]
  return result(arrange(candidates[0] ?? [], factor, area, measured(factor)), scale, views)
}

function result(
  arrangement: Arrangement,
  scale: readonly [number, number],
  views: readonly DrawingViewProjection[],
): SheetLayout {
  return {
    scale: { numerator: scale[0], denominator: scale[1] },
    fits: arrangement.fits,
    placements: views.flatMap((view) =>
      arrangement.placements.filter((item) => item.projection === view),
    ),
  }
}
