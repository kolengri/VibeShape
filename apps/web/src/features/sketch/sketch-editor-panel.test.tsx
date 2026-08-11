// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  appendSketchConstraint,
  appendSketchLine,
  createEmptySketch,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SketchEditorPanel } from "./sketch-editor-panel"

const copy = {
  addConstraint: "Add constraint",
  angle: "Angle",
  arc: "Arc",
  cancel: "Cancel",
  circle: "Circle",
  coincident: "Coincident",
  concentric: "Concentric",
  conflict: "Conflict",
  construction: "Construction geometry",
  constraints: "Applied constraints",
  diameter: "Diameter",
  dimension: "Dimension type",
  dimensionExpression: "Driving expression",
  dimensionInvalid: "Invalid dimension",
  dimensions: "Dimensions",
  distance: "Distance",
  equal: "Equal",
  finish: "Finish sketch",
  fixed: "Fix point",
  geometry: "Geometry tools",
  horizontal: "Horizontal",
  horizontalDistance: "Horizontal distance",
  line: "Line",
  noConstraints: "No constraints",
  parallel: "Parallel",
  perpendicular: "Perpendicular",
  plane: "Support plane",
  planeXy: "XY plane",
  planeXz: "XZ plane",
  planeYz: "YZ plane",
  pointOnCurve: "Point on curve",
  pointOnLine: "Point on line",
  point: "Point",
  profile: (number: number) => `Profile ${number}`,
  profiles: "Closed profiles",
  radius: "Radius",
  rectangle: "Rectangle",
  redo: "Redo",
  remove: "Remove",
  select: "Select",
  tangent: "Tangent",
  undo: "Undo",
  vertical: "Vertical",
  verticalDistance: "Vertical distance",
} as const

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4101")
let entityIndex = 0

function createEntityId() {
  entityIndex += 1
  return sketchEntityIdSchema.parse(
    `0195b5ac-b221-7a2c-8c33-${entityIndex.toString(16).padStart(12, "0")}`,
  )
}

function lineSketch() {
  entityIndex = 0
  return appendSketchLine(createEmptySketch({ id: sketchId, label: "Profile", plane: "xy" }), {
    createEntityId,
    start: { kind: "new", point: { x: 0, y: 0 } },
    end: { kind: "new", point: { x: 20, y: 8 } },
  }).sketch
}

function renderPanel(
  sketch: ReturnType<typeof lineSketch>,
  selectedEntityIds: React.ComponentProps<typeof SketchEditorPanel>["state"]["selectedEntityIds"],
  onDraftChange = vi.fn(),
  failedConstraintIds: React.ComponentProps<
    typeof SketchEditorPanel
  >["state"]["failedConstraintIds"] = [],
) {
  render(
    <SketchEditorPanel
      copy={copy}
      state={{
        construction: false,
        disabled: false,
        draft: sketch,
        editorTool: "select",
        failedConstraintIds,
        message: null,
        profiles: [],
        redoAvailable: false,
        selectedEntityIds,
        selectedProfile: null,
        undoAvailable: false,
        variables: [],
      }}
      actions={{
        onCancel: vi.fn(),
        onConstructionChange: vi.fn(),
        onDraftChange,
        onEditorToolChange: vi.fn(),
        onFinish: vi.fn(async () => undefined),
        onRedo: vi.fn(),
        onSelectedProfileChange: vi.fn(),
        onUndo: vi.fn(),
      }}
    />,
  )
  return onDraftChange
}

afterEach(cleanup)

describe("SketchEditorPanel", () => {
  it("adds an applicable geometric constraint from the current selection", async () => {
    const user = userEvent.setup()
    const sketch = lineSketch()
    const line = sketch.entities.find((entity) => entity.type === "line")
    expect(line).toBeDefined()
    if (!line) return
    const onDraftChange = renderPanel(sketch, [line.id])

    await user.click(screen.getByRole("button", { name: "Horizontal" }))

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: [expect.objectContaining({ type: "horizontal", lineId: line.id })],
      }),
    )
  })

  it("uses the TanStack Form adapter to add a variable-ready driving dimension", async () => {
    const user = userEvent.setup()
    const sketch = lineSketch()
    const points = sketch.entities.filter((entity) => entity.type === "point")
    const onDraftChange = renderPanel(
      sketch,
      points.map(({ id }) => id),
    )

    await user.clear(screen.getByRole("textbox", { name: "Driving expression" }))
    await user.type(screen.getByRole("textbox", { name: "Driving expression" }), "20 mm")
    await user.click(screen.getByRole("button", { name: "Add constraint" }))

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: [
          expect.objectContaining({
            type: "distance",
            value: expect.objectContaining({
              source: expect.objectContaining({ expression: "20 mm" }),
            }),
          }),
        ],
      }),
    )
  })

  it("marks solver-reported conflicting constraints without removing them", () => {
    const sketch = lineSketch()
    const line = sketch.entities.find((entity) => entity.type === "line")
    expect(line).toBeDefined()
    if (!line) return
    const constraintId = sketchConstraintIdSchema.parse("0195b5ac-b222-7a2c-8c33-000000000001")
    const constrained = appendSketchConstraint(
      sketch,
      { type: "horizontal", lineId: line.id },
      () => constraintId,
    )

    renderPanel(constrained, [], vi.fn(), [constraintId])

    const label = screen.getByText("Horizontal · Conflict")
    expect(label.closest("li")?.getAttribute("aria-invalid")).toBe("true")
    expect(constrained.constraints).toHaveLength(1)
  })
})
