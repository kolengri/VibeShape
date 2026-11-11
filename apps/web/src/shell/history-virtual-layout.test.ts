import { describe, expect, it } from "bun:test"
import type { VirtualItem } from "@tanstack/react-virtual"
import { historyFolderSchema } from "@vibeshape/domain"
import { authoredTestId } from "../test-support/authored-tree-fixture"
import { historyTrackLayout, historyTrackSegments } from "./history-virtual-layout"
import type { HistoryViewRow } from "./model-tree-history"

// More than 80 units switches History to the virtualized track.
const rows = Array.from({ length: 90 }, (_, index) => ({
  index,
  row: { ref: { kind: "feature", id: authoredTestId(2000 + index) } } as unknown as HistoryViewRow,
}))
const folder = historyFolderSchema.parse({
  schemaVersion: 0,
  id: authoredTestId(1990),
  name: "Long folder",
  items: rows.slice(10, 20).map(({ row }) => row.ref),
})
const groups = [
  { folder: null, rows: rows.slice(0, 10) },
  { folder, rows: rows.slice(10, 20) },
  { folder: null, rows: rows.slice(20) },
]
// Each unit is 32 px wide; the folder header unit is 120 px wide.
function measure(units: readonly { key: string }[]) {
  let start = 0
  return units.map((unit, index): VirtualItem => {
    const size = unit.key.startsWith("folder:") ? 120 : 32
    const item = { index, key: unit.key, start, end: start + size, size, lane: 0 }
    start += size
    return item
  })
}

describe("virtualized History divider segments", () => {
  it("places the boundaries around an expanded folder at its outer edges", () => {
    const { units, layout } = historyTrackLayout(groups, new Set())
    expect(units.length).toBeGreaterThan(80)
    const measurements = measure(units)
    const segments = historyTrackSegments(layout, units, measurements, new Set())
    const header = measurements[10]
    const first = segments.find((segment) => segment.first === 10)
    const last = segments.find((segment) => segment.last === 19)
    // The header occupies 320–440 px; the folder's first row starts after it at 440 px.
    expect(header).toMatchObject({ start: 320, end: 440 })
    expect(first).toMatchObject({ left: 320, right: 472 })
    expect(last?.right).toBe(measurements[20]?.end)
    const outside = segments.find((segment) => segment.first === 9)
    expect(outside).toMatchObject({ left: 288, right: 320 })
  })
})
