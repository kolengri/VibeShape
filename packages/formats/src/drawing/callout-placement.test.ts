import { describe, expect, it } from "bun:test"
import { type DrawingSettings, drawingSettingsSchema } from "@vibeshape/domain/drawing"
import {
  DRAWING_CHORD_TOLERANCE_MM,
  type DrawingProjection,
  type DrawingViewProjection,
} from "@vibeshape/protocol"
import {
  composeDrawingSheet,
  type DrawingSheet,
  type DrawingSheetCopy,
  type SheetPrimitive,
} from "./index"
import { primitiveBox, type SheetBox } from "./text-metrics"

const copy: DrawingSheetCopy = {
  viewLabels: {
    front: "Front view",
    back: "Back view",
    top: "Top view",
    bottom: "Bottom view",
    right: "Right view",
    left: "Left view",
    isometric: "Isometric view",
  },
  captions: {
    title: "Title",
    drawingNumber: "Drawing number",
    author: "Author",
    date: "Date",
    material: "Material",
    scale: "Scale",
    units: "Units",
    projection: "Projection",
    sheet: "Sheet",
  },
  projections: { "first-angle": "First angle", "third-angle": "Third angle" },
  units: { mm: "mm", in: "in" },
}

type Circle = readonly [x: number, y: number, radius: number]

/** A 40 × 30 mm top view outline with the given visible circles. */
function topView(circles: readonly Circle[]): DrawingProjection {
  const corners: [number, number][] = [
    [0, 0],
    [40, 0],
    [40, 30],
    [0, 30],
  ]
  const edges: DrawingViewProjection["edges"] = [
    ...corners.map((start, index) => ({
      visibility: "visible" as const,
      edgeClass: "sharp" as const,
      curve: { kind: "line" as const, start, end: corners[(index + 1) % 4] ?? start },
    })),
    ...circles.map(([x, y, radius]) => ({
      visibility: "visible" as const,
      edgeClass: "sharp" as const,
      curve: { kind: "circle" as const, center: [x, y] as [number, number], radius },
    })),
  ]
  return {
    chordTolerance: DRAWING_CHORD_TOLERANCE_MM,
    bodyCount: 1,
    views: [{ view: "top", bounds: { min: [0, 0], max: [40, 30] }, edges }],
  }
}

function compose(circles: readonly Circle[], overrides: Partial<DrawingSettings> = {}) {
  return composeDrawingSheet({
    projection: topView(circles),
    settings: {
      ...drawingSettingsSchema.parse({ views: ["top"] }),
      scale: { mode: "explicit", numerator: 1, denominator: 1 },
      ...overrides,
    },
    copy,
    documentTitle: "Callouts",
  })
}

const primitivesOf = (sheet: DrawingSheet, ids: readonly string[]) =>
  sheet.groups.filter(({ id }) => ids.includes(id)).flatMap(({ primitives }) => primitives)
const texts = (sheet: DrawingSheet) =>
  primitivesOf(sheet, ["dimensions", "labels"]).filter(
    (item): item is Extract<SheetPrimitive, { kind: "text" }> => item.kind === "text",
  )
const intersects = (left: SheetBox, right: SheetBox) =>
  left[0] < right[2] && right[0] < left[2] && left[1] < right[3] && right[1] < left[3]

function overlappingTexts(sheet: DrawingSheet) {
  const all = texts(sheet)
  return all.flatMap((left, index) =>
    all
      .slice(index + 1)
      .filter((right) => intersects(primitiveBox(left), primitiveBox(right)))
      .map((right) => [left.text, right.text]),
  )
}

const near = (left: readonly number[], right: readonly number[]) =>
  Math.hypot((left[0] ?? 0) - (right[0] ?? 0), (left[1] ?? 0) - (right[1] ?? 0)) < 1e-6

type Line = Extract<SheetPrimitive, { kind: "line" }>
type Point = readonly [number, number]

/** The far end of the line that touches `point`, skipping `except`. */
function continueFrom(lines: readonly Line[], point: Point, except?: Line) {
  const next = lines.find(
    (item) => item !== except && (near(item.start, point) || near(item.end, point)),
  )
  if (!next) return null
  return { line: next, end: near(next.start, point) ? next.end : next.start }
}

/** Follows a Ø label through its shoulder and leader to the arrow tip. */
function leaderTip(lines: readonly Line[], label: Extract<SheetPrimitive, { kind: "text" }>) {
  const side = label.align === "end" ? 1 : -1
  const shoulder = continueFrom(lines, [label.position[0] + side, label.position[1] + 1])
  return shoulder ? (continueFrom(lines, shoulder.end, shoulder.line)?.end ?? null) : null
}

/** Checks that each Ø label's leader starts on a drawn circle of the labelled diameter. */
function calloutRoutes(sheet: DrawingSheet, units: DrawingSettings["units"] = "mm") {
  const factor = sheet.scale.numerator / sheet.scale.denominator
  const lines = primitivesOf(sheet, ["dimensions"]).filter(
    (item): item is Line => item.kind === "line",
  )
  const circles = primitivesOf(sheet, ["view-top"]).filter(
    (item): item is Extract<SheetPrimitive, { kind: "circle" }> => item.kind === "circle",
  )
  // Labels round to 2 (mm) or 3 (in) decimals; compare the sheet radius within that rounding.
  const scaleToSheet = (units === "in" ? 25.4 : 1) * factor
  const rounding = (units === "in" ? 0.0005 : 0.005) * scaleToSheet
  return texts(sheet)
    .filter((label) => label.text.includes("Ø"))
    .map((label) => {
      const tip = leaderTip(lines, label)
      const radius = (Number(label.text.split("Ø")[1]) / 2) * scaleToSheet
      const routed =
        tip !== null &&
        circles.some(
          (circle) =>
            Math.abs(circle.radius - radius) <= rounding &&
            Math.abs(
              Math.hypot(tip[0] - circle.center[0], tip[1] - circle.center[1]) - circle.radius,
            ) < 1e-6,
        )
      return { text: label.text, routed }
    })
}

describe("diameter callout placement", () => {
  const cases: [string, Circle[], string[]][] = [
    [
      "concentric 5 and 6 mm radii at 1:1",
      [
        [20, 15, 5],
        [20, 15, 6],
      ],
      ["Ø10", "Ø12"],
    ],
    [
      "a counterbore, its through hole and a third ring",
      [
        [20, 15, 3],
        [20, 15, 6],
        [20, 15, 8],
      ],
      ["Ø6", "Ø12", "Ø16"],
    ],
    [
      "two non-concentric holes close together",
      [
        [15, 15, 2],
        [19, 15, 2.5],
      ],
      ["Ø4", "Ø5"],
    ],
  ]
  it.each(cases)("keeps every text readable for %s", (_, circles, labels) => {
    const sheet = compose(circles)
    expect(overlappingTexts(sheet)).toEqual([])
    expect(
      calloutRoutes(sheet)
        .map(({ text }) => text)
        .sort(),
    ).toEqual([...labels].sort())
    expect(calloutRoutes(sheet).filter(({ routed }) => !routed)).toEqual([])
  })

  it("keeps labels apart when the view is auto-scaled and dimensioned in inches", () => {
    const sheet = compose(
      [
        [20, 15, 3],
        [20, 15, 3.3],
        [20, 15, 8],
        [8, 8, 2],
        [32, 8, 2],
      ],
      { scale: { mode: "auto" }, units: "in" },
    )
    expect(overlappingTexts(sheet)).toEqual([])
    expect(calloutRoutes(sheet, "in").filter(({ routed }) => !routed)).toEqual([])
  })

  it("counts callouts it cannot place instead of drawing them over other text", () => {
    const rings: Circle[] = Array.from({ length: 12 }, (_, index) => [20, 15, 1 + index * 0.05])
    const sheet = compose(rings)
    expect(overlappingTexts(sheet)).toEqual([])
    const placed = calloutRoutes(sheet).length
    expect(placed + sheet.omittedCallouts).toBe(12)
    expect(sheet.omittedCallouts).toBeGreaterThan(0)
  })
})
