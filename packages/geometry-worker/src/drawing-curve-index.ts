import type { DrawingCurve } from "@vibeshape/protocol"
import {
  type Chord,
  type ChordCache,
  type CoverageStats,
  type Round,
  segmentDistance,
} from "./drawing-round-chords"

type Point = readonly [number, number]
type Box = readonly [minX: number, minY: number, maxX: number, maxY: number]

/** A straight covering piece: a line or a polyline segment. */
export type IndexedSegment = Readonly<{ start: Point; end: Point }>

export type IndexOptions = Readonly<{
  /** Largest distance at which a query must still find a covering piece. */
  margin: number
  /** Round chords, built lazily and shared by every index of one cleanup. */
  chords: ChordCache
  stats?: CoverageStats | undefined
}>

const LEAF_CAPACITY = 24
const MAXIMUM_DEPTH = 24
/**
 * A split is refused only when it would copy most entries into several children: some child keeps
 * more than this share and the children hold more than `SPLIT_COPIES` times the entries. A lopsided
 * split that does not duplicate entries still separates them, whatever the insertion order.
 */
const SPLIT_GAIN = 0.75
const SPLIT_COPIES = 1.5
const KEY_OFFSET = 2 ** 25
const KEY_SCALE = 2 ** 26

type Entry =
  | Readonly<{ kind: "segment"; segment: IndexedSegment; bounds: Box }>
  | Readonly<{ kind: "round"; round: Round; bounds: Box }>

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
 * Spatial index of covering geometry: an adaptive quadtree whose leaves split once they hold more
 * than a few entries, so dense clusters subdivide locally while sparse areas stay shallow. Straight
 * pieces are registered in the leaves their `margin` capsule reaches; circles and arcs in the
 * leaves their `margin` band reaches. A query visits only the leaves along the queried segment and
 * takes from each round only the chords facing it, built once per round on first use. Rounds are
 * also keyed by centre for exact concentric matching.
 */
export class CurveIndex {
  readonly #entries: Entry[] = []
  readonly #stamps: number[] = []
  readonly #root: QuadNode
  readonly #rounds = new Map<number, Round[]>()
  #stamp = 0

  readonly margin: number
  readonly #chords: ChordCache
  readonly #stats: CoverageStats | undefined

  constructor(extent: Box, options: IndexOptions) {
    this.margin = options.margin
    this.#chords = options.chords
    this.#stats = options.stats
    const side = Math.max(extent[2] - extent[0], extent[3] - extent[1], this.margin)
    this.#root = quadNode([extent[0], extent[1], extent[0] + side, extent[1] + side], 0)
  }

  add(curve: DrawingCurve) {
    if (curve.kind === "line") this.#addSegment(curve.start, curve.end)
    else if (curve.kind === "polyline")
      curve.points.slice(1).forEach((end, index) => {
        this.#addSegment(curve.points[index] ?? end, end)
      })
    else this.#addRound(curve)
  }

  /** Lines and polyline segments within `margin` of segment start→end. */
  nearSegments(start: Point, end: Point): IndexedSegment[] {
    const found: IndexedSegment[] = []
    this.#near(start, end, (entry) => {
      if (entry.kind === "segment") found.push(entry.segment)
    })
    return found
  }

  /** Straight covering pieces near segment start→end: segments, and chords of nearby rounds. */
  coveringPieces(start: Point, end: Point): Chord[] {
    const found: Chord[] = []
    this.#near(start, end, (entry) => {
      if (entry.kind === "segment") found.push([entry.segment.start, entry.segment.end])
      else if (bandReaches(entry.round, start, end, this.margin))
        for (const chord of this.#chords.near(entry.round, start, end, this.margin))
          found.push(chord)
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

  /** Visits each entry near segment start→end once; entry boxes already include the margin. */
  #near(start: Point, end: Point, visit: (entry: Entry) => void) {
    const stamp = this.#nextStamp()
    const box = segmentBox(start, end, 0)
    this.#visit(this.#root, start, end, (index) => {
      if (this.#stats) this.#stats.scannedEntries += 1
      if (this.#stamps[index] === stamp) return
      this.#stamps[index] = stamp
      const entry = this.#entries[index]
      if (!entry || !boxesTouch(entry.bounds, box)) return
      if (this.#stats && entry.kind === "segment") this.#stats.candidates += 1
      visit(entry)
    })
  }

  #addRound(round: Round) {
    const key = cellKey(...this.#roundCell(round.center))
    const bucket = this.#rounds.get(key)
    if (bucket) bucket.push(round)
    else this.#rounds.set(key, [round])
    this.#insert(
      this.#root,
      this.#entries.push({ kind: "round", round, bounds: grow(roundBox(round), this.margin) }) - 1,
    )
  }

  /** Centre cells are at least the margin wide, so a 3×3 neighbourhood finds every match. */
  #roundCell(center: Point): [number, number] {
    return [Math.floor(center[0] / this.margin), Math.floor(center[1] / this.margin)]
  }

  #addSegment(start: Point, end: Point) {
    const entry: Entry = {
      kind: "segment",
      segment: { start, end },
      bounds: segmentBox(start, end, this.margin),
    }
    this.#insert(this.#root, this.#entries.push(entry) - 1)
  }

  /** True when the entry's margin capsule or band may reach the node (conservative). */
  #reaches(node: QuadNode, index: number) {
    const entry = this.#entries[index]
    if (!entry || !boxesTouch(entry.bounds, node.box)) return false
    const near = grow(node.box, this.margin)
    if (entry.kind === "segment")
      return segmentTouchesBox(entry.segment.start, entry.segment.end, near)
    return boxMeetsCircle(near, entry.round.center, entry.round.radius)
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
   * Splits a full leaf unless that would copy most of its entries into several children, as when
   * they all pass through one small area; such a leaf waits until it doubles in size.
   */
  #split(node: QuadNode) {
    if (node.depth >= MAXIMUM_DEPTH || node.box[2] - node.box[0] <= this.margin) {
      node.limit = Infinity
      return
    }
    const children = quadChildren(node)
    for (const index of node.entries)
      for (const child of children) if (this.#reaches(child, index)) child.entries.push(index)
    if (!separates(children, node.entries.length)) {
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

function quadChildren(node: QuadNode) {
  const [x0, y0, x1, y1] = node.box
  const [xm, ym] = [(x0 + x1) / 2, (y0 + y1) / 2]
  const depth = node.depth + 1
  return [
    quadNode([x0, y0, xm, ym], depth),
    quadNode([xm, y0, x1, ym], depth),
    quadNode([x0, ym, xm, y1], depth),
    quadNode([xm, ym, x1, y1], depth),
  ]
}

/** A split separates `count` entries unless one child keeps most of them and most are copied. */
function separates(children: readonly QuadNode[], count: number) {
  let largest = 0
  let copies = 0
  for (const child of children) {
    largest = Math.max(largest, child.entries.length)
    copies += child.entries.length
  }
  return largest <= count * SPLIT_GAIN || copies <= count * SPLIT_COPIES
}

/** True when the circle of `radius` around `center` passes through `box` (boundary or interior). */
function boxMeetsCircle(box: Box, center: Point, radius: number) {
  const [cx, cy] = center
  const nearest = Math.hypot(
    Math.max(box[0] - cx, 0, cx - box[2]),
    Math.max(box[1] - cy, 0, cy - box[3]),
  )
  const farthest = Math.hypot(
    Math.max(cx - box[0], box[2] - cx),
    Math.max(cy - box[1], box[3] - cy),
  )
  return nearest <= radius && radius <= farthest
}

/** True when segment start→end comes within `margin` of the round's full circle. */
function bandReaches(round: Round, start: Point, end: Point, margin: number) {
  const nearest = segmentDistance(round.center, start, end)
  const farthest = Math.max(
    Math.hypot(start[0] - round.center[0], start[1] - round.center[1]),
    Math.hypot(end[0] - round.center[0], end[1] - round.center[1]),
  )
  return nearest <= round.radius + margin && farthest >= round.radius - margin
}

function cellKey(x: number, y: number) {
  return (x + KEY_OFFSET) * KEY_SCALE + (y + KEY_OFFSET)
}
