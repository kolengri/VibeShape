// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from Extrudo c05d910395f514f4810d3fc76504ce6bb1c73da8; see NOTICE.md.
/**
 * The ASM B-rep streams (`BREP.<uuid>.smb` / `.smbh`): the
 * binary form of SAT with 8-byte integers and pointers ("ASM
 * BinaryFile8") or, in newer files, 4-byte ones ("ASM BinaryFile4"). Only what the importer needs is read: the faces, their
 * surfaces, and the tags the file attaches to them (`generic_tag_attrib_def`:
 * a token and the design record the face was made by), which is how a
 * fillet's or chamfer's edges name the faces they lie between.
 *
 * Every record is a sequence of tagged values ending in 0x11. Tags:
 * 02 char, 03 short, 04 int (8 bytes, 4 in BinaryFile4), 05 float, 06 double, 07/08/09 a
 * string with a 1/2/8-byte length, 0A/0B true/false, 0C pointer (record
 * index, −1 for none; 8 or 4 bytes like 04), 0D a record's class name, 0E a base-class name in
 * front of it, 0F/10 subtype brackets, 12 literal string (8-byte length),
 * 13 position and 14 vector (three doubles), 15 enum (8 bytes), 16 uv (two
 * doubles), 17 int64. Lengths are in centimetres.
 */
import type { AsmBSplineCurve, AsmBSplineSurface } from "./asm-spline"
import { F3dFormatError } from "./bytes"
import { F3dTextDecoder } from "./text-decoder"

export type AsmValue =
  | { t: "int"; v: number }
  | { t: "ptr"; v: number }
  | { t: "dbl"; v: number }
  | { t: "vec"; v: [number, number, number] }
  | { t: "uv"; v: [number, number] }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "open" }
  | { t: "close" }
  /** A class name inside a subtype block (`{ exact_int_cur … nubs … }`). */
  | { t: "name"; v: string }

export interface AsmRecord {
  /** `face`, `plane-surface`, `cone-surface`, `ATTRIB_CUSTOM-attrib`, … */
  type: string
  /** The record's own class, before its base classes (`intcurve-curve` for a curve whose last name is a base like `nullbs`). */
  derived?: string
  values: AsmValue[]
}

const latin1 = new F3dTextDecoder("latin1")

// One-byte values share one object each: a stream of them costs an array
// slot per byte, not an object per byte (ADR-0083, hostile files round 2).
const TRUE: AsmValue = Object.freeze({ t: "bool", v: true })
const FALSE: AsmValue = Object.freeze({ t: "bool", v: false })
const OPEN: AsmValue = Object.freeze({ t: "open" })
const CLOSE: AsmValue = Object.freeze({ t: "close" })
/**
 * At most one value or class name per `BYTES_PER_VALUE` bytes, one record per
 * `BYTES_PER_RECORD` and `MAX_VALUES` values in all. The files' streams have
 * at least 8 bytes per value, 90 per record and 2.6 million values, and cost
 * about 6.5 times their size in heap; a crafted stream within the caps costs
 * at most about 18 times (2-character strings, an object each).
 */
const BYTES_PER_VALUE = 4
const BYTES_PER_RECORD = 16
const MAX_VALUES = 16_000_000

/** Every record of an ASM binary stream, in order (a pointer is an index into it). */
export function readAsm(bytes: Uint8Array): AsmRecord[] {
  const magic = latin1.decode(bytes.subarray(0, 15))
  const width = asmWordWidth(magic)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 15 + (width === 8 ? 32 : 16)
  const int =
    width === 8
      ? (at: number) => Number(view.getBigInt64(at, true))
      : (at: number) => view.getInt32(at, true)
  const need = (n: number): void => {
    if (n < 0 || p + n > bytes.length)
      throw new F3dFormatError(`ASM: read past the end at ${p} (+${n}, end ${bytes.length}).`)
  }
  const str = (len: number, at: number) => latin1.decode(bytes.subarray(at, at + len))
  const scalar = (n: number, read: (at: number) => number) => {
    need(n)
    const value = read(p)
    p += n
    return value
  }
  const string = (prefix: 1 | 2 | 8): string => {
    need(prefix)
    const n =
      prefix === 1
        ? (bytes[p] as number)
        : prefix === 2
          ? view.getUint16(p, true)
          : Number(view.getBigInt64(p, true))
    if (prefix === 8 && (n < 0 || 8 + n > bytes.length - p))
      throw new F3dFormatError(`ASM: string length ${n} at ${p} is out of bounds.`)
    need(prefix + n)
    const value = str(n, p + prefix)
    p += prefix + n
    return value
  }
  const skipHeader = () => {
    for (let n = 0; n < 6; n++) {
      need(1)
      const t = bytes[p++]
      if (t === 0x07) string(1)
      else if (t === 0x06) scalar(8, (at) => view.getFloat64(at, true))
      else throw new F3dFormatError(`ASM header: tag ${t} at ${p - 1}.`)
    }
  }
  skipHeader()
  const records: AsmRecord[] = []
  const maxValues = Math.min(Math.ceil(bytes.length / BYTES_PER_VALUE), MAX_VALUES)
  const maxRecords = Math.ceil(bytes.length / BYTES_PER_RECORD)
  let valueCount = 0
  const types = new Map<string, string>()
  const smallInts = new Map<number, AsmValue>()
  const smallInt = (v: number): AsmValue => {
    let out = smallInts.get(v)
    if (!out) {
      out = Object.freeze({ t: "int", v })
      smallInts.set(v, out)
    }
    return out
  }
  let values: AsmValue[] = []
  let names: string[] = []
  let type = ""
  let derived = ""
  let depth = 0
  const className = (tag: number) => {
    const name = string(1)
    names.push(name)
    if (depth > 0) values.push({ t: "name", v: name })
    if (tag !== 0x0d) return
    const joined = names.join("-")
    type = types.get(joined) ?? joined
    types.set(type, type)
    if (derived === "") derived = type
    names = []
  }
  const finishRecord = () => {
    if (type === "") throw new F3dFormatError(`ASM: a record without a class at ${p - 1}.`)
    if (records.length >= maxRecords)
      throw new F3dFormatError(`ASM: more than ${maxRecords} records in ${bytes.length} bytes.`)
    records.push({ type, derived: derived || type, values })
    if (type === "End-of-ASM-data") return true
    values = []
    type = ""
    derived = ""
    depth = 0
    return false
  }
  const integer = (): AsmValue => ({ t: "int", v: scalar(width, int) })
  const readers: Record<number, () => AsmValue> = {
    4: integer,
    21: integer,
    23: integer,
    12: () => ({ t: "ptr", v: scalar(width, int) }),
    6: () => ({ t: "dbl", v: scalar(8, (at) => view.getFloat64(at, true)) }),
    5: () => ({ t: "dbl", v: scalar(4, (at) => view.getFloat32(at, true)) }),
    3: () => smallInt(scalar(2, (at) => view.getInt16(at, true))),
    2: () => smallInt(scalar(1, (at) => bytes[at] as number)),
    19: () => vector(),
    20: () => vector(),
    22: () => {
      need(16)
      const value: AsmValue = {
        t: "uv",
        v: [view.getFloat64(p, true), view.getFloat64(p + 8, true)],
      }
      p += 16
      return value
    },
    7: () => ({ t: "str", v: string(1) }),
    8: () => ({ t: "str", v: string(2) }),
    9: () => ({ t: "str", v: string(8) }),
    18: () => ({ t: "str", v: string(8) }),
    10: () => TRUE,
    11: () => FALSE,
    15: () => {
      depth++
      return OPEN
    },
    16: () => {
      depth--
      return CLOSE
    },
  }
  const vector = (): AsmValue => {
    need(24)
    const value: AsmValue = {
      t: "vec",
      v: [view.getFloat64(p, true), view.getFloat64(p + 8, true), view.getFloat64(p + 16, true)],
    }
    p += 24
    return value
  }
  const readTag = (t: number) => {
    if (t === 0x0d || t === 0x0e) className(t)
    else if (t === 0x11) {
      if (finishRecord()) return true
    } else {
      const read = readers[t]
      if (!read) throw new F3dFormatError(`ASM: unknown tag ${t} at ${p - 1}.`)
      values.push(read())
    }
    return false
  }
  while (p < bytes.length) {
    const t = bytes[p++] as number
    if (t !== 0x11 && ++valueCount > maxValues)
      throw new F3dFormatError(`ASM: more than ${maxValues} values in ${bytes.length} bytes.`)
    if (readTag(t)) return records
  }
  return records
}

function asmWordWidth(magic: string): 4 | 8 {
  if (magic === "ASM BinaryFile8") return 8
  if (magic === "ASM BinaryFile4") return 4
  throw new F3dFormatError(`Not an ASM BinaryFile8 or 4 stream (${magic}).`)
}

/** A face's surface, in model space (cm). */
export type AsmSurface =
  | { kind: "plane"; point: [number, number, number]; normal: [number, number, number] }
  | {
      kind: "cone"
      center: [number, number, number]
      axis: [number, number, number]
      /** Radius at the centre (cylinder: everywhere). */
      radius: number
      /** A cylinder: no half-angle. */
      cylinder: boolean
      /** How much the radius grows per cm along `axis` (tan of the half-angle; 0: a cylinder). */
      slope: number
    }
  | {
      kind: "sphere"
      center: [number, number, number]
      /** The pole axis (the sphere's u/v origin is arbitrary around it). */
      axis: [number, number, number]
      radius: number
      /** The file wrote a negative radius: the surface normal points inward. */
      inward: boolean
    }
  | {
      kind: "torus"
      center: [number, number, number]
      /** The torus axis (the placement's Z). */
      axis: [number, number, number]
      /** The direction of the tube centre (the placement's X). */
      ref: [number, number, number]
      /** Centre-to-tube-centre radius (as the file writes it, so it can be negative). */
      major: number
      /** Tube radius, made positive. */
      minor: number
      /** The file wrote a negative minor radius: the surface normal points inward. */
      inward: boolean
    }
  | {
      kind: "bspline"
      /** The B-spline the file stores for a `spline-surface`. */
      spline: AsmBSplineSurface
      /** The record's sense: true when its normal runs against the B-spline's (u × v). */
      reversed: boolean
    }
  | { kind: "other"; type: string }

/** An edge's curve, in model space (cm). */
export type AsmCurve =
  | { kind: "line"; point: [number, number, number]; direction: [number, number, number] }
  | {
      kind: "ellipse"
      center: [number, number, number]
      normal: [number, number, number]
      /** The major axis, as long as the major radius. */
      major: [number, number, number]
      /** Minor over major radius (1: a circle). */
      ratio: number
    }
  | {
      kind: "bspline"
      /** The B-spline the file stores for an `intcurve`. */
      spline: AsmBSplineCurve
      /** The record's sense: true when the curve runs against the B-spline's parameter. */
      reversed: boolean
    }
  | { kind: "other"; type: string }

/** One edge around a face: its curve, its vertices (cm) and the tags of the face across it. */
export interface AsmEdge {
  curve: AsmCurve
  points: [number, number, number][]
  across: { token: string; design: number }[]
}

/** A face with the tags the file gave it. */
export interface AsmFace {
  index: number
  surface: AsmSurface
  /** (token, design record) pairs from `generic_tag_attrib_def`. */
  tags: { token: string; design: number }[]
  /** The edges of all its loops. */
  edges: AsmEdge[]
}

const vec = (v: AsmValue | undefined): [number, number, number] | undefined =>
  v?.t === "vec" ? v.v : undefined

type Vector3 = [number, number, number]

function planeSurface(vs: Vector3[]): AsmSurface | undefined {
  if (vs[0] && vs[1]) return { kind: "plane", point: vs[0], normal: vs[1] }
  return undefined
}
function coneSurface(vs: Vector3[], ds: number[]): AsmSurface | undefined {
  if (!vs[0] || !vs[1] || !vs[2]) return undefined
  const major = vs[2]
  const sine = ds[1] ?? 0
  const cosine = ds[2] ?? 1
  const cylinder = Math.abs(sine) < 1e-12
  return {
    kind: "cone",
    center: vs[0],
    axis: vs[1],
    radius: Math.hypot(...major),
    cylinder,
    slope: cylinder || Math.abs(cosine) < 1e-12 ? 0 : sine / cosine,
  }
}
function sphereSurface(vs: Vector3[], ds: number[]): AsmSurface | undefined {
  if (!vs[0] || ds[0] === undefined) return undefined
  return {
    kind: "sphere",
    center: vs[0],
    axis: vs[1] ?? [0, 0, 1],
    radius: Math.abs(ds[0]),
    inward: ds[0] < 0,
  }
}
function torusSurface(vs: Vector3[], ds: number[]): AsmSurface | undefined {
  if (!vs[0] || !vs[1] || ds[0] === undefined) return undefined
  return {
    kind: "torus",
    center: vs[0],
    axis: vs[1],
    ref: vs[2] ?? [1, 0, 0],
    major: ds[0],
    minor: Math.abs(ds[1] ?? 0),
    inward: (ds[1] ?? 0) < 0,
  }
}
const surfaceReaders: [string, (vs: Vector3[], ds: number[]) => AsmSurface | undefined][] = [
  ["plane-surface", planeSurface],
  ["cone-surface", coneSurface],
  ["sphere-surface", sphereSurface],
  ["torus-surface", torusSurface],
]
function surfaceOf(r: AsmRecord | undefined): AsmSurface {
  if (!r) return { kind: "other", type: "none" }
  const vs = r.values.filter((v) => v.t === "vec").map((v) => (v as { v: Vector3 }).v)
  const ds = r.values.filter((v) => v.t === "dbl").map((v) => (v as { v: number }).v)
  for (const [suffix, read] of surfaceReaders) {
    if (!r.type.endsWith(suffix)) continue
    const surface = read(vs, ds)
    if (surface) return surface
  }
  return { kind: "other", type: r.type }
}

function lineCurve(vs: Vector3[]): AsmCurve | undefined {
  if (vs[0] && vs[1]) return { kind: "line", point: vs[0], direction: vs[1] }
  return undefined
}
function ellipseCurve(vs: Vector3[], ds: number[]): AsmCurve | undefined {
  if (vs[0] && vs[1] && vs[2] && ds[0] !== undefined)
    return { kind: "ellipse", center: vs[0], normal: vs[1], major: vs[2], ratio: ds[0] }
  return undefined
}
function curveOf(r: AsmRecord | undefined): AsmCurve {
  if (!r) return { kind: "other", type: "none" }
  const vs = r.values.filter((v) => v.t === "vec").map((v) => (v as { v: Vector3 }).v)
  const ds = r.values.filter((v) => v.t === "dbl").map((v) => (v as { v: number }).v)
  const fallback: AsmCurve = { kind: "other", type: r.type }
  if (r.type.endsWith("straight-curve")) return lineCurve(vs) ?? fallback
  if (r.type.endsWith("ellipse-curve")) return ellipseCurve(vs, ds) ?? fallback
  return fallback
}

/**
 * The tags of one `generic_tag_attrib_def` attribute: after the marker
 * string, a group count; each group a selector, a token, 0, a reference count
 * and that many design references (version 3 adds a 0 after each group).
 */
function tagsOf(r: AsmRecord): { token: string; design: number }[] {
  const out: { token: string; design: number }[] = []
  const v = r.values
  const at = v.findIndex((x) => x.t === "str" && x.v === "generic_tag_attrib_def ")
  if (at < 0) return out
  const count = v[at + 1]
  const groups = count?.t === "int" ? count.v : Number.NaN
  let i = at + 2
  for (let g = 0; g < groups && i < v.length; g++) {
    const next = tagGroup(v, i, out)
    if (next === undefined) break
    i = next
  }
  return out
}

function tagGroup(v: AsmValue[], start: number, out: { token: string; design: number }[]) {
  let i = start
  const int = () => {
    const x = v[i++]
    return x?.t === "int" ? x.v : Number.NaN
  }
  int() // selector
  const tok = v[i++]
  if (tok?.t !== "str") return undefined
  int() // reserved zero
  const n = int()
  if (!validTagReferenceCount(n, v.length - i))
    throw new F3dFormatError(`ASM tag: ${n} references at ${i} of ${v.length}.`)
  for (let k = 0; k < n; k++) out.push({ token: tok.v, design: int() })
  if (hasTrailingTagZero(v, i)) i++
  return i
}

function validTagReferenceCount(n: number, left: number) {
  return Number.isFinite(n) && n >= 0 && n <= left
}
function hasTrailingTagZero(v: AsmValue[], i: number) {
  return v[i]?.t === "int" && (v[i] as { v: number }).v === 0 && v[i + 1]?.t !== "str"
}

const pointers = (r: AsmRecord | undefined): number[] =>
  r ? r.values.filter((v) => v.t === "ptr").map((v) => (v as { v: number }).v) : []

/**
 * A face's edges: its loops (a loop points at the next loop and its first
 * coedge), each loop's coedges (the coedge pointers are next, previous and
 * partner, in that order), each coedge's edge with its curve and its
 * vertices' points, and the face across (the partner's loop's face). The
 * pointers are followed by the type they point at, and no loop or coedge is
 * walked twice, so a crafted stream can't loop.
 */
function faceEdges(
  records: AsmRecord[],
  face: number[],
  tagsOfFace: (index: number) => { token: string; design: number }[],
  step: () => void,
): AsmEdge[] {
  // A type or a subtype of it (`tedge-edge`, `tvertex-vertex`).
  const is = (p: number, type: string) => {
    const t = p >= 0 ? records[p]?.type : undefined
    return t === type || t?.endsWith(`-${type}`) === true
  }
  const of = (ptrs: number[], type: string) => ptrs.find((p) => is(p, type)) ?? -1
  const out: AsmEdge[] = []
  // Each loop and coedge once: a crafted stream's cycles end there.
  const seen = new Set<number>()
  let loop = of(face, "loop")
  while (loop >= 0 && !seen.has(loop)) {
    seen.add(loop)
    step()
    const lp = pointers(records[loop])
    let coedge = of(lp, "coedge")
    while (coedge >= 0 && !seen.has(coedge)) {
      seen.add(coedge)
      step()
      const cp = pointers(records[coedge])
      const coedges = cp.filter((p) => is(p, "coedge"))
      const edge = of(cp, "edge")
      if (edge >= 0) out.push(faceEdge(records, edge, coedges, is, of, tagsOfFace))
      coedge = coedges[0] ?? -1
    }
    loop = lp.find((p) => p !== loop && is(p, "loop")) ?? -1
  }
  return out
}

function faceEdge(
  records: AsmRecord[],
  edge: number,
  coedges: number[],
  is: (p: number, type: string) => boolean,
  of: (ptrs: number[], type: string) => number,
  tagsOfFace: (index: number) => { token: string; design: number }[],
): AsmEdge {
  const ep = pointers(records[edge])
  const points: [number, number, number][] = []
  for (const v of ep) {
    if (!is(v, "vertex")) continue
    const at = vec(records[of(pointers(records[v]), "point")]?.values.find((x) => x.t === "vec"))
    if (at) points.push(at)
  }
  const curve = ep.find((p) => p >= 0 && records[p]?.type.endsWith("curve") === true) ?? -1
  const partner = coedges[2]
  const across =
    partner === undefined
      ? -1
      : of(pointers(records[of(pointers(records[partner]), "loop")]), "face")
  return {
    curve: curveOf(records[curve]),
    points,
    across: across >= 0 ? tagsOfFace(across) : [],
  }
}

type Tag = { token: string; design: number }

/**
 * Per stream: each attribute's own tags and each attribute chain's tags, read
 * once, and the tags handed out so far against a budget. Faces that share an
 * attribute or a chain then cost nothing more, and a stream whose chains would
 * copy more tags than a few times its values is refused.
 */
interface TagCache {
  own: Map<number, Tag[]>
  chains: Map<number, Tag[]>
  spent: number
  budget: number
}
const tagCaches = new WeakMap<AsmRecord[], TagCache>()

function tagCache(records: AsmRecord[]): TagCache {
  let cache = tagCaches.get(records)
  if (!cache) {
    let values = 0
    for (const r of records) values += r.values.length
    cache = { own: new Map(), chains: new Map(), spent: 0, budget: (1 << 20) + 4 * values }
    tagCaches.set(records, cache)
  }
  return cache
}

function appendAttributeTags(ar: AsmRecord, a: number, cache: TagCache, tags: Tag[]) {
  if (ar.type.startsWith("ATTRIB_CUSTOM")) {
    let own = cache.own.get(a)
    if (!own) {
      own = tagsOf(ar)
      cache.own.set(a, own)
    }
    cache.spent += own.length
    if (cache.spent > cache.budget)
      throw new F3dFormatError("ASM tag: the faces share more tags than the stream holds.")
    for (const tag of own) tags.push(tag)
  }
}

/**
 * The (token, design record) tags of one face record, from its attribute
 * chain (at most 64 attributes are followed, each once). The array is shared
 * by the faces whose chains start at the same attribute: don't change it.
 */
export function asmFaceTags(records: AsmRecord[], face: number): Tag[] {
  const cache = tagCache(records)
  const start = pointers(records[face])[0] ?? -1
  const known = cache.chains.get(start)
  if (known) return known
  const tags: Tag[] = []
  const seen = new Set<number>()
  let a = start
  for (let guard = 0; a >= 0 && guard < 64 && !seen.has(a); guard++) {
    seen.add(a)
    const ar = records[a]
    if (!ar) break
    appendAttributeTags(ar, a, cache, tags)
    // attrib: owner-side pointers come after the attribute and history slots;
    // the next attribute is the second pointer.
    const ap = ar.values.filter((v) => v.t === "ptr").map((v) => (v as { v: number }).v)
    a = ap[1] ?? -1
  }
  cache.chains.set(start, tags)
  return tags
}

/** The faces of an ASM stream with their surfaces, tags and edges. */
export function asmFaces(records: AsmRecord[]): AsmFace[] {
  const faces: AsmFace[] = []
  const tagsAt = new Map<number, { token: string; design: number }[]>()
  records.forEach((r, index) => {
    if (r.type !== "face") return
    const ptrs = pointers(r)
    // face: attribute, (history id), next face, loop, shell, subshell, surface
    const surfacePtr = ptrs[ptrs.length - 1] ?? -1
    const tags = asmFaceTags(records, index)
    faces.push({ index, surface: surfaceOf(records[surfacePtr]), tags, edges: [] })
    tagsAt.set(index, tags)
  })
  // Faces that share loops would walk them again: the walks together may take
  // a few steps per record (each face walks its own loops in the files).
  let steps = (1 << 20) + 4 * records.length
  const step = () => {
    if (--steps < 0)
      throw new F3dFormatError("ASM: the faces share more loops than the stream holds.")
  }
  for (const face of faces)
    face.edges = faceEdges(records, pointers(records[face.index]), (i) => tagsAt.get(i) ?? [], step)
  return faces
}

export { curveOf as asmCurveOf, surfaceOf as asmSurfaceOf }
