import type { DrawingCurve } from "@vibeshape/protocol"
import { coveringSegments } from "./drawing-segment-coverage"

type Point = readonly [number, number]
type Round = Extract<DrawingCurve, { kind: "circle" | "arc" }>
type Box = readonly [minX: number, minY: number, maxX: number, maxY: number]

/** A straight covering piece: a line, a polyline segment, or a cached chord of a circle or arc. */
export type IndexedSegment = Readonly<{ start: Point; end: Point; chord: boolean }>

/** Work counters for deterministic complexity checks; wall time is not a stable measure. */
export type CoverageStats = { chordBuilds: number; capsuleClips: number }

export type IndexChords = Readonly<{
  /** Coverage radius; chords stay within a tenth of it of the exact curve. */
  radius: number
  /** Largest turn of the curve across one chord. */
  turn: number
}>

export type IndexOptions = Readonly<{
  /** Largest distance at which a query must still find a covering piece. */
  margin: number
  chords: IndexChords
  stats?: CoverageStats | undefined
}>

const LEAF_CAPACITY = 24
const MAXIMUM_DEPTH = 24
/** A split that leaves a child with this share of the entries does not separate them. */
const SPLIT_GAIN = 0.75
const KEY_OFFSET = 2 ** 25
const KEY_SCALE = 2 ** 26

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

function grow(box: Box, margin: number): Box {
  return [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin]
}

/** Liang–Barsky clipping test: does segment start→end pass through `box`? */
function segmentTouchesBox(start: Point, end: Point, box: Box) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const sides: readonly (readonly [number, number])[] = [
    [-dx, start[0] - box[0]],
    [dx, box[2] - start[0]],
    [-dy, start[1] - box[1]],
    [dy, box[3] - start[1]],
  ]
  let from = 0
  let to = 1
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false
    } else if (p < 0) from = Math.max(from, q / p)
    else to = Math.min(to, q / p)
  }
  return from <= to
}

/** Smallest box holding every point; a loop, because spreading sampled points can exceed the engine's argument limit. */
function pointsBox(points: Iterable<Point>): Box | null {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return minX <= maxX ? [minX, minY, maxX, maxY] : null
}

/** Bounding box of a circle, or of an arc's own sweep including the axis extremes it crosses. */
function roundBox(round: Round): Box {
  const [cx, cy] = round.center
  const r = round.radius
  if (round.kind === "circle") return [cx - r, cy - r, cx + r, cy + r]
  const quarter = Math.PI / 2
  const at = (angle: number): Point => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
  const points = [at(round.startAngle), at(round.endAngle)]
  for (let step = Math.ceil(round.startAngle / quarter); step * quarter < round.endAngle; step += 1)
    points.push(at(step * quarter))
  return pointsBox(points) ?? [cx, cy, cx, cy]
}

/** Overall extent of the drawn curves; the quadtree root covers it. */
export function curvesExtent(curves: readonly DrawingCurve[]): Box {
  function* corners(): Generator<Point> {
    for (const curve of curves) {
      if (curve.kind === "line") yield* [curve.start, curve.end]
      else if (curve.kind === "polyline") yield* curve.points
      else {
        const box = roundBox(curve)
        yield* [
          [box[0], box[1]],
          [box[2], box[3]],
        ] as Point[]
      }
    }
  }
  return pointsBox(corners()) ?? [0, 0, 1, 1]
}

type QuadNode = {
  readonly box: Box
  readonly depth: number
  entries: number[]
  children: QuadNode[] | null
  /** Entry count that triggers the next split attempt; raised when a split would not help. */
  limit: number
}

function quadNode(box: Box, depth: number): QuadNode {
  return { box, depth, entries: [], children: null, limit: LEAF_CAPACITY }
}

/**
 * Spatial index of covering geometry. Straight pieces live in an adaptive quadtree: a leaf splits
 * once it holds more than a few pieces, so dense clusters subdivide locally while sparse areas stay
 * shallow, and each piece is registered only in the leaves its `margin` capsule reaches. Circles
 * and arcs contribute their chords once, when added, so coverage queries see only the chords near
 * the queried segment; they are also kept whole, keyed by centre, for exact concentric matching.
 */
export class CurveIndex {
  readonly #segments: IndexedSegment[] = []
  readonly #segmentBoxes: Box[] = []
  readonly #stamps: number[] = []
  readonly #root: QuadNode
  readonly #rounds = new Map<number, Round[]>()
  #stamp = 0

  readonly margin: number
  readonly #chords: IndexChords
  readonly #stats: CoverageStats | undefined

  constructor(extent: Box, options: IndexOptions) {
    this.margin = options.margin
    this.#chords = options.chords
    this.#stats = options.stats
    const margin = this.margin
    const side = Math.max(extent[2] - extent[0], extent[3] - extent[1], margin)
    this.#root = quadNode([extent[0], extent[1], extent[0] + side, extent[1] + side], 0)
  }

  add(curve: DrawingCurve) {
    if (curve.kind === "line") this.#addSegment(curve.start, curve.end, false)
    else if (curve.kind === "polyline")
      curve.points.slice(1).forEach((end, index) => {
        this.#addSegment(curve.points[index] ?? end, end, false)
      })
    else this.#addRound(curve)
  }

  /** Straight pieces, including round chords, within `margin` of segment start→end. */
  nearSegments(start: Point, end: Point): IndexedSegment[] {
    const stamp = this.#nextStamp()
    const box = segmentBox(start, end, 0)
    const found: IndexedSegment[] = []
    this.#visit(this.#root, start, end, (index) => {
      if (this.#stamps[index] === stamp) return
      this.#stamps[index] = stamp
      const segment = this.#segments[index]
      const bounds = this.#segmentBoxes[index]
      if (segment && bounds && boxesTouch(bounds, box)) found.push(segment)
    })
    return found
  }

  /** Circles and arcs whose centres lie within `tolerance` of `center`. */
  concentric(center: Point, tolerance: number): Round[] {
    const found: Round[] = []
    const [x, y] = this.#roundCell(center)
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (const round of this.#rounds.get(cellKey(x + dx, y + dy)) ?? [])
          if (Math.hypot(round.center[0] - center[0], round.center[1] - center[1]) <= tolerance)
            found.push(round)
    return found
  }

  #addRound(round: Round) {
    const key = cellKey(...this.#roundCell(round.center))
    const bucket = this.#rounds.get(key)
    if (bucket) bucket.push(round)
    else this.#rounds.set(key, [round])
    if (this.#stats) this.#stats.chordBuilds += 1
    for (const [start, end] of coveringSegments(round, this.#chords.radius, this.#chords.turn))
      this.#addSegment(start, end, true)
  }

  /** Centre cells are at least the margin wide, so a 3×3 neighbourhood finds every match. */
  #roundCell(center: Point): [number, number] {
    return [Math.floor(center[0] / this.margin), Math.floor(center[1] / this.margin)]
  }

  #addSegment(start: Point, end: Point, chord: boolean) {
    const index = this.#segments.push({ start, end, chord }) - 1
    this.#segmentBoxes.push(segmentBox(start, end, this.margin))
    this.#insert(this.#root, index)
  }

  /** True when the piece's margin capsule may reach the node (conservative at the corners). */
  #reaches(node: QuadNode, index: number) {
    const segment = this.#segments[index]
    const bounds = this.#segmentBoxes[index]
    if (!segment || !bounds || !boxesTouch(bounds, node.box)) return false
    return segmentTouchesBox(segment.start, segment.end, grow(node.box, this.margin))
  }

  #insert(node: QuadNode, index: number) {
    if (node.children) {
      for (const child of node.children) if (this.#reaches(child, index)) this.#insert(child, index)
      return
    }
    node.entries.push(index)
    if (node.entries.length > node.limit) this.#split(node)
  }

  /**
   * Splits a full leaf when that separates its pieces. Pieces that all pass through one small area
   * would be copied into every child, so such a leaf instead waits until it doubles in size.
   */
  #split(node: QuadNode) {
    const [x0, y0, x1, y1] = node.box
    if (node.depth >= MAXIMUM_DEPTH || x1 - x0 <= this.margin) {
      node.limit = Infinity
      return
    }
    const [xm, ym] = [(x0 + x1) / 2, (y0 + y1) / 2]
    const children = [
      quadNode([x0, y0, xm, ym], node.depth + 1),
      quadNode([xm, y0, x1, ym], node.depth + 1),
      quadNode([x0, ym, xm, y1], node.depth + 1),
      quadNode([xm, ym, x1, y1], node.depth + 1),
    ]
    for (const index of node.entries)
      for (const child of children) if (this.#reaches(child, index)) child.entries.push(index)
    const largest = children.reduce((most, child) => Math.max(most, child.entries.length), 0)
    if (largest > node.entries.length * SPLIT_GAIN) {
      node.limit = node.entries.length * 2
      return
    }
    node.entries = []
    node.children = children
    for (const child of children) if (child.entries.length > child.limit) this.#split(child)
  }

  #visit(node: QuadNode, start: Point, end: Point, visit: (index: number) => void) {
    if (!segmentTouchesBox(start, end, node.box)) return
    if (node.children) for (const child of node.children) this.#visit(child, start, end, visit)
    else for (const index of node.entries) visit(index)
  }

  #nextStamp() {
    this.#stamp += 1
    return this.#stamp
  }
}

function cellKey(x: number, y: number) {
  return (x + KEY_OFFSET) * KEY_SCALE + (y + KEY_OFFSET)
}
