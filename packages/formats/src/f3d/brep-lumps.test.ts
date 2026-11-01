// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from Extrudo c05d910395f514f4810d3fc76504ce6bb1c73da8; see NOTICE.md.
/**
 * Pairing a stream's solids with the design's bodies (`brep-lumps.ts`): the
 * operations on each solid's faces against each body's creator, then the
 * container order, then the latest state. Streams are hand-built, as
 * `asm.test.ts` builds them; no real file is used.
 */
import { describe, expect, it } from "bun:test"
import { readAsm } from "./asm"
import { asmBodies } from "./asm-body"
import { type LumpClaim, lumpOps, pairLumps } from "./brep-lumps"

const enc = new TextEncoder()
const i64 = (v: number): number[] => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigInt64(0, BigInt(v), true)
  return [...b]
}
const cls = (s: string): number[] => [0x0d, s.length, ...enc.encode(s)]
const str = (s: string): number[] => [0x07, s.length, ...enc.encode(s)]
const ptr = (v: number): number[] => [0x0c, ...i64(v)]
const int = (v: number): number[] => [0x04, ...i64(v)]
const rec = (type: string, ...vals: number[][]): number[] => [...cls(type), ...vals.flat(), 0x11]
const stream = (...records: number[][]): Uint8Array =>
  new Uint8Array([
    ...enc.encode("ASM BinaryFile8"),
    ...new Array<number>(32).fill(0),
    ...new Array<number>(6).fill(0).flatMap(() => [0x06, ...new Array<number>(8).fill(0)]),
    ...records.flat(),
  ])
/** A face tag naming the operation `op`. */
const tag = (op: number) =>
  rec(
    "ATTRIB_CUSTOM-attrib",
    ptr(-1),
    ptr(-1),
    str("generic_tag_attrib_def "),
    int(1),
    int(0),
    str("tok"),
    int(0),
    int(1),
    int(op),
  )
/** face: attribute, history, next face, loop, shell, subshell, surface. */
const face = (attrib: number, next: number, shell: number) =>
  rec("face", ptr(attrib), int(0), ptr(next), ptr(-1), ptr(shell), ptr(-1), ptr(-1))
const lump = (shell: number) => rec("lump", ptr(-1), int(-1), ptr(-1), ptr(shell), ptr(0))
const shell = (first: number, owner: number, next = -1) =>
  rec("shell", ptr(-1), int(-1), ptr(next), ptr(-1), ptr(first), ptr(-1), ptr(owner))

const ops = (...sets: number[][]) => sets.map((s) => new Set(s))
const body = (id: number, index: number, opsOf?: number[], visible = true): LumpClaim => ({
  id,
  index,
  visible,
  ...(opsOf ? { ops: opsOf } : {}),
})

describe("lumpOps", () => {
  it("collects the operations on each solid’s faces, in the order asmBodies reads them", () => {
    // 0 body; 1, 2 lumps; 3, 4 shells; 5, 6 faces of shell 3; 7 the face of
    // shell 4; 8 a lump naming shell 3 again (skipped); 9–11 tags.
    const records = readAsm(
      stream(
        rec("body", ptr(-1), int(1), ptr(-1), ptr(1)),
        lump(3),
        lump(4),
        shell(5, 1),
        shell(7, 2),
        face(9, 6, 3),
        face(10, -1, 3),
        face(11, -1, 4),
        lump(3),
        tag(301),
        tag(-305),
        tag(307),
      ),
    )
    expect(lumpOps(records)).toEqual([new Set([301, 305]), new Set([307])])
    expect(asmBodies(records).map((s) => s.faces.length)).toEqual([2, 1])
  })
  it("keeps stale history lumps from shifting live body indices or consuming their face evidence", () => {
    const records = readAsm(
      stream(
        rec("body", ptr(-1), int(1), ptr(-1), ptr(1)),
        lump(4),
        lump(5),
        lump(6),
        shell(7, 2),
        shell(8, 2),
        shell(9, 3),
        face(10, 8, 4),
        face(11, -1, 5),
        face(12, -1, 6),
        tag(101),
        tag(102),
        tag(202),
      ),
    )
    const solids = asmBodies(records)
    const operations = lumpOps(records)
    expect(solids.map((solid) => solid.faces.length)).toEqual([1, 1])
    expect(operations).toEqual(ops([102], [202]))
    expect(operations).toHaveLength(solids.length)
    const paired = pairLumps([body(20, 0, [102]), body(30, 1, [202])], operations)
    expect([paired.get(20), paired.get(30)]).toEqual([0, 1])
  })
  it("shares chained-shell visitation when a later lump points into the first solid's void chain", () => {
    const records = readAsm(
      stream(
        rec("body", ptr(-1), int(1), ptr(-1), ptr(1)),
        lump(3),
        lump(4),
        shell(5, 1, 4),
        shell(6, -1),
        face(7, -1, 3),
        face(8, -1, 4),
        tag(101),
        tag(202),
      ),
    )
    expect(asmBodies(records)).toHaveLength(1)
    const operations = lumpOps(records)
    expect(operations).toEqual(ops([101, 202]))
    expect(pairLumps([body(20, 0, [101]), body(30, 1, [202])], operations).get(30)).toBeTypeOf(
      "string",
    )
  })

  it("rejects conflicting shell-chain ownership in both geometry and pairing", () => {
    const records = readAsm(
      stream(
        rec("body", ptr(-1), int(1), ptr(-1), ptr(1)),
        lump(3),
        lump(4),
        shell(5, 1, 4),
        shell(6, 2),
        face(7, -1, 3),
        face(8, -1, 4),
        tag(101),
        tag(202),
      ),
    )
    expect(() => asmBodies(records)).toThrow("conflicting chained-shell ownership")
    expect(() => lumpOps(records)).toThrow("conflicting chained-shell ownership")
  })
})

describe("pairLumps", () => {
  it("takes the solid the creator made when the container lists fewer bodies than solids", () => {
    // A construction solid (another feature's) before the body's own.
    const paired = pairLumps([body(1, 0, [305])], ops([310], [301, 305, 307]))
    expect(paired.get(1)).toBe(1)
  })

  it("pairs crossed bodies by their creators, not by the container order", () => {
    const paired = pairLumps([body(1, 0, [307]), body(2, 1, [301])], ops([301, 303], [307, 313]))
    expect([paired.get(1), paired.get(2)]).toEqual([1, 0])
  })

  it("takes the latest state of a body among solids its creator made", () => {
    // The tool solid an extrude left beside the body carries only the extrude.
    const paired = pairLumps([body(1, 0, [301])], ops([301], [301, 302, 305]))
    expect(paired.get(1)).toBe(1)
  })

  it("keeps the container order when the counts match and nothing disagrees", () => {
    const paired = pairLumps(
      [body(1, 0, [301]), body(2, 1)],
      // Body 1's creator is on both solids; the second is body 2's copy of it.
      ops([301, 303], [301, 303, 350]),
    )
    expect([paired.get(1), paired.get(2)]).toEqual([0, 1])
  })

  it("pairs bodies with no creator by order only when the counts match", () => {
    expect(pairLumps([body(1, 0), body(2, 1)], ops([], [])).get(2)).toBe(1)
    expect(pairLumps([body(1, 0)], ops([], [])).get(1)).toBe("solid not found: no creator")
  })

  it("lets a hidden body claim its solid", () => {
    const paired = pairLumps(
      [body(1, 0, [301]), body(2, 1, [309], false)],
      ops([301, 309], [301, 305], [301]),
    )
    expect(paired.get(1)).toBe(1)
    expect(paired.has(2)).toBe(false)
  })

  it("refuses two bodies whose creator is on the same one solid", () => {
    const paired = pairLumps([body(1, 0, [301]), body(2, 1, [301])], ops([301], [400]))
    expect(paired.get(1)).toBe("solid not found: another body claims it")
    expect(paired.get(2)).toBe("solid not found: another body claims it")
  })

  it("refuses rather than guesses when the creator is on several equal solids", () => {
    // Two bodies a split made, and an earlier state: nothing tells the halves apart.
    const paired = pairLumps(
      [body(1, 0, [301]), body(2, 1, [323])],
      ops([301, 323], [301, 323], [301]),
    )
    expect(paired.get(1)).toBe("solid not found: creator in several solids")
    expect(paired.get(2)).toBe("solid not found: creator in several solids")
  })

  it("drops the container order for the whole stream when the evidence contradicts it", () => {
    // Body 2 sits at index 1 but its creator is on solid 2: the order is off,
    // so bodies 1 and 3, whose creator made two equal solids, are refused.
    const paired = pairLumps(
      [body(1, 0, [301]), body(2, 1, [341]), body(3, 2, [301])],
      ops([301], [301], [341]),
    )
    expect(paired.get(2)).toBe(2)
    expect(paired.get(1)).toBe("solid not found: creator in several solids")
    expect(paired.get(3)).toBe("solid not found: creator in several solids")
  })

  it("says when the creator is on no solid", () => {
    expect(pairLumps([body(1, 0, [303])], ops([305], [305, 307])).get(1)).toBe(
      "solid not found: creator in no solid",
    )
  })

  it("gives up on a crafted stream that would take too many steps", () => {
    const many = Array.from({ length: 3000 }, () => new Set([1]))
    const bodies = Array.from({ length: 3000 }, (_, i) => body(i, i, [1]))
    const paired = pairLumps(bodies, many)
    expect(paired.get(0)).toBe("solid not found: too many solids")
  })
})
