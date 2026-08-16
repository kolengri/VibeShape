// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  appendSketchConstraint,
  appendSketchLine,
  createEmptySketch,
  createLengthQuantity,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { SketchEditorPanel } from "./sketch-editor-panel"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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
  editConstraint: "Edit dimension",
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
  saveDimension: "Save dimension",
  selectionHint: "Select geometry to see compatible constraints.",
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
  displayUnits: React.ComponentProps<typeof DocumentDisplayUnitsProvider>["displayUnits"] = {
    length: "mm",
    angle: "deg",
  },
  variables: React.ComponentProps<typeof SketchEditorPanel>["state"]["variables"] = [],
) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider delayDuration={0}>
        <DocumentDisplayUnitsProvider displayUnits={displayUnits}>
          <SketchEditorPanel
            copy={copy}
            state={{
              disabled: false,
              draft: sketch,
              failedConstraintIds,
              message: null,
              profiles: [],
              selectedEntityIds,
              selectedProfile: null,
              variables,
            }}
            actions={{
              onCancel: vi.fn(),
              onDraftChange,
              onFinish: vi.fn(async () => undefined),
              onSelectedProfileChange: vi.fn(),
            }}
          />
        </DocumentDisplayUnitsProvider>
      </TooltipProvider>
    </I18nProvider>,
  )
  return onDraftChange
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock)
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

    await user.clear(screen.getByRole("combobox", { name: "Driving expression" }))
    await user.type(screen.getByRole("combobox", { name: "Driving expression" }), "20 mm")
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

  it("creates a length dimension directly from a selected line", async () => {
    const user = userEvent.setup()
    const sketch = lineSketch()
    const line = sketch.entities.find((entity) => entity.type === "line")
    expect(line).toBeDefined()
    if (!line) return
    const onDraftChange = renderPanel(sketch, [line.id])

    await user.clear(screen.getByRole("combobox", { name: "Driving expression" }))
    await user.type(screen.getByRole("combobox", { name: "Driving expression" }), "25 mm")
    await user.click(screen.getByRole("button", { name: "Add constraint" }))

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: [
          expect.objectContaining({
            type: "distance",
            firstPointId: line.startPointId,
            secondPointId: line.endPointId,
            value: expect.objectContaining({ value: 25 }),
          }),
        ],
      }),
    )
  })

  it("edits an existing line dimension without replacing its identity", async () => {
    const user = userEvent.setup()
    const sketch = lineSketch()
    const line = sketch.entities.find((entity) => entity.type === "line")
    expect(line).toBeDefined()
    if (!line) return
    const constraintId = sketchConstraintIdSchema.parse("0195b5ac-b222-7a2c-8c33-000000000002")
    const constrained = appendSketchConstraint(
      sketch,
      {
        type: "distance",
        firstPointId: line.startPointId,
        secondPointId: line.endPointId,
        value: createLengthQuantity(20, "mm", "20 mm"),
      },
      () => constraintId,
    )
    const onDraftChange = renderPanel(constrained, [])

    await user.click(screen.getByRole("button", { name: "Edit dimension" }))
    const expression = screen.getByRole("combobox", { name: "Driving expression" })
    expect((expression as HTMLInputElement).value).toBe("20 mm")
    await user.clear(expression)
    await user.type(expression, "32 mm")
    await user.click(screen.getByRole("button", { name: "Save dimension" }))

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: [
          expect.objectContaining({
            id: constraintId,
            firstPointId: line.startPointId,
            secondPointId: line.endPointId,
            value: expect.objectContaining({
              value: 32,
              source: expect.objectContaining({ expression: "32 mm" }),
            }),
          }),
        ],
      }),
    )
  })

  it("completes a variable reference inside a driving dimension", async () => {
    const user = userEvent.setup()
    const sketch = lineSketch()
    const points = sketch.entities.filter((entity) => entity.type === "point")
    renderPanel(
      sketch,
      points.map(({ id }) => id),
      vi.fn(),
      [],
      undefined,
      [
        {
          schemaVersion: 0,
          id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2601"),
          name: "width",
          expression: "20 mm",
        },
      ],
    )

    const expression = screen.getByRole("combobox", { name: "Driving expression" })
    await user.clear(expression)
    await user.type(expression, "#wi")
    await user.keyboard("{Enter}")

    expect((expression as HTMLInputElement).value).toBe("#width")
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

  it("uses project units for new sketch dimensions and persists unitless input explicitly", async () => {
    const user = userEvent.setup()
    const sketch = lineSketch()
    const points = sketch.entities.filter((entity) => entity.type === "point")
    const onDraftChange = renderPanel(
      sketch,
      points.map(({ id }) => id),
      vi.fn(),
      [],
      { length: "in", angle: "rad" },
    )
    const expression = screen.getByRole("combobox", { name: "Driving expression" })
    expect((expression as HTMLInputElement).value).toBe("0.393700787402 in")
    await user.clear(expression)
    await user.type(expression, "2")
    await user.click(screen.getByRole("button", { name: "Add constraint" }))

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: [
          expect.objectContaining({
            value: expect.objectContaining({
              value: 50.8,
              source: expect.objectContaining({ expression: "2 in" }),
            }),
          }),
        ],
      }),
    )
  })
})
