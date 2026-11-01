// SPDX-License-Identifier: GPL-3.0-or-later
// Shared live-solid admission for the adapted Extrudo B-rep reader; see NOTICE.md.
import type { AsmRecord } from "./asm"
import { F3dFormatError } from "./bytes"

type TypeCheck = (pointer: number, type: string) => boolean
const MAX_SOLIDS = 1 << 16

function firstPointer(records: AsmRecord[], index: number, type: string, is: TypeCheck) {
  const pointer = records[index]?.values.find((value) => value.t === "ptr" && is(value.v, type))
  return pointer?.t === "ptr" ? pointer.v : -1
}

function liveChain(records: AsmRecord[], lump: number, is: TypeCheck, claimed: Set<number>) {
  const first = firstPointer(records, lump, "shell", is)
  if (first < 0 || claimed.has(first)) return undefined
  const owner = firstPointer(records, first, "lump", is)
  // A stale history lump must not consume a live lump's shell or face chain.
  if (owner >= 0 && owner !== lump) return undefined
  const shells: number[] = []
  let shell = first
  while (shell >= 0 && !claimed.has(shell)) {
    const shellOwner = firstPointer(records, shell, "lump", is)
    if (shellOwner >= 0 && shellOwner !== lump)
      throw new F3dFormatError("ASM body: conflicting chained-shell ownership.")
    claimed.add(shell)
    shells.push(shell)
    shell = firstPointer(records, shell, "shell", is)
  }
  return shells
}

/** Geometry and operation pairing must consume exactly the same live solids in the same order. */
export function* liveLumpShells(records: AsmRecord[], is: TypeCheck) {
  const claimed = new Set<number>()
  let count = 0
  for (const [index, record] of records.entries()) {
    if (record.type !== "lump") continue
    const chain = liveChain(records, index, is, claimed)
    if (!chain) continue
    if (++count > MAX_SOLIDS) throw new F3dFormatError("ASM body: too many solids.")
    yield chain
  }
}
