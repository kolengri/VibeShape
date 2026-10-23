import { expect, it } from "bun:test"
import {
  bottomContentHeight,
  layoutViewportGrid,
  type ViewportGridItemConfiguration,
} from "./viewport-grid-layout"

const bounds = { width: 1200, bodyHeight: 300, gap: 8 }
const persistWidth = () => {}

it("stacks measured content and starts another lane when the next item exceeds body height", () => {
  const items: ViewportGridItemConfiguration[] = [
    {
      id: "one",
      area: "right",
      width: 280,
      minWidth: 200,
      maxWidth: 420,
      onWidthChange: persistWidth,
    },
    {
      id: "two",
      area: "right",
      width: 320,
      minWidth: 240,
      maxWidth: 480,
      onWidthChange: persistWidth,
    },
    { id: "three", area: "right", width: 320 },
  ]
  const result = layoutViewportGrid(
    items,
    bounds,
    new Map([
      ["one", 120],
      ["two", 120],
      ["three", 80],
    ]),
  )
  expect(result.right.map((lane) => lane.items.map((item) => item.id))).toEqual([
    ["one", "two"],
    ["three"],
  ])
  expect(result.right[0]).toMatchObject({
    width: 320,
    minWidth: 240,
    maxWidth: 420,
    resizable: true,
  })
})

it("keeps unmeasured entries separate and gives full-height entries an exclusive final column", () => {
  const items: ViewportGridItemConfiguration[] = [
    { id: "chat", area: "right", fullHeight: true, width: 420, order: 100 },
    { id: "task", area: "right", width: 280 },
    { id: "other", area: "right", width: 280 },
  ]
  expect(
    layoutViewportGrid(items, bounds, new Map()).right.map((lane) =>
      lane.items.map((item) => item.id),
    ),
  ).toEqual([["task"], ["other"], ["chat"]])
  const measured = layoutViewportGrid(
    items,
    bounds,
    new Map([
      ["chat", 300],
      ["task", 80],
      ["other", 80],
    ]),
  )
  expect(measured.right.map((lane) => lane.items.map((item) => item.id))).toEqual([
    ["task", "other"],
    ["chat"],
  ])
  expect(measured.right[1]).toMatchObject({ fullHeight: true, width: 420, resizable: false })
})

it("moves configured mobile entries to bottom in stable order and excludes drawers from lane sizing", () => {
  const result = layoutViewportGrid(
    [
      {
        id: "chat",
        area: "right",
        order: 100,
        fullHeight: true,
        mobile: { below: 640, area: "bottom", height: "45svh" },
      },
      { id: "tree", area: "left", overlay: true },
      { id: "history", area: "bottom", order: 50 },
      { id: "task", area: "bottom" },
      { id: "hidden", area: "left", visible: false },
    ],
    { ...bounds, width: 390 },
    new Map(),
  )
  expect(result.bottom.map((item) => item.id)).toEqual(["task", "history", "chat"])
  expect(result.bottom[2]).toMatchObject({ area: "bottom", height: "45svh" })
  expect(result.left).toEqual([])
  expect(result.right).toEqual([])
  expect(result.overlays.map((item) => item.id)).toEqual(["tree"])
})

it("deducts explicit and natural bottom entries without feeding capped content height into its budget", () => {
  const { bottom } = layoutViewportGrid(
    [
      { id: "task", area: "bottom", maxHeight: "min(50svh,32rem)" },
      { id: "history", area: "bottom" },
      { id: "chat", area: "bottom", height: "45svh" },
    ],
    bounds,
    new Map(),
  )
  const heights = new Map([
    ["task", 500],
    ["history", 48],
    ["chat", 380],
  ])
  expect(bottomContentHeight(bottom, heights, 600, 8)).toBe(156)
  heights.set("task", 156)
  expect(bottomContentHeight(bottom, heights, 600, 8)).toBe(156)
  expect(bottomContentHeight(bottom, heights, 400, 8)).toBe(0)
})

it("applies configured width constraints and rejects non-finite preferred widths", () => {
  const result = layoutViewportGrid(
    [
      {
        id: "small",
        area: "left",
        width: 10,
        minWidth: 200,
        maxWidth: 420,
        onWidthChange: persistWidth,
      },
      {
        id: "large",
        area: "left",
        width: 800,
        minWidth: 280,
        maxWidth: 480,
        onWidthChange: persistWidth,
      },
      { id: "unknown", area: "left", width: Number.NaN },
    ],
    bounds,
    new Map(),
  )
  expect(result.left.map((lane) => lane.width)).toEqual([200, 480, 320])
})

it("stacks content with different preferred widths without requiring resize handlers", () => {
  const result = layoutViewportGrid(
    [
      { id: "small", area: "right", width: 220 },
      { id: "large", area: "right", width: 240 },
    ],
    bounds,
    new Map([
      ["small", 80],
      ["large", 120],
    ]),
  )
  expect(result.right).toHaveLength(1)
  expect(result.right[0]).toMatchObject({ width: 240, resizable: false })
  expect(result.right[0]?.items.map((item) => item.id)).toEqual(["small", "large"])
})
