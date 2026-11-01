// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from Extrudo c05d910395f514f4810d3fc76504ce6bb1c73da8; see NOTICE.md.
/**
 * Features that copy others: mirror (`D1728651…`), rectangular pattern
 * (`AE12AD3F…`) and path pattern (`B0B3D9E5…`), which share the circular
 * pattern's base type. What they copy sits in operand groups: a geometry
 * operand (`5A1BF548…`) holding a record reference (`90055C05…`) and a body
 * link per feature; a body operand (`9716F783…`) per body; a face operand
 * (`5662F619…`) per face.
 *
 * A mirror's plane is a geometry operand holding the plane in model space
 * (`CC54ECAD…`) beside the plane it names (an origin or construction plane).
 * A rectangular pattern's directions are direction groups (`F2A7590D…`, an
 * operand-group subtype), each holding a geometry operand with the direction
 * as a model line (`50AEE8B4…`); its counts are `countU`/`CountV` count
 * records and its distances the parameters it owns (`uSpaceDistance`,
 * `vSpaceDistance`), signed along the line.
 */
import { Reader } from "../bytes"
import type { Segment } from "../segment"
import { BODY } from "./body"
import { EDGE_OPERAND, OPERAND_GROUP } from "./edges"
import { HOLE_PLACEMENT, MODEL_PLANE, type ModelPlane, readModelPlane } from "./hole"
import { PARAMETER_VALUE, type ParameterValue, parameterValue } from "./parameters"
import { BODY_LINK, BODY_OPERAND, PATTERN_COUNT, RECORD_REF, readRecordRef } from "./pattern"
import { GEOMETRY_OPERAND, type RevolveAxis, readAxis, SKETCH_CURVE_REF } from "./revolve"
import type { Scope } from "./scope"
import type { Vec3 } from "./sketch-geometry"
import { type CurveRef, readCurveRef } from "./sweep"

export const MIRROR = "D1728651-3640-4CCF-8083-AF7703013978"
export const RECTANGULAR_PATTERN = "AE12AD3F-BB81-4B59-9D34-A599E58E4BF6"
export const PATH_PATTERN = "B0B3D9E5-1C25-47BC-ABCD-E723F193DF1B"
/** An operand group holding a pattern direction (also a hole's placement). */
const DIRECTION_GROUP = HOLE_PLACEMENT

/** What a mirror or pattern copies. */
export interface CopiedObjects {
  /** `faces`: face operands, which are not read further. */
  objects: "features" | "bodies" | "faces"
  /** Features it copies, by record. */
  features: number[]
  /** Bodies it copies, by body record. */
  bodies: number[]
}

type Inside = (id: number) => number[]

function collectCopiedBodies(seg: Segment, member: number, inside: Inside, bodies: number[]) {
  for (const link of inside(member)) {
    if (seg.typeOf(link)?.guid !== BODY_LINK) continue
    const body = inside(link).find((r) => seg.typeOf(r)?.guid === BODY)
    if (body !== undefined && !bodies.includes(body)) bodies.push(body)
  }
}
function collectCopiedFeatures(seg: Segment, member: number, inside: Inside, features: number[]) {
  const refs = inside(member)
  if (!refs.some((r) => seg.typeOf(r)?.guid === BODY_LINK)) return
  for (const ref of refs) {
    if (seg.typeOf(ref)?.guid !== RECORD_REF) continue
    const record = readRecordRef(seg, ref)
    if (!features.includes(record)) features.push(record)
  }
}
function copiedKind(
  features: number[],
  bodies: number[],
  faces: boolean,
): CopiedObjects["objects"] {
  if (features.length) return "features"
  if (bodies.length) return "bodies"
  return faces ? "faces" : "features"
}
/** The features, bodies or faces a copying feature's operand groups name. */
export function readCopied(seg: Segment, scope: Scope, inside: Inside): CopiedObjects {
  const features: number[] = [],
    bodies: number[] = []
  let faces = false
  for (const group of scope.refs) {
    if (seg.typeOf(group)?.guid !== OPERAND_GROUP) continue
    for (const member of inside(group)) {
      switch (seg.typeOf(member)?.guid) {
        case EDGE_OPERAND:
          faces = true
          break
        case BODY_OPERAND:
          collectCopiedBodies(seg, member, inside, bodies)
          break
        case GEOMETRY_OPERAND:
          collectCopiedFeatures(seg, member, inside, features)
          break
      }
    }
  }
  return { objects: copiedKind(features, bodies, faces), features, bodies }
}

/** A mirror's (or split's) plane: the model plane of its geometry operand that names no body. */
export function readMirrorPlane(
  seg: Segment,
  scope: Scope,
  inside: Inside,
): ModelPlane | undefined {
  for (const ref of scope.refs) {
    if (seg.typeOf(ref)?.guid !== GEOMETRY_OPERAND) continue
    const refs = inside(ref)
    if (refs.some((r) => seg.typeOf(r)?.guid === BODY_LINK)) continue
    const plane = refs.find((r) => seg.typeOf(r)?.guid === MODEL_PLANE)
    if (plane !== undefined) return readModelPlane(seg, plane)
  }
  return undefined
}

/**
 * A rectangular pattern's directions, in order: the line of each direction
 * group's operand, turned the way the group's own vector points. The group
 * opens with two zero bytes, a u32 (8 or 16) and two vectors: a point and
 * the direction, which is against the line where the pattern runs the other
 * way (seen once).
 */
export function readDirections(seg: Segment, scope: Scope, inside: Inside): RevolveAxis[] {
  const out: RevolveAxis[] = []
  for (const ref of scope.refs) {
    if (seg.typeOf(ref)?.guid !== DIRECTION_GROUP) continue
    const r = seg.reader(ref)
    r.zeros(2)
    r.u32()
    r.skip(24)
    const v: Vec3 = [r.f64(), r.f64(), r.f64()]
    for (const g of inside(ref)) {
      if (seg.typeOf(g)?.guid !== GEOMETRY_OPERAND) continue
      const axis = readAxis(seg, inside(g))
      if (!axis) continue
      const D = axis.direction
      if (D[0] * v[0] + D[1] * v[1] + D[2] * v[2] < 0) axis.direction = [-D[0], -D[1], -D[2]]
      out.push(axis)
      break
    }
  }
  return out
}

/** The parameter values a feature's count records name, in reference order (`countU`, `CountV`). */
export function readCounts(seg: Segment, scope: Scope, inside: Inside): ParameterValue[] {
  const out: ParameterValue[] = []
  for (const ref of scope.refs) {
    if (seg.typeOf(ref)?.guid !== PATTERN_COUNT) continue
    const value = inside(ref).find((r) => seg.typeOf(r)?.guid === PARAMETER_VALUE)
    if (value !== undefined) out.push(parameterValue.decode(seg, value))
  }
  return out
}

/**
 * A copying feature's instances: in the data record its own members name
 * first (`C444E6AD…`, `EA0E146E…`, `7493A99D…`, …), `u8 1, u32 n, n ×
 * (u64 code, u64 operation id)`, then `u32 m` and m instance records. Faces
 * an instance made carry the tag `[source op, pattern op, instance op]`. The
 * code numbers the instance: a circular pattern's from 1 (the original), a
 * rectangular pattern's Cantor-pairs its two indexes, a mirror's single one
 * is 2. Found by shape. Returns instance operation id → code.
 */
function instancePairs(r: Reader): [number, number][] | undefined {
  const n = r.u32()
  if (n < 1 || n > 10_000 || n * 16 > r.remaining) return undefined
  const list: [number, number][] = []
  // A stray marker byte is rejected at its first bad pair.
  for (let i = 0; i < n; i++) {
    const code = r.u64(),
      op = r.u64()
    if (code < 1 || code > 1e8 || op < 1 || op > 1e9) return undefined
    list.push([code, op])
  }
  return list
}
function instanceRecordsExist(seg: Segment, r: Reader) {
  const count = r.u32()
  if (count < 1 || count > 10_000) return false
  for (let i = 0; i < count; i++) if (!seg.has(r.localRef())) return false
  return true
}
function instancesAt(seg: Segment, at: number, end: number) {
  try {
    const r = new Reader(seg.bulk, at + 1, end)
    const pairs = instancePairs(r)
    if (!pairs || !instanceRecordsExist(seg, r)) return undefined
    return new Map(pairs.map(([code, op]) => [op, code]))
  } catch {
    return undefined
  }
}
export function readInstances(seg: Segment, scope: Scope, inside: Inside): Map<number, number> {
  for (const data of inside(scope.id).slice(0, 4)) {
    const f = seg.frame(data)
    for (let at = f.start; at + 5 <= f.end; at++) {
      if (seg.bulk[at] !== 1) continue
      const instances = instancesAt(seg, at, f.end)
      if (instances) return instances
    }
  }
  return new Map()
}

/** A rectangular pattern's instance code as its (u, v) indexes, the original (1, 0). */
export function cantorPair(code: number): [number, number] {
  const w = Math.floor((Math.sqrt(8 * code + 1) - 1) / 2)
  const v = code - (w * (w + 1)) / 2
  return [w - v, v]
}

/** A path pattern's data record. */
export const PATH_PATTERN_DATA = "BE1FB171-D98A-4A4D-99C2-3738627CF79C"
/** A path pattern's start-point group (an operand-group subtype). */
export const PATH_START = "69EE2FA7-BCC7-449E-9CA9-976CEFDFED44"

/** What a path pattern's own records say beyond what it copies. */
export interface PathPatternSpec {
  /** The sketch curves of the path. */
  path: CurveRef[]
  /** Where on the path the pattern starts, model space (cm). */
  start?: Vec3
  /** The distance is the whole extent (the data record's u32 is 2, as a rectangular pattern's). */
  extent: boolean
  /** Instances turn with the path's direction. */
  aligned: boolean
  /** A flag beside `aligned` that was 0 in every file seen (perhaps the direction flipped). */
  flag: number
}

/**
 * A path pattern's path, start and flags. The path is an operand group whose
 * geometry operands each name a sketch curve. The data record
 * (`BE1FB171…`): u8, u32 2 (extent, as a rectangular pattern's), a ref to the
 * count record, 4 zero bytes, a ref to the distance's parameter owner, 5
 * zero bytes, the original's reference point (3 f64, cm), then four bytes:
 * 1 where the instances turn with the path (seen in both files), 0, 1, 0;
 * then the path group and the distance (f64, cm). The start group
 * (`69EE2FA7…`): 19 bytes, the start point (3 f64), then a geometry operand
 * naming the path's first curve.
 */
export function readPathPattern(seg: Segment, scope: Scope, inside: Inside): PathPatternSpec {
  let path: CurveRef[] = []
  for (const group of scope.refs) {
    if (seg.typeOf(group)?.guid !== OPERAND_GROUP) continue
    const members = inside(group).filter((m) => seg.typeOf(m)?.guid === GEOMETRY_OPERAND)
    const curves = members.flatMap((m) => {
      const ref = inside(m).find((r) => seg.typeOf(r)?.guid === SKETCH_CURVE_REF)
      return ref !== undefined ? [readCurveRef(seg, ref)] : []
    })
    if (curves.length > 0 && curves.length === members.length) path = curves
  }
  const out: PathPatternSpec = { path, extent: false, aligned: false, flag: 0 }
  const startGroup = scope.refs.find((r) => seg.typeOf(r)?.guid === PATH_START)
  if (startGroup !== undefined) {
    const r = seg.reader(startGroup)
    r.skip(19)
    out.start = [r.f64(), r.f64(), r.f64()]
  }
  const data = inside(scope.id).find((r) => seg.typeOf(r)?.guid === PATH_PATTERN_DATA)
  if (data !== undefined) {
    const f = seg.frame(data)
    const b = seg.bulk
    out.extent = new Reader(b, f.start + 1, f.end).u32() === 2
    if (f.end - f.start >= 62) {
      out.aligned = b[f.start + 60] === 1
      out.flag = b[f.start + 61] as number
    }
  }
  return out
}
