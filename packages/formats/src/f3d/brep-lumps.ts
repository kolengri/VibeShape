// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from Extrudo c05d910395f514f4810d3fc76504ce6bb1c73da8; see NOTICE.md.
/**
 * Which solid of a B-rep stream is which design body.
 *
 * A body container lists its component's bodies and names one stream; the
 * stream's `lump` records are its solids. The two do not line up by position on
 * every file: a stream can hold solids no container lists (a hidden body's, a
 * construction or tool solid, an earlier state of a body), and the container's
 * body order is not always the stream's. What the file does carry is the face
 * tags: every face names the operations that made it, and each body's creator
 * feature has its operation IDs in the operation table (`F3dBody.ops`). So a
 * body is paired with a solid by that evidence (see {@link pairLumps}), and the
 * container order is used only where the evidence agrees with it.
 */
import { type AsmRecord, asmFaceTags } from "./asm"
import { liveLumpShells } from "./asm-lump-shells"

/** One body that names a stream, as the pairing sees it. */
export interface LumpClaim {
  /** The body record. */
  id: number
  /** Its position in the container that names the stream. */
  index: number
  /** Only shown bodies are paired; hidden ones still claim their solid. */
  visible: boolean
  /** The operation IDs of the feature that made it, when known. */
  ops?: readonly number[]
}

/** The steps a pairing may take: a crafted file cannot make it slow. */
const MAX_WORK = 1 << 22
/** A crafted stream may not make the face walk unbounded. */
const MAX_FACES = 1 << 18

const pointers = (r: AsmRecord | undefined): number[] =>
  r ? r.values.filter((v) => v.t === "ptr").map((v) => (v as { v: number }).v) : []

/**
 * The operation IDs the faces of each solid carry, one set per `lump`, in the
 * order `asmBodies` reads the solids: a lump's first shell pointer, a shell read
 * once, its face chain walked once.
 */
export function lumpOps(records: AsmRecord[]): Set<number>[] {
  const nameOf = (p: number): string => {
    const r = p >= 0 && p < records.length ? records[p] : undefined
    return r?.derived ?? r?.type ?? ""
  }
  const is = (p: number, type: string): boolean => {
    const t = nameOf(p)
    return t === type || t.endsWith(`-${type}`)
  }
  const out: Set<number>[] = []
  const faces = new Set<number>()
  for (const chain of liveLumpShells(records, is)) {
    const ops = new Set<number>()
    for (const shell of chain)
      for (const operation of shellOperations(records, shell, is, faces)) ops.add(operation)
    out.push(ops)
  }
  return out
}

function shellOperations(
  records: AsmRecord[],
  shell: number,
  is: (p: number, type: string) => boolean,
  faces: Set<number>,
) {
  const ops = new Set<number>()
  let face = pointers(records[shell]).find((p) => is(p, "face")) ?? -1
  while (face >= 0 && !faces.has(face) && faces.size < MAX_FACES) {
    faces.add(face)
    try {
      for (const tag of asmFaceTags(records, face)) ops.add(Math.abs(tag.design))
    } catch {
      // a tag this reader does not follow: the face is evidence for nothing
    }
    face = pointers(records[face]).find((p) => p !== face && is(p, "face")) ?? -1
  }
  return ops
}

/**
 * Pairs each shown body that names a stream with one of the stream's solids
 * (`lumps`: the operation IDs on each solid's faces), or says why not. In order:
 *
 * 1. **The creator's solid.** A body's candidates are the solids whose faces
 *    carry an operation of its creator. A body with one candidate takes it,
 *    unless another body has that same single candidate (both are refused);
 *    a body with several takes the one left when the others' single
 *    candidates are struck out. Hidden bodies claim their solids too.
 * 2. **The container order**, only when the stream holds as many solids as the
 *    bodies that name it and no body's evidence disagrees with its position
 *    (its candidates do not include it, or step 1 put it elsewhere).
 * 3. **The latest state.** A body with several candidates left takes the one
 *    whose operations include every other candidate's (the others are earlier
 *    states of it, or solids its creator made for a later feature), when no
 *    other body still unpaired lists that solid.
 *
 * Anything else is refused: a solid no shown body claims is never written.
 * Returns, per shown body, the solid's index or the reason.
 */
export function pairLumps(
  bodies: readonly LumpClaim[],
  lumps: readonly ReadonlySet<number>[],
): Map<number, number | string> {
  const shown = bodies.filter((b) => b.visible)
  let work = 0
  const spend = (n: number): void => {
    work += n
    if (work > MAX_WORK) throw new TooMuchWork()
  }
  try {
    return pair(bodies, shown, lumps, spend)
  } catch (error) {
    if (!(error instanceof TooMuchWork)) throw error
    return new Map(shown.map((b) => [b.id, "solid not found: too many solids"]))
  }
}

class TooMuchWork extends Error {}

type Spend = (n: number) => void
type Candidates = Map<number, Set<number>>

function operationIndex(lumps: readonly ReadonlySet<number>[], spend: Spend) {
  const withOp = new Map<number, number[]>()
  lumps.forEach((ops, k) => {
    spend(ops.size + 1)
    for (const op of ops) {
      const list = withOp.get(op) ?? []
      list.push(k)
      withOp.set(op, list)
    }
  })
  return withOp
}

function bodyCandidates(bodies: readonly LumpClaim[], withOp: Map<number, number[]>, spend: Spend) {
  const candidates: Candidates = new Map()
  for (const b of bodies) {
    if (!b.ops) continue
    const set = new Set<number>()
    for (const op of b.ops) {
      const ks = withOp.get(op) ?? []
      spend(ks.length + 1)
      for (const k of ks) set.add(k)
    }
    candidates.set(b.id, set)
  }
  return candidates
}

function singleClaims(bodies: readonly LumpClaim[], candidates: Candidates) {
  const sole = new Map<number, number[]>()
  for (const b of bodies) {
    const c = candidates.get(b.id)
    if (c?.size !== 1) continue
    const k = c.values().next().value as number
    const who = sole.get(k) ?? []
    who.push(b.id)
    sole.set(k, who)
  }
  return sole
}

function remainingSingleClaims(
  bodies: readonly LumpClaim[],
  candidates: Candidates,
  sole: Map<number, number[]>,
) {
  const second = new Map<number, number[]>()
  for (const b of bodies) {
    const c = candidates.get(b.id)
    if (!c || c.size < 2) continue
    const rest = [...c].filter((k) => !sole.has(k))
    if (rest.length !== 1) continue
    const k = rest[0] as number
    const who = second.get(k) ?? []
    who.push(b.id)
    second.set(k, who)
  }
  return second
}

function creatorClaims(bodies: readonly LumpClaim[], candidates: Candidates) {
  const sole = singleClaims(bodies, candidates)
  const taken = new Map<number, number>()
  const refused = new Set<number>()
  for (const [k, who] of sole) {
    if (who.length === 1) taken.set(who[0] as number, k)
    else for (const id of who) refused.add(id)
  }
  for (const [k, who] of remainingSingleClaims(bodies, candidates, sole))
    if (who.length === 1) taken.set(who[0] as number, k)
  return { taken, refused }
}

interface Pairing {
  candidates: Candidates
  taken: Map<number, number>
  refused: Set<number>
  used: Set<number>
  out: Map<number, number | string>
}

function agreesWithOrder(b: LumpClaim, lumpCount: number, state: Pairing) {
  const c = state.candidates.get(b.id)
  const k = state.taken.get(b.id)
  return (
    b.index >= 0 &&
    b.index < lumpCount &&
    !state.refused.has(b.id) &&
    (k === undefined ? !c || c.size === 0 || c.has(b.index) : k === b.index)
  )
}

function pairByOrder(
  bodies: readonly LumpClaim[],
  shown: readonly LumpClaim[],
  lumpCount: number,
  state: Pairing,
) {
  const ordered =
    lumpCount === bodies.length &&
    new Set(bodies.map((b) => b.index)).size === bodies.length &&
    bodies.every((b) => agreesWithOrder(b, lumpCount, state))
  if (!ordered) return
  for (const b of shown) {
    if (state.out.has(b.id) || state.used.has(b.index)) continue
    state.out.set(b.id, b.index)
    state.used.add(b.index)
  }
}

function unpairedListings(bodies: readonly LumpClaim[], state: Pairing) {
  const listedBy = new Map<number, number>()
  for (const b of bodies) {
    if (state.taken.has(b.id) || state.out.has(b.id) || state.refused.has(b.id)) continue
    for (const k of state.candidates.get(b.id) ?? []) listedBy.set(k, (listedBy.get(k) ?? 0) + 1)
  }
  return listedBy
}

function pairLatest(
  bodies: readonly LumpClaim[],
  shown: readonly LumpClaim[],
  lumps: readonly ReadonlySet<number>[],
  state: Pairing,
  spend: Spend,
) {
  const listedBy = unpairedListings(bodies, state)
  for (const b of shown) {
    if (state.out.has(b.id) || state.refused.has(b.id)) continue
    const c = state.candidates.get(b.id)
    if (!c || c.size < 2) continue
    const top = latest(
      [...c].filter((k) => !state.used.has(k)),
      lumps,
      spend,
    )
    if (top === undefined || (listedBy.get(top) ?? 0) > 1) continue
    state.out.set(b.id, top)
    state.used.add(top)
  }
}

function refusalReason(id: number, state: Pairing) {
  if (state.refused.has(id)) return "solid not found: another body claims it"
  const c = state.candidates.get(id)
  if (!c) return "solid not found: no creator"
  return c.size === 0
    ? "solid not found: creator in no solid"
    : "solid not found: creator in several solids"
}

function pair(
  bodies: readonly LumpClaim[],
  shown: readonly LumpClaim[],
  lumps: readonly ReadonlySet<number>[],
  spend: Spend,
): Map<number, number | string> {
  const candidates = bodyCandidates(bodies, operationIndex(lumps, spend), spend)
  const { taken, refused } = creatorClaims(bodies, candidates)
  const state: Pairing = {
    candidates,
    taken,
    refused,
    used: new Set(taken.values()),
    out: new Map(),
  }
  for (const b of shown) {
    const k = taken.get(b.id)
    if (k !== undefined) state.out.set(b.id, k)
  }
  pairByOrder(bodies, shown, lumps.length, state)
  pairLatest(bodies, shown, lumps, state, spend)
  for (const b of shown) if (!state.out.has(b.id)) state.out.set(b.id, refusalReason(b.id, state))
  return state.out
}

/**
 * The solid among `ks` whose operations strictly include every other one's,
 * if there is one: the largest set, which each other set is a proper subset of.
 */
function latest(
  ks: number[],
  lumps: readonly ReadonlySet<number>[],
  spend: (n: number) => void,
): number | undefined {
  if (ks.length === 0) return undefined
  spend(ks.length)
  const size = (k: number) => lumps[k]?.size ?? 0
  const top = ks.reduce((a, k) => (size(k) > size(a) ? k : a))
  const big = lumps[top] as ReadonlySet<number>
  for (const k of ks) {
    if (k === top) continue
    const s = lumps[k] as ReadonlySet<number>
    if (s.size >= big.size) return undefined
    spend(s.size)
    for (const op of s) if (!big.has(op)) return undefined
  }
  return top
}
