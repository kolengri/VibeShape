import { describe, expect, it, mock } from "bun:test"
import { drawingSettingsSchema } from "@vibeshape/domain/drawing"
import { DRAWING_CHORD_TOLERANCE_MM } from "@vibeshape/protocol"

const annotations = { ...(await import("./annotations")) }
const callouts = mock(annotations.diameterCallouts)
mock.module("./annotations", () => ({ ...annotations, diameterCallouts: callouts }))
const { composeDrawingSheet } = await import("./compose")

const copy = {
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
} as const

describe("sheet composition", () => {
  it("annotates each placed view once after measuring it once at the chosen scale", () => {
    callouts.mockClear()
    const sheet = composeDrawingSheet({
      projection: {
        chordTolerance: DRAWING_CHORD_TOLERANCE_MM,
        bodyCount: 1,
        views: [
          {
            view: "top",
            bounds: { min: [0, 0], max: [40, 30] },
            edges: [
              {
                visibility: "visible",
                edgeClass: "sharp",
                curve: { kind: "circle", center: [20, 15], radius: 5 },
              },
            ],
          },
        ],
      },
      settings: {
        ...drawingSettingsSchema.parse({ views: ["top"] }),
        scale: { mode: "explicit", numerator: 1, denominator: 1 },
      },
      copy,
      documentTitle: "Once",
    })
    expect(sheet.groups.find(({ id }) => id === "labels")?.primitives).toHaveLength(1)
    // One measurement for the explicit scale, then one final pass shared by dimensions, labels
    // and the omitted count.
    expect(callouts).toHaveBeenCalledTimes(2)
  })
})
