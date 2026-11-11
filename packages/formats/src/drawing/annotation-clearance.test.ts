import { describe, expect, it } from "bun:test"
import { type DrawingSettings, drawingSettingsSchema } from "@vibeshape/domain/drawing"
import {
  DRAWING_CHORD_TOLERANCE_MM,
  type DrawingProjection,
  type DrawingViewProjection,
} from "@vibeshape/protocol"
import { composeDrawingSheet, type DrawingSheet, type DrawingSheetCopy } from "./index"
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

function rectangleView(
  view: DrawingViewProjection["view"],
  width: number,
  height: number,
  hole = false,
): DrawingViewProjection {
  const corners: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ]
  const edges: DrawingViewProjection["edges"] = corners.map((start, index) => ({
    visibility: "visible",
    edgeClass: "sharp",
    curve: { kind: "line", start, end: corners[(index + 1) % 4] ?? start },
  }))
  const radius = Math.min(width, height) / 4
  if (hole)
    edges.push({
      visibility: "visible",
      edgeClass: "sharp",
      curve: { kind: "circle", center: [width - radius * 1.2, height - radius * 1.2], radius },
    })
  return { view, bounds: { min: [0, 0], max: [width, height] }, edges }
}

/** Projection of an x × y × z box with a vertical hole, in the drawing view frames. */
function boxProjection(x: number, y: number, z: number): DrawingProjection {
  return {
    chordTolerance: DRAWING_CHORD_TOLERANCE_MM,
    bodyCount: 1,
    views: [
      rectangleView("front", x, z),
      rectangleView("back", x, z),
      rectangleView("top", x, y, true),
      rectangleView("bottom", x, y, true),
      rectangleView("right", y, z),
      rectangleView("left", y, z),
      rectangleView("isometric", (x + y) * Math.SQRT1_2, z + (x + y) * 0.41),
    ],
  }
}

function compose(projection: DrawingProjection, overrides: Partial<DrawingSettings>) {
  return composeDrawingSheet({
    projection,
    settings: { ...drawingSettingsSchema.parse({}), ...overrides },
    copy,
    documentTitle: "Clearance",
  })
}

const BORDER = 10
const TITLE_BLOCK_HEIGHT = 32
const TITLE_BLOCK_CLEARANCE = 4

/** Every dimension and label primitive must stay in the area above the title block band. */
function annotationViolations(sheet: DrawingSheet) {
  const area: SheetBox = [
    BORDER,
    BORDER + TITLE_BLOCK_HEIGHT + TITLE_BLOCK_CLEARANCE,
    sheet.width - BORDER,
    sheet.height - BORDER,
  ]
  const titleBlock: SheetBox = [
    sheet.width - BORDER - 180,
    BORDER,
    sheet.width - BORDER,
    BORDER + TITLE_BLOCK_HEIGHT,
  ]
  const inside = (box: SheetBox) =>
    box[0] >= area[0] - 1e-9 &&
    box[1] >= area[1] - 1e-9 &&
    box[2] <= area[2] + 1e-9 &&
    box[3] <= area[3] + 1e-9
  const intersects = (left: SheetBox, right: SheetBox) =>
    left[0] < right[2] && right[0] < left[2] && left[1] < right[3] && right[1] < left[3]
  return sheet.groups
    .filter(({ id }) => id === "dimensions" || id === "labels")
    .flatMap(({ id, primitives }) =>
      primitives.flatMap((primitive) => {
        const box = primitiveBox(primitive)
        return inside(box) && !intersects(box, titleBlock)
          ? []
          : [
              {
                group: id,
                primitive: primitive.kind === "text" ? primitive.text : primitive.kind,
                box,
              },
            ]
      }),
    )
}

describe("annotation clearance", () => {
  it("keeps the Front label of a 40 × 40 × 213 mm box out of the A3 title block", () => {
    const sheet = compose(boxProjection(40, 40, 213), { views: ["front", "right"] })
    const label = sheet.groups
      .find(({ id }) => id === "labels")
      ?.primitives.find((primitive) => primitive.kind === "text" && primitive.text === "Front view")
    if (label?.kind !== "text") throw new Error("Missing the Front label.")
    expect(primitiveBox(label)[1]).toBeGreaterThanOrEqual(BORDER + TITLE_BLOCK_HEIGHT)
    expect(sheet.fits).toBe(true)
    expect(annotationViolations(sheet)).toEqual([])
  })

  it("reports an explicit scale whose annotations would reach the title block as not fitting", () => {
    const sheet = compose(boxProjection(40, 40, 213), {
      views: ["front", "right"],
      scale: { mode: "explicit", numerator: 1, denominator: 1 },
    })
    expect(sheet.fits).toBe(annotationViolations(sheet).length === 0)
    const taller = compose(boxProjection(40, 40, 230), {
      views: ["front", "right"],
      scale: { mode: "explicit", numerator: 1, denominator: 1 },
    })
    expect(taller.fits).toBe(false)
  })

  const sizes = [
    [40, 40, 213],
    [300, 20, 20],
    [10, 10, 10],
    [120, 80, 60],
    [20, 200, 5],
    [395, 30, 30],
  ] as const
  const sheets = [
    { sheetSize: "iso-a4", orientation: "landscape" },
    { sheetSize: "iso-a4", orientation: "portrait" },
    { sheetSize: "iso-a3", orientation: "landscape" },
    { sheetSize: "us-letter", orientation: "portrait" },
  ] as const
  const viewSets = [
    ["front", "top", "right", "isometric"],
    ["front", "right"],
    ["front", "back", "top", "bottom", "right", "left", "isometric"],
  ] as const
  it.each(sizes)(
    "keeps every auto-scaled %p × %p × %p mm annotation inside the area",
    (x, y, z) => {
      for (const sheet of sheets)
        for (const projection of ["first-angle", "third-angle"] as const)
          for (const views of viewSets)
            for (const units of ["mm", "in"] as const) {
              const composed = compose(boxProjection(x, y, z), {
                ...sheet,
                projection,
                views: [...views],
                units,
              })
              if (!composed.fits) continue
              expect({
                sheet,
                projection,
                views,
                units,
                violations: annotationViolations(composed),
              }).toEqual({ sheet, projection, views, units, violations: [] })
            }
    },
  )
})
