import type { DrawingCurve } from "@vibeshape/protocol"

type Point = readonly [number, number]
export type Round = Extract<DrawingCurve, { kind: "circle" | "arc" }>
export type Chord = readonly [start: Point, end: Point]

const FULL_TURN = 2 * Math.PI

/** Work counters for deterministic complexity checks; wall time is not a stable measure. */
export type CoverageStats = {
  /** Circles and arcs whose chords were built. */
  chordBuilds: number
  /** Index leaf entries scanned by coverage queries, duplicates across leaves included. */
  scannedEntries: number
  /** Covering pieces handed to clipping: nearby segments and the round chords facing a query. */
  candidates: number
}

export type ChordShape = Readonly<{
  /** Coverage radius; chords stay within a tenth of it of the exact curve. */
  radius: number
  /** Largest turn of the curve across one chord. */
  turn: number
}>

/**
 * Chords of one circle or arc at equal angular steps. Each chord's sagitta is at most a tenth of
 * the coverage radius, so its capsule stays within that margin of the exact tube around the curve,
 * and each chord turns at most `turn`, so its direction stays within half of that of the tangent.
 */
class RoundChords {
  readonly #round: Round
  readonly #from: number
  readonly #step: number
  readonly #points: Point[]

  constructor(round: Round, shape: ChordShape) {
    const [from, to] = round.kind === "arc" ? [round.startAngle, round.endAngle] : [0, FULL_TURN]
    const sagitta = shape.radius / 10
    const limit =
      round.radius <= sagitta
        ? shape.turn
        : Math.min(shape.turn, 2 * Math.acos(1 - sagitta / round.radius))
    const count = Math.max(1, Math.ceil((to - from) / limit))
    this.#round = round
    this.#from = from
    this.#step = (to - from) / count
    this.#points = Array.from({ length: count + 1 }, (_, index): Point => {
      const angle = from + this.#step * index
      return [
        round.center[0] + round.radius * Math.cos(angle),
        round.center[1] + round.radius * Math.sin(angle),
      ]
    })
  }

  get count() {
    return this.#points.length - 1
  }

  /**
   * Chords that may lie within `margin` of segment start→end. Seen from the centre, a segment that
   * misses it sweeps less than half a turn, monotonically; a point within `margin` of the segment
   * and near the curve differs in direction by at most asin(margin / (radius − 2·margin)).
   */
  near(start: Point, end: Point, margin: number): Chord[] {
    const [cx, cy] = this.#round.center
    const inner = this.#round.radius - 2 * margin
    const a = Math.atan2(start[1] - cy, start[0] - cx)
    const sweep = normalizedTurn(Math.atan2(end[1] - cy, end[0] - cx) - a)
    if (inner <= margin || segmentDistance([cx, cy], start, end) <= margin)
      return this.#chords(0, this.count - 1)
    const spread = Math.asin(margin / inner) + this.#step
    const low = Math.min(a, a + sweep) - spread
    const high = Math.max(a, a + sweep) + spread
    if (high - low >= FULL_TURN) return this.#chords(0, this.count - 1)
    const to = this.#from + this.#step * this.count
    const found: Chord[] = []
    // Shift the window by whole turns onto every overlap with the round's own angle range.
    const first = Math.ceil((this.#from - high) / FULL_TURN)
    const last = Math.floor((to - low) / FULL_TURN)
    for (let turn = first; turn <= last; turn += 1) {
      const shift = turn * FULL_TURN
      const from = Math.floor((low + shift - this.#from) / this.#step)
      const until = Math.floor((high + shift - this.#from) / this.#step)
      for (const chord of this.#chords(Math.max(from, 0), Math.min(until, this.count - 1)))
        found.push(chord)
    }
    return found
  }

  #chords(first: number, last: number): Chord[] {
    const chords: Chord[] = []
    for (let index = first; index <= last; index += 1) {
      const start = this.#points[index]
      const end = this.#points[index + 1]
      if (start && end) chords.push([start, end])
    }
    return chords
  }
}

/** Angle in (−π, π]. */
function normalizedTurn(angle: number) {
  const turned = angle - FULL_TURN * Math.round(angle / FULL_TURN)
  return turned <= -Math.PI ? turned + FULL_TURN : turned
}

export function segmentDistance(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
        )
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t))
}

/**
 * Chords built on the first query that reaches a circle or arc and shared by every index of one
 * cleanup, so rounds that no sampled curve comes near are never chorded.
 */
export class ChordCache {
  readonly #chords = new Map<Round, RoundChords>()

  constructor(
    readonly shape: ChordShape,
    readonly stats?: CoverageStats | undefined,
  ) {}

  near(round: Round, start: Point, end: Point, margin: number): Chord[] {
    let chords = this.#chords.get(round)
    if (!chords) {
      chords = new RoundChords(round, this.shape)
      this.#chords.set(round, chords)
      if (this.stats) this.stats.chordBuilds += 1
    }
    const found = chords.near(start, end, margin)
    if (this.stats) this.stats.candidates += found.length
    return found
  }
}
