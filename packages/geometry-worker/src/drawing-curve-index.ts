import type { DrawingCurve } from "@vibeshape/protocol"

type Point = readonly [number, number]
type Line = Extract<DrawingCurve, { kind: "line" }>
type Round = Extract<DrawingCurve, { kind: "circle" | "arc" }>
export type Box = readonly [minX: number, minY: number, maxX: number, maxY: number]

const KEY_OFFSET = 2 ** 25
const KEY_SCALE = 2 ** 26
const MINIMUM_CELL_MM = 0.05

function cellKey(x: number, y: number) {
  return (x + KEY_OFFSET) * KEY_SCALE + (y + KEY_OFFSET)
}

function boxesTouch(left: Box, right: Box) {
  return left[0] <= right[2] && right[0] <= left[2] && left[1] <= right[3] && right[1] <= left[3]
}

function segmentBox(start: Point, end: Point, margin: number): Box {
  return [
    Math.min(start[0], end[0]) - margin,
    Math.min(start[1], end[1]) - margin,
    Math.max(start[0], end[0]) + margin,
    Math.max(start[1], end[1]) + margin,
  ]
}

export function roundBox(round: Round): Box {
  return [
    round.center[0] - round.radius,
    round.center[1] - round.radius,
    round.center[0] + round.radius,
    round.center[1] + round.radius,
  ]
}

/** Grid cell sizes from the drawn extent and the number of straight pieces in it. */
export function indexCellSizes(curves: readonly DrawingCurve[]) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  let pieces = 0
  const include = (point: Point) => {
    minX = Math.min(minX, point[0])
    minY = Math.min(minY, point[1])
    maxX = Math.max(maxX, point[0])
    maxY = Math.max(maxY, point[1])
  }
  for (const curve of curves) {
    if (curve.kind === "line") {
      include(curve.start)
      include(curve.end)
      pieces += 1
    } else if (curve.kind === "polyline") {
      curve.points.forEach(include)
      pieces += curve.points.length - 1
    } else {
      const [x0, y0, x1, y1] = roundBox(curve)
      include([x0, y0])
      include([x1, y1])
    }
  }
  const width = Number.isFinite(minX) ? maxX - minX : 0
  const height = Number.isFinite(minY) ? maxY - minY : 0
  const coarse = Math.max(Math.max(width, height) / 32, MINIMUM_CELL_MM)
  // Aim for a few straight pieces per cell, never coarser than the round grid.
  const dense = Math.sqrt((Math.max(width, 1) * Math.max(height, 1)) / Math.max(pieces, 1)) * 2
  return { segment: Math.min(coarse, Math.max(dense, MINIMUM_CELL_MM)), round: coarse }
}

/**
 * Spatial index of covering geometry. Straight pieces (lines and polyline segments) live in a fine
 * grid, registered only in the cells along the piece within `margin`, so long diagonal edges stay
 * cheap. Circles and arcs live in a coarse grid by bounding box. Queries deduplicate with stamps.
 */
export class CurveIndex {
  readonly #segments: Line[] = []
  readonly #segmentBoxes: Box[] = []
  readonly #segmentCells = new Map<number, number[]>()
  readonly #rounds: Round[] = []
  readonly #roundCells = new Map<number, number[]>()
  readonly #segmentStamps: number[] = []
  readonly #roundStamps: number[] = []
  #stamp = 0

  constructor(
    readonly segmentCell: number,
    readonly roundCell: number,
    /** Largest distance at which a query must still find a covering piece. */
    readonly margin: number,
  ) {}

  /** Polylines are indexed as their segments, so coverage sees straight pieces and rounds only. */
  add(curve: DrawingCurve) {
    if (curve.kind === "line") this.#addSegment(curve.start, curve.end)
    else if (curve.kind === "polyline")
      curve.points.slice(1).forEach((end, index) => {
        this.#addSegment(curve.points[index] ?? end, end)
      })
    else this.#addRound(curve)
  }

  /** Straight pieces within the index margin of segment start→end, plus rounds near its box. */
  nearSegment(start: Point, end: Point): DrawingCurve[] {
    const stamp = this.#nextStamp()
    const box = segmentBox(start, end, this.margin)
    const found: DrawingCurve[] = []
    this.#walk(start, end, 0, (key) => {
      for (const index of this.#segmentCells.get(key) ?? []) {
        if (this.#segmentStamps[index] === stamp) continue
        this.#segmentStamps[index] = stamp
        const segment = this.#segments[index]
        const bounds = this.#segmentBoxes[index]
        if (segment && bounds && boxesTouch(bounds, box)) found.push(segment)
      }
    })
    return [...found, ...this.nearRounds(box)]
  }

  /** Circles and arcs whose bounding boxes touch `box`. */
  nearRounds(box: Box): Round[] {
    const stamp = this.#nextStamp()
    const found: Round[] = []
    this.#boxCells(box, this.roundCell, (key) => {
      for (const index of this.#roundCells.get(key) ?? []) {
        if (this.#roundStamps[index] === stamp) continue
        this.#roundStamps[index] = stamp
        const round = this.#rounds[index]
        if (round && boxesTouch(roundBox(round), box)) found.push(round)
      }
    })
    return found
  }

  #addSegment(start: Point, end: Point) {
    const index =
      this.#segments.push({ kind: "line", start: [start[0], start[1]], end: [end[0], end[1]] }) - 1
    this.#segmentBoxes.push(segmentBox(start, end, this.margin))
    const cells = new Set<number>()
    // Query samples are at most a quarter cell from any query point, so registering every cell
    // within margin + half a cell of this piece's samples finds it from any point within margin.
    this.#walk(start, end, this.margin + this.segmentCell / 2, (key) => cells.add(key))
    for (const key of cells) push(this.#segmentCells, key, index)
  }

  #addRound(round: Round) {
    const index = this.#rounds.push(round) - 1
    const [x0, y0, x1, y1] = roundBox(round)
    this.#boxCells(
      [x0 - this.margin, y0 - this.margin, x1 + this.margin, y1 + this.margin],
      this.roundCell,
      (key) => push(this.#roundCells, key, index),
    )
  }

  /** Visits the fine cells within `reach` of samples spaced at most half a cell along the piece. */
  #walk(start: Point, end: Point, reach: number, visit: (key: number) => void) {
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    const steps = Math.max(1, Math.ceil(length / (this.segmentCell / 2)))
    const spread = Math.max(reach, this.segmentCell / 2)
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      const x = start[0] + (end[0] - start[0]) * t
      const y = start[1] + (end[1] - start[1]) * t
      this.#boxCells([x - spread, y - spread, x + spread, y + spread], this.segmentCell, visit)
    }
  }

  #boxCells(box: Box, size: number, visit: (key: number) => void) {
    const x0 = Math.floor(box[0] / size)
    const x1 = Math.floor(box[2] / size)
    const y0 = Math.floor(box[1] / size)
    const y1 = Math.floor(box[3] / size)
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) visit(cellKey(x, y))
  }

  #nextStamp() {
    this.#stamp += 1
    return this.#stamp
  }
}

function push(cells: Map<number, number[]>, key: number, index: number) {
  const bucket = cells.get(key)
  if (bucket) {
    if (bucket.at(-1) !== index) bucket.push(index)
  } else cells.set(key, [index])
}
