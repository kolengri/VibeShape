// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from Extrudo c05d910395f514f4810d3fc76504ce6bb1c73da8; see NOTICE.md.
/**
 * Bodies (`D3937028…`) and the links that say which feature made each
 * (`D26351F0…`).
 *
 * A body record holds, after its GUID and appearance strings in newer files,
 * u32 index (its number, as in "Body3"), u32 n and n bytes, a u32, u8 1 and
 * the light bulb: 1 shown, 0 hidden. Newer files put a −1.0 double just in
 * front of the index; older ones (class version 16) start it at payload
 * offset 10; in some it sits 16 bytes after the body's GUID string, behind
 * other numbers. Found by that shape. A STEP export of the same design leaves hidden
 * bodies out.
 *
 * A body link holds the body's GUID, then references to the body record and
 * to the feature that made the body.
 */
import type { Segment } from "../segment"

export const BODY = "D3937028-C20C-4E65-B010-94AD418A5C20"

export interface BodyFlags {
  /** Its number in the file ("Body3"). */
  index: number
  visible: boolean
}

export function readBody(seg: Segment, id: number): BodyFlags | undefined {
  const f = seg.frame(id)
  const b = seg.bulk
  // Most files put a −1.0 just before the index (or start it at offset 10);
  // in some the index is just 16 bytes after the body's GUID string, behind
  // other numbers.
  const guid = guidEnd(b, f.start, f.end)
  const anchors = [
    (p: number) => (b[p - 2] === 0xf0 && b[p - 1] === 0xbf) || p - f.start === 10,
    (p: number) => p === guid + 16,
  ]
  for (const anchored of anchors)
    for (let p = f.start; p + 14 <= f.end; p++) {
      if (!anchored(p)) continue
      const flags = bodyFlagsAt(b, p, f.end)
      if (flags) return flags
    }
  return undefined
}

/** Where the first UTF-16 GUID string (u32 36, then 36 code units) in a range ends; −1 if none. */
function guidEnd(b: Uint8Array, start: number, end: number): number {
  for (let p = start; p + 76 <= end; p++) {
    if (b[p] !== 36 || b[p + 1] !== 0 || b[p + 2] !== 0 || b[p + 3] !== 0) continue
    const guid = guidCharactersAt(b, p)
    if (guid) return p + 76
  }
  return -1
}

function bodyFlagsAt(b: Uint8Array, p: number, end: number): BodyFlags | undefined {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const index = view.getUint32(p, true)
  if (index < 1 || index > 4096) return undefined
  const n = view.getUint32(p + 4, true)
  if (n > 8) return undefined
  const q = p + 8 + n
  if (q + 6 > end || b[q + 3] !== 0 || b[q + 4] !== 1) return undefined
  const bulb = b[q + 5]
  if (bulb === 0 || bulb === 1) return { index, visible: bulb === 1 }
  return undefined
}

function hexDigit(c: number) {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46)
}

function guidCharactersAt(b: Uint8Array, p: number) {
  for (let i = 0; i < 36; i++) {
    const c = b[p + 4 + 2 * i] as number
    if (b[p + 5 + 2 * i] !== 0) return false
    if ([8, 13, 18, 23].includes(i) ? c !== 0x2d : !hexDigit(c)) return false
  }
  return true
}
