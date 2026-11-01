// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from Extrudo c05d910395f514f4810d3fc76504ce6bb1c73da8; see NOTICE.md.
/**
 * Sketch geometry: points, lines, circles and arcs, splines and conics. Coordinates are in the
 * sketch's own frame, in centimetres. A point and every curve end with a
 * reference to the sketch they belong to (the "owner backlink"); a curve names
 * its points directly (a line its end and start, a circle its centre).
 */
import { F3dFormatError, finite, type Reader } from "../bytes"
import type { Segment } from "../segment"
import { decodeLevel, type RecordDecoder, unsupported } from "./common"

export const SKETCH_POINT = "C2CEDAE7-1716-47C1-B7B1-07B70081D0FB"
export const SKETCH_LINE = "DCA267ED-D615-4934-B64F-AD805E8003E2"
/**
 * A line subclass (v0) with a line's members after a reference to its
 * incidence record; in the files it runs across profiles (construction).
 */
export const SKETCH_LINE_ALT = "AE42BAB6-643F-4169-A33C-529C8E0A4D84"
export const SKETCH_CIRCULAR = "F0130424-8B7E-4092-93C9-1CA807482534"
export const SKETCH_SPLINE = "D82E012F-6DDD-4AED-BDE1-C0F7F9100B9B"
export const SKETCH_CONIC = "111A78C2-801B-4D1D-B92D-05E2B34D991F"
export const SKETCH_ELLIPSE = "FF23079A-D99C-47AB-940E-2F4E18F022AB"

export type Vec3 = [number, number, number]

function vec3(r: Reader): Vec3 {
  return [r.f64(), r.f64(), r.f64()]
}

function curveIds(props: Map<string, bigint>): { tag?: bigint; secondary?: bigint } {
  const tag = props.get("crv_primary_id"),
    secondary = props.get("crv_secondary_id")
  return {
    ...(tag !== undefined ? { tag } : {}),
    ...(secondary !== undefined ? { secondary } : {}),
  }
}

/** The sketch a point or curve belongs to, read from its last eleven bytes. */
export function ownerAtEnd(seg: Segment, r: Reader): number | undefined {
  const save = r.pos
  try {
    // Eleven bytes, or fifty-one where references carry the target's type GUID.
    for (const width of [11, 51]) {
      if (r.end - width < save) continue
      r.pos = r.end - width
      if (r.peekU8() !== 1) continue
      try {
        const owner = r.ref()
        if (r.pos === r.end && owner && !owner.external && owner.segment === undefined)
          if (seg.typeOf(owner.id)?.guid === SKETCH) return owner.id
      } catch {
        // not a reference at this width
      }
    }
    return undefined
  } finally {
    r.pos = save
  }
}

const SKETCH = "44A64366-4BD3-4B24-881A-F94C206E8F2D"

/**
 * Whether a curve is construction geometry, from the flag bytes after its
 * last point reference. Where the flag sits depends on the record layout,
 * told apart by the tail's length (less 40 where references carry their type
 * GUID): found from the curves the file's own profiles use, which are never
 * construction.
 */
const constructionOffsets = {
  line: new Map([
    [49, 0],
    [52, 6],
    [56, 6],
  ]),
  circle: new Map([
    [51, 2],
    [54, 8],
    [58, 8],
  ]),
}
function constructionFlag(r: Reader, kind: "line" | "circle"): boolean {
  let n = r.end - r.pos
  if (n > 80) n -= 40
  const at = constructionOffsets[kind].get(n)
  return at !== undefined && r.peekU8(at) === 1
}

export interface SketchPoint {
  id: number
  /** Persistent point id (`pt_tag`), shared with the B-rep's sketch attributes. */
  tag?: bigint
  /** Position in the sketch frame, cm. */
  at: Vec3
  incidence: number
  owner?: number
}

function sketchPointPosition(r: Reader, version: number): Vec3 {
  if (version === 0) {
    r.u8()
    const at: Vec3 = [r.f64(), r.f64(), 0]
    r.skip(20 + 4 + 12 + 8 + 10)
    return at
  }
  if (version !== 8 && version !== 10 && version !== 11) unsupported("sketch point", version)
  r.skip(version === 11 ? 8 : 7)
  const at = vec3(r)
  r.u64big() // selector
  r.u8() // state
  r.zeros(version === 8 ? 8 : 12)
  r.skip(8) // two f32 ones
  r.skip(5)
  return at
}

export const sketchPoint: RecordDecoder<SketchPoint> = {
  name: "sketch point",
  decode: (seg, id) =>
    decodeLevel(seg, id, "sketch point", (r, props, version) => {
      const incidence = r.localRef()
      const at = sketchPointPosition(r, version)
      finite(`Sketch point #${id}`, at)
      if (r.localRef() !== incidence)
        throw new F3dFormatError(`Point #${id}: repeated reference differs.`)
      if (r.remaining === 15) r.zeros(4)
      const owner = r.remaining > 0 ? r.ref() : null
      const tag = props.get("pt_tag")
      return {
        id,
        ...(tag !== undefined ? { tag } : {}),
        at,
        incidence,
        ...(owner ? { owner: owner.id } : {}),
      }
    }),
}

export interface SketchLine {
  id: number
  /** Persistent curve id (`crv_primary_id`). */
  tag?: bigint
  /** Which piece of a curve split after it was drawn (`crv_secondary_id`; 0: never split). */
  secondary?: bigint
  start: Vec3
  end: Vec3
  startPoint: number
  endPoint: number
  construction: boolean
  owner?: number
}

export const sketchLine: RecordDecoder<SketchLine> = {
  name: "sketch line",
  decode: (seg, id) =>
    decodeLevel(seg, id, "sketch line", (r, props, version) => {
      const alt = seg.typeOf(id)?.guid === SKETCH_LINE_ALT
      if (alt ? version !== 0 : version !== 1 && version !== 2) unsupported("sketch line", version)
      const owner = ownerAtEnd(seg, r)
      // A referenced analytic wrapper may precede the line.
      if (refAhead(seg, r) !== undefined) r.ref()
      const start = vec3(r)
      const d = vec3(r)
      vec3(r) // unit direction
      // The full form stores a unit normal; the compact planar form goes
      // straight on to the point references.
      if (!isPointRef(seg, r)) vec3(r)
      finite(`Sketch line #${id}`, [...start, ...d])
      const endPoint = r.localRef()
      const startPoint = r.localRef()
      // The subclass is drawn through profiles without splitting them: taken
      // as construction (a profile running along one still uses it).
      const construction = alt || constructionFlag(r, "line")
      r.pos = r.end // flags and the owner backlink
      return {
        id,
        ...curveIds(props),
        start,
        end: [start[0] + d[0], start[1] + d[1], start[2] + d[2]],
        startPoint,
        endPoint,
        construction,
        ...(owner !== undefined ? { owner } : {}),
      }
    }),
}

function isPointRef(seg: Segment, r: Reader): boolean {
  const id = refAhead(seg, r)
  return id !== undefined && seg.typeOf(id)?.guid === SKETCH_POINT
}

/**
 * The id of the local reference starting at the reader's position, or
 * undefined when the bytes there are not one: a marker byte, an existing
 * record id, then either the two zero flag bytes or the inline type GUID.
 */
export function refAhead(seg: Segment, r: Reader): number | undefined {
  if (r.peekU8() !== 1) return undefined
  const lo = r.peekU32(1)
  if (lo === undefined || r.peekU32(5) !== 0 || !seg.has(lo)) return undefined
  const next = r.peekU32(9)
  if (next === 36) return lo
  return r.peekU8(9) === 0 && r.peekU8(10) === 0 ? lo : undefined
}

export interface SketchCircular {
  id: number
  tag?: bigint
  /** Which piece of a curve split after it was drawn (`crv_secondary_id`; 0: never split). */
  secondary?: bigint
  center: Vec3
  /** The plane normal and the zero-angle direction. */
  normal: Vec3
  xAxis: Vec3
  radius: number
  /** Angles from `xAxis` about `normal`; a full circle runs 0 to 2π. */
  startAngle: number
  endAngle: number
  centerPoint: number
  /** An arc's end points (absent for a full circle). */
  startPoint?: number
  endPoint?: number
  construction: boolean
  owner?: number
}

export const sketchCircular: RecordDecoder<SketchCircular> = {
  name: "sketch circle/arc",
  decode: (seg, id) =>
    decodeLevel(seg, id, "sketch circle/arc", (r, props, version) => {
      if (version !== 0) unsupported("sketch circle/arc", version)
      const owner = ownerAtEnd(seg, r)
      if (refAhead(seg, r) !== undefined) r.ref()
      const center = vec3(r)
      const normal = vec3(r)
      const xAxis = vec3(r)
      const radius = r.f64()
      const startAngle = r.f64()
      const endAngle = r.f64()
      finite(`Sketch circle/arc #${id}`, [
        ...center,
        ...normal,
        ...xAxis,
        radius,
        startAngle,
        endAngle,
      ])
      if (!(radius > 0)) throw new F3dFormatError(`Sketch circle/arc #${id}: radius ${radius}.`)
      const centerPoint = r.localRef()
      const out: SketchCircular = {
        id,
        center,
        normal,
        xAxis,
        radius,
        startAngle,
        endAngle,
        centerPoint,
        construction: false,
      }
      Object.assign(out, curveIds(props))
      // An arc names its end and start points after the centre.
      if (isPointRef(seg, r)) {
        out.endPoint = r.localRef()
        out.startPoint = r.localRef()
        out.construction = constructionFlag(r, "line")
      } else out.construction = constructionFlag(r, "circle")
      if (owner !== undefined) out.owner = owner
      r.pos = r.end
      return out
    }),
}

export interface SketchSpline {
  id: number
  tag?: bigint
  /** Which piece of a curve split after it was drawn (`crv_secondary_id`; 0: never split). */
  secondary?: bigint
  degree: number
  /** The knot vector as stored (not normalised). */
  knots: number[]
  /** One per pole for a rational curve; empty otherwise. */
  weights: number[]
  /** Control points in the sketch frame, cm. */
  poles: Vec3[]
  startPoint?: number
  endPoint?: number
  /** A conic's rho (its poles are start, shoulder and end), and its shoulder point. */
  rho?: number
  shoulderPoint?: number
  construction: boolean
  owner?: number
}

/**
 * A spline: the most-derived level holds the curve's ids and an 8-byte carrier
 * (all 0xff, or a reference); the base level names two helper records, the
 * end and start points, then `u8 1, u8 0`, u32 degree, f64 fit tolerance and
 * three arrays — knots, weights (empty when not rational) and xyz poles — each
 * `u32 count, u32 count, u32 8` and the values. Then a trailer this does not
 * read, and the owner backlink.
 */
export const sketchSpline: RecordDecoder<SketchSpline> = {
  name: "sketch spline",
  decode: (seg, id) => {
    const props = decodeLevel(seg, id, "sketch spline", (r, props, version) => {
      if (version !== 3) unsupported("sketch spline", version)
      r.skip(8) // the carrier
      return props
    })
    const r = seg.baseReader(id)
    const owner = ownerAtEnd(seg, r)
    for (; r.remaining > 64; r.pos++) {
      const at = r.pos
      if (!isPointRef(seg, r)) continue
      const endPoint = r.localRef()
      // A closed spline may name its one point once.
      const startPoint = isPointRef(seg, r) ? r.localRef() : endPoint
      let curve: ReturnType<typeof readNurbs>
      if (r.peekU8() === 1 && r.peekU8(1) === 0) {
        r.skip(2)
        curve = readNurbs(r)
      }
      if (!curve) {
        r.pos = at
        continue
      }
      return {
        id,
        ...curveIds(props),
        ...curve,
        startPoint,
        endPoint,
        construction: false,
        ...(owner !== undefined ? { owner } : {}),
      }
    }
    throw new F3dFormatError(`Sketch spline #${id}: no curve found.`)
  },
}

/**
 * A conic curve (v0): after the curve ids, f64 rho and `u8 1, u8 0`, the curve
 * as a spline stores it — a rational quadratic with weights 1, rho / (1 − rho),
 * 1 and the start, shoulder and end as poles — then a trailer this does not
 * read and references to the shoulder, end and start points. The base level
 * ends in the owner backlink.
 */
export const sketchConic: RecordDecoder<SketchSpline> = {
  name: "sketch conic",
  decode: (seg, id) => {
    const out = decodeLevel(seg, id, "sketch conic", (r, props, version): SketchSpline => {
      if (version !== 0) unsupported("sketch conic", version)
      const rho = r.f64()
      const curve = r.u8() === 1 && r.u8() === 0 ? readNurbs(r) : undefined
      if (curve?.degree !== 2 || curve.poles.length !== 3 || !(rho > 0 && rho < 1))
        throw new F3dFormatError(`Sketch conic #${id}: no conic found.`)
      const points = conicPointReferences(seg, r, id)
      return {
        id,
        ...curveIds(props),
        ...curve,
        ...points,
        rho,
        construction: false,
      }
    })
    const owner = ownerAtEnd(seg, seg.baseReader(id))
    return owner !== undefined ? { ...out, owner } : out
  },
}

function conicPointReferences(seg: Segment, r: Reader, id: number) {
  const points: number[] = []
  while (r.remaining > 0)
    if (isPointRef(seg, r)) points.push(r.localRef())
    else r.pos++
  const [shoulderPoint, endPoint, startPoint] = points
  if (
    points.length !== 3 ||
    shoulderPoint === undefined ||
    endPoint === undefined ||
    startPoint === undefined
  )
    throw new F3dFormatError(`Sketch conic #${id}: ${points.length} point references.`)
  return { shoulderPoint, endPoint, startPoint }
}

type NurbsCurve = Pick<SketchSpline, "degree" | "knots" | "weights" | "poles">
function nurbsDegree(r: Reader): number | undefined {
  if (r.remaining < 12 + 36) return undefined
  const degree = r.u32(),
    tolerance = r.f64()
  return degree < 1 || degree > 25 || !(tolerance >= 0 && tolerance < 1) ? undefined : degree
}
function nurbsArray(r: Reader, width: number): number[] | undefined {
  if (r.remaining < 12) return undefined
  const n = r.u32()
  r.u32() // the count again
  if (r.u32() !== 8 || n * width * 8 > r.remaining) return undefined
  const out: number[] = []
  for (let i = 0; i < n * width; i++) out.push(r.f64())
  return out
}
function orderedKnots(knots: number[]) {
  for (let i = 1; i < knots.length; i++)
    if ((knots[i] as number) < (knots[i - 1] as number)) return false
  return true
}
function validNurbsArrays(degree: number, knots: number[], weights: number[], flat: number[]) {
  if (![...knots, ...flat].every(Number.isFinite) || !weights.every((w) => w > 0 && w < Infinity))
    return false
  const poles = flat.length / 3
  return (
    poles >= 2 &&
    knots.length === poles + degree + 1 &&
    (weights.length === 0 || weights.length === poles) &&
    orderedKnots(knots)
  )
}
/** u32 degree, f64 fit tolerance, knots, weights and poles; undefined when the bytes are not one. */
function readNurbs(r: Reader): NurbsCurve | undefined {
  const degree = nurbsDegree(r)
  if (degree === undefined) return undefined
  const knots = nurbsArray(r, 1)
  if (!knots) return undefined
  const weights = nurbsArray(r, 1)
  if (!weights) return undefined
  const flat = nurbsArray(r, 3)
  if (!flat || !validNurbsArrays(degree, knots, weights, flat)) return undefined
  const poles: Vec3[] = []
  for (let i = 0; i < flat.length; i += 3)
    poles.push([flat[i] as number, flat[i + 1] as number, flat[i + 2] as number])
  return { degree, knots, weights, poles }
}

export interface SketchEllipse {
  id: number
  tag?: bigint
  secondary?: bigint
  center: Vec3
  /** Unit directions of the major and minor axes (the plane normal is major × minor). */
  major: Vec3
  minor: Vec3
  majorRadius: number
  minorRadius: number
  /** Parameter angles: the point at t is center + major·a·cos t + minor·b·sin t. */
  startAngle: number
  endAngle: number
  centerPoint: number
  /** An arc's end points (absent for a whole ellipse). */
  startPoint?: number
  endPoint?: number
  owner?: number
}

/**
 * An ellipse or elliptical arc (v2): after the curve ids, [a wrapper
 * reference], the centre, the unit major and minor axis directions (3 f64
 * each), the major and minor radii, the start and end parameter angles, then
 * references to the centre point and, for an arc, its end and start points;
 * flags and the owner backlink.
 */
export const sketchEllipse: RecordDecoder<SketchEllipse> = {
  name: "sketch ellipse",
  decode: (seg, id) =>
    decodeLevel(seg, id, "sketch ellipse", (r, props, version) => {
      if (version !== 2) unsupported("sketch ellipse", version)
      const owner = ownerAtEnd(seg, r)
      if (refAhead(seg, r) !== undefined) r.ref()
      const center = vec3(r)
      const major = vec3(r)
      const minor = vec3(r)
      const majorRadius = r.f64()
      const minorRadius = r.f64()
      const startAngle = r.f64()
      const endAngle = r.f64()
      checkEllipse(id, center, major, minor, majorRadius, minorRadius, startAngle, endAngle)
      const centerPoint = r.localRef()
      const out: SketchEllipse = {
        id,
        center,
        major,
        minor,
        majorRadius,
        minorRadius,
        startAngle,
        endAngle,
        centerPoint,
      }
      Object.assign(out, curveIds(props))
      if (isPointRef(seg, r)) {
        out.endPoint = r.localRef()
        if (!isPointRef(seg, r)) r.skip(2)
        out.startPoint = r.localRef()
      }
      if (owner !== undefined) out.owner = owner
      r.pos = r.end
      return out
    }),
}

/**
 * Refuses an ellipse no sketch could hold: a number that isn't finite, a
 * radius not between 1e-9 and 1e6 cm, axes that aren't unit and square to
 * each other, or an angle past ±1,000 radians (the files keep them in a turn
 * or two). Whatever the file says, the curve then costs a bounded amount to
 * draw and trace.
 */
function checkEllipse(
  id: number,
  center: Vec3,
  major: Vec3,
  minor: Vec3,
  a: number,
  b: number,
  t0: number,
  t1: number,
): void {
  const numbers = [...center, ...major, ...minor, a, b, t0, t1]
  const unit = (v: Vec3) => Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-6
  const square = Math.abs(major[0] * minor[0] + major[1] * minor[1] + major[2] * minor[2]) < 1e-6
  const radius = (r: number) => r > 1e-9 && r < 1e6
  if (
    !numbers.every(Number.isFinite) ||
    !unit(major) ||
    !unit(minor) ||
    !square ||
    !radius(a) ||
    !radius(b) ||
    Math.abs(t0) > 1000 ||
    Math.abs(t1) > 1000
  )
    throw new F3dFormatError(`Sketch ellipse #${id}: not a curve a sketch can hold.`)
}

/** How far an elliptical arc turns, in (0, 2π]: from its start angle round to its end. */
export function ellipseSweep(e: Pick<SketchEllipse, "startAngle" | "endAngle">): number {
  const turn = 2 * Math.PI
  const sweep = (((e.endAngle - e.startAngle) % turn) + turn) % turn
  return sweep === 0 ? turn : sweep
}
