// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  appendSketchConstraint,
  appendSketchLine,
  createEmptySketch,
  createLengthQuantity,
  featureIdSchema,
  type SketchProfileSelector,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchExternalReferenceIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
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
  dimensionMode: "Dimension mode",
  dimensionInvalid: "Invalid dimension",
  dimensions: "Dimensions",
  distance: "Distance",
  driving: "Driving",
  externalReferenceDescription: "Use geometry from an earlier sketch.",
  externalReferences: "External references",
  brokenExternalReference: "Broken external reference.",
  cancelReferenceRepair: "Cancel reference replacement",
  repairReference: "Replace reference",
  unavailableExternalReference: "Unavailable reference",
  attachSelectedPoint: "Attach",
  editConstraint: "Edit dimension",
  equal: "Equal",
  fixed: "Fix point",
  geometry: "Geometry tools",
  horizontal: "Horizontal",
  horizontalDistance: "Horizontal distance",
  line: "Line",
  midpoint: "Midpoint",
  quadrant: "Quadrant",
  noConstraints: "No constraints",
  noExternalReferences: "No external points are in use.",
  offset: "Offset",
  parallel: "Parallel",
  perpendicular: "Perpendicular",
  plane: "Support plane",
  planeFeatureFace: "Selected model face",
  supportAmbiguous: "The saved support face is ambiguous. Replace support to continue.",
  supportMissing: "The saved support face is missing. Replace support to continue.",
  supportUnavailable: "The support cannot be checked while its source feature is unavailable.",
  planeXy: "XY plane",
  planeXz: "XZ plane",
  planeYz: "YZ plane",
  pointOnCurve: "Point on curve",
  pointOnLine: "Point on line",
  pierceReference: (source: string) => `Pierce · ${source}`,
  point: "Point",
  profile: (number: number) => `Profile ${number}`,
  profiles: "Closed profiles",
  primaryAxisDiameter: "Primary axis diameter",
  radius: "Radius",
  reference: "Reference",
  rectangle: "Rectangle",
  redo: "Redo",
  remove: "Remove",
  replaceSupport: "Replace support",
  saveDimension: "Save dimension",
  selectionHint: "Select geometry to see compatible constraints.",
  secondaryAxisDiameter: "Secondary axis diameter",
  select: "Select",
  symmetric: "Symmetric",
  tangent: "Tangent",
  useExternalGeometry: "Use external geometry",
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

function supportedLineSketch() {
  return sketchRecordSchema.parse({
    ...lineSketch(),
    support: {
      kind: "feature-face" as const,
      reference: {
        schemaVersion: 0 as const,
        featureId: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4103"),
        kind: "face" as const,
        signature: {
          kind: "face" as const,
          geometryClass: "PLANE" as const,
          measure: 10,
          centroid: [0, 0, 5] as const,
          bounds: { min: [0, 0, 5] as const, max: [0, 0, 5] as const },
          boundaryCount: 4,
          adjacentGeometryClasses: [] as const,
          direction: [0, 0, 1] as const,
          directionMode: "oriented" as const,
        },
      },
    },
  })
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
  selectedConstraintId: React.ComponentProps<
    typeof SketchEditorPanel
  >["state"]["selectedConstraintId"] = null,
  profileSelection?: Readonly<{
    profile: React.ComponentProps<typeof SketchEditorPanel>["state"]["selectedProfile"]
  }>,
  externalReferenceLabels: React.ComponentProps<
    typeof SketchEditorPanel
  >["state"]["externalReferenceLabels"] = new Map(),
  repairReferenceId: React.ComponentProps<
    typeof SketchEditorPanel
  >["state"]["repairReferenceId"] = null,
  onReferenceRepairChange: React.ComponentProps<
    typeof SketchEditorPanel
  >["actions"]["onReferenceRepairChange"] = vi.fn(),
  onSupportReplace: React.ComponentProps<
    typeof SketchEditorPanel
  >["actions"]["onSupportReplace"] = vi.fn(),
  supportLabel: React.ComponentProps<typeof SketchEditorPanel>["state"]["supportLabel"] = null,
  missingExternalReferenceIds: React.ComponentProps<
    typeof SketchEditorPanel
  >["state"]["missingExternalReferenceIds"] = new Set(),
  referenceDimensionLabels: React.ComponentProps<
    typeof SketchEditorPanel
  >["state"]["referenceDimensionLabels"] = {},
  supportProblem: React.ComponentProps<typeof SketchEditorPanel>["state"]["supportProblem"] = null,
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
              externalPointCandidates: [],
              externalReferenceLabels,
              missingExternalReferenceIds,
              failedConstraintIds,
              message: null,
              profiles: profileSelection?.profile ? [profileSelection.profile] : [],
              referenceDimensionLabels,
              repairReferenceId,
              selectedConstraintId,
              selectedEntityIds,
              selectedProfile: profileSelection?.profile ?? null,
              supportLabel,
              supportProblem,
              variables,
            }}
            actions={{
              onDraftChange,
              onReferenceRepairChange,
              onSupportReplace,
              onSelectedConstraintChange: vi.fn(),
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
  it("displays the resolved support face label", () => {
    const sketch = supportedLineSketch()

    renderPanel(
      sketch,
      [],
      vi.fn(),
      [],
      undefined,
      [],
      null,
      undefined,
      new Map(),
      null,
      vi.fn(),
      vi.fn(),
      "Mount · Face 1",
    )

    expect(screen.getByRole("option", { name: "Mount · Face 1" })).toBeTruthy()
  })

  it("makes a missing support explicit next to its graphical repair action", () => {
    renderPanel(
      supportedLineSketch(),
      [],
      vi.fn(),
      [],
      undefined,
      [],
      null,
      undefined,
      new Map(),
      null,
      vi.fn(),
      vi.fn(),
      null,
      new Set(),
      {},
      "missing",
    )

    expect(
      screen.getAllByText("The saved support face is missing. Replace support to continue."),
    ).toHaveLength(2)
    expect(screen.getByRole("button", { name: "Replace support" })).toBeTruthy()
  })

  it("starts graphical support replacement without mutating the draft", async () => {
    const user = userEvent.setup()
    const sketch = lineSketch()
    const onDraftChange = vi.fn()
    const onSupportReplace = vi.fn()

    renderPanel(
      sketch,
      [],
      onDraftChange,
      [],
      undefined,
      [],
      null,
      undefined,
      new Map(),
      null,
      vi.fn(),
      onSupportReplace,
    )

    await user.click(screen.getByRole("button", { name: "Replace support" }))
    expect(onSupportReplace).toHaveBeenCalledOnce()
    expect(onDraftChange).not.toHaveBeenCalled()
  })

  it("keeps a resolved model reference human-readable after selection", () => {
    const referenceId = sketchExternalReferenceIdSchema.parse(
      "0195b5ac-b220-7a2c-8c33-67a36a7f4102",
    )
    const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4103")
    const sketch = sketchRecordSchema.parse({
      ...lineSketch(),
      externalReferences: [
        {
          schemaVersion: 0 as const,
          id: referenceId,
          kind: "model-line" as const,
          reference: {
            schemaVersion: 0 as const,
            featureId,
            kind: "edge" as const,
            semanticRole: "primitive.box.edge.y.x-min.z-max",
            signature: {
              kind: "edge" as const,
              geometryClass: "LINE",
              measure: 20,
              centroid: [10, 0, 0] as const,
              bounds: { min: [0, 0, 0] as const, max: [20, 0, 0] as const },
              boundaryCount: 2,
              adjacentGeometryClasses: [],
            },
          },
          projectedLineId: createEntityId(),
          projectedStartPointId: createEntityId(),
          projectedEndPointId: createEntityId(),
        },
      ],
    })

    renderPanel(
      sketch,
      [],
      vi.fn(),
      [],
      undefined,
      [],
      null,
      undefined,
      new Map([[referenceId, "Box 1 · Edge 1"]]),
    )

    expect(screen.getByText("Box 1 · Edge 1")).toBeTruthy()
    expect(screen.queryByText(/primitive\.box/)).toBeNull()
  })

  it("starts graphical replacement from a model reference row", async () => {
    const user = userEvent.setup()
    const referenceId = sketchExternalReferenceIdSchema.parse(
      "0195b5ac-b220-7a2c-8c33-67a36a7f4112",
    )
    const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4113")
    const sketch = sketchRecordSchema.parse({
      ...lineSketch(),
      externalReferences: [
        {
          schemaVersion: 0,
          id: referenceId,
          kind: "model-point",
          reference: {
            schemaVersion: 0,
            featureId,
            kind: "vertex",
            semanticRole: "primitive.box.vertex.x-min.y-min.z-min",
            signature: {
              kind: "vertex",
              geometryClass: "POINT",
              measure: 0,
              centroid: [0, 0, 0],
              bounds: { min: [0, 0, 0], max: [0, 0, 0] },
              boundaryCount: 0,
              adjacentGeometryClasses: [],
            },
          },
          projectedPointId: createEntityId(),
        },
      ],
    })
    const onReferenceRepairChange = vi.fn()

    renderPanel(
      sketch,
      [],
      vi.fn(),
      [],
      undefined,
      [],
      null,
      undefined,
      new Map([[referenceId, "Box 1 · Vertex 1"]]),
      null,
      onReferenceRepairChange,
    )

    await user.click(screen.getByRole("button", { name: "Replace reference" }))
    expect(onReferenceRepairChange).toHaveBeenCalledWith(referenceId)

    cleanup()
    const onDraftChange = vi.fn()
    const onActiveRepairChange = vi.fn()
    renderPanel(
      sketch,
      [],
      onDraftChange,
      [],
      undefined,
      [],
      null,
      undefined,
      new Map([[referenceId, "Box 1 · Vertex 1"]]),
      referenceId,
      onActiveRepairChange,
    )
    await user.click(screen.getByRole("button", { name: "Cancel reference replacement" }))
    expect(onActiveRepairChange).toHaveBeenCalledWith(null)
    expect(onDraftChange).not.toHaveBeenCalled()

    cleanup()
    const onRemoveDraftChange = vi.fn()
    const onRemoveRepairChange = vi.fn()
    renderPanel(
      sketch,
      [],
      onRemoveDraftChange,
      [],
      undefined,
      [],
      null,
      undefined,
      new Map([[referenceId, "Box 1 · Vertex 1"]]),
      referenceId,
      onRemoveRepairChange,
    )
    await user.click(screen.getByRole("button", { name: "Remove" }))
    expect(onRemoveRepairChange).toHaveBeenCalledWith(null)
    expect(onRemoveDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ externalReferences: [] }),
    )
  })

  it("marks a broken sketch reference and starts graphical replacement", async () => {
    const user = userEvent.setup()
    const referenceId = sketchExternalReferenceIdSchema.parse(
      "0195b5ac-b220-7a2c-8c33-67a36a7f4191",
    )
    const sketch = sketchRecordSchema.parse({
      ...lineSketch(),
      externalReferences: [
        {
          schemaVersion: 0,
          id: referenceId,
          kind: "line",
          sourceSketchId: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4192"),
          sourceLineId: createEntityId(),
          projectedLineId: createEntityId(),
          projectedStartPointId: createEntityId(),
          projectedEndPointId: createEntityId(),
        },
      ],
    })
    const onReferenceRepairChange = vi.fn()

    renderPanel(
      sketch,
      [],
      vi.fn(),
      [],
      undefined,
      [],
      null,
      undefined,
      new Map([[referenceId, "Sketch 1 · Missing line"]]),
      null,
      onReferenceRepairChange,
      vi.fn(),
      null,
      new Set([referenceId]),
    )

    const label = screen.getByText("Sketch 1 · Missing line")
    expect(label.closest("li")?.dataset.externalReferenceStatus).toBe("missing")
    expect(screen.getByLabelText("Broken external reference.")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Replace reference" }))
    expect(onReferenceRepairChange).toHaveBeenCalledWith(referenceId)
  })

  it("keeps lifecycle and feature commands out of the sketch properties panel", () => {
    const sketch = lineSketch()
    const boundary = sketch.entities.find((entity) => entity.type === "line")
    if (!boundary) throw new Error("The fixture must contain a profile boundary.")
    const profile = {
      holeBoundaryEntityIds: [],
      outerBoundaryEntityIds: [boundary.id],
      schemaVersion: 0,
      sketchId: sketch.id,
    } satisfies SketchProfileSelector

    renderPanel(sketch, [], vi.fn(), [], undefined, [], null, { profile })

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Finish sketch" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Extrude selected profile" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Revolve selected profile" })).toBeNull()
  })

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

  it("offers midpoint and symmetric design-intent constraints for compatible selections", async () => {
    const user = userEvent.setup()
    const sketch = lineSketch()
    const line = sketch.entities.find((entity) => entity.type === "line")
    const points = sketch.entities.filter((entity) => entity.type === "point")
    expect(line && points[0] && points[1]).toBeTruthy()
    if (!line || !points[0] || !points[1]) return

    const midpointChange = renderPanel(sketch, [points[0].id, line.id])
    await user.click(screen.getByRole("button", { name: "Midpoint" }))
    expect(midpointChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: [
          expect.objectContaining({ type: "midpoint", pointId: points[0].id, lineId: line.id }),
        ],
      }),
    )
    cleanup()

    const symmetricChange = renderPanel(sketch, [points[0].id, points[1].id, line.id])
    await user.click(screen.getByRole("button", { name: "Symmetric" }))
    expect(symmetricChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: [
          expect.objectContaining({
            type: "symmetric",
            firstPointId: points[0].id,
            secondPointId: points[1].id,
            lineId: line.id,
          }),
        ],
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

  it("creates a value-less reference dimension from the task-panel fallback", async () => {
    const user = userEvent.setup()
    const sketch = lineSketch()
    const line = sketch.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The line fixture must contain one line.")
    const onDraftChange = renderPanel(sketch, [line.id])

    await user.click(screen.getByRole("button", { name: "Reference" }))
    expect(screen.queryByRole("combobox", { name: "Driving expression" })).toBeNull()
    await user.click(screen.getByRole("button", { name: "Add constraint" }))

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: [
          expect.objectContaining({
            type: "distance",
            firstPointId: line.startPointId,
            secondPointId: line.endPointId,
            mode: "reference",
          }),
        ],
      }),
    )
    const changed = onDraftChange.mock.calls[0]?.[0]
    expect(changed?.constraints[0]).not.toHaveProperty("value")
  })

  it("exposes the live reference measurement in the accessible constraint row", () => {
    const sketch = lineSketch()
    const line = sketch.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The line fixture must contain one line.")
    const constraintId = sketchConstraintIdSchema.parse("0195b5ac-b222-7a2c-8c33-000000000004")
    const constrained = appendSketchConstraint(
      sketch,
      {
        type: "distance",
        firstPointId: line.startPointId,
        secondPointId: line.endPointId,
        mode: "reference",
      },
      () => constraintId,
    )

    renderPanel(
      constrained,
      [],
      vi.fn(),
      [],
      undefined,
      [],
      null,
      undefined,
      new Map(),
      null,
      vi.fn(),
      vi.fn(),
      null,
      new Set(),
      { [constraintId]: "(21.541 mm)" },
    )

    expect(screen.getByRole("button", { name: "Distance · Reference · (21.541 mm)" })).toBeTruthy()
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
    const onDraftChange = renderPanel(constrained, [], vi.fn(), [], undefined, [], constraintId)

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

  it("edits a signed offset through the shared variable-aware dimension form", async () => {
    const user = userEvent.setup()
    const sourceSketch = lineSketch()
    const withOffsetLine = appendSketchLine(sourceSketch, {
      createEntityId,
      start: { kind: "new", point: { x: 0, y: 5 } },
      end: { kind: "new", point: { x: 20, y: 5 } },
    }).sketch
    const [sourceLine, offsetLine] = withOffsetLine.entities.filter(
      (entity) => entity.type === "line",
    )
    if (!sourceLine || !offsetLine) throw new Error("The offset form fixture requires two lines.")
    const constraintId = sketchConstraintIdSchema.parse("0195b5ac-b222-7a2c-8c33-000000000003")
    const constrained = appendSketchConstraint(
      withOffsetLine,
      {
        type: "offset",
        endpointPairs: [
          {
            sourcePointId: sourceLine.startPointId,
            offsetPointId: offsetLine.startPointId,
          },
          { sourcePointId: sourceLine.endPointId, offsetPointId: offsetLine.endPointId },
        ],
        linePairs: [{ sourceLineId: sourceLine.id, offsetLineId: offsetLine.id, distanceScale: 1 }],
        value: createLengthQuantity(5, "mm", "5 mm"),
      },
      () => constraintId,
    )
    const gapVariable = {
      schemaVersion: 0 as const,
      id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2602"),
      name: "gap",
      expression: "8 mm",
    }
    const onDraftChange = renderPanel(
      constrained,
      [],
      vi.fn(),
      [],
      undefined,
      [gapVariable],
      constraintId,
    )

    const expression = screen.getByRole("combobox", { name: "Driving expression" })
    await user.clear(expression)
    await user.type(expression, "-#ga")
    await user.keyboard("{Enter}")
    expect((expression as HTMLInputElement).value).toBe("-#gap")
    await user.click(screen.getByRole("button", { name: "Save dimension" }))

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: [
          expect.objectContaining({
            id: constraintId,
            type: "offset",
            value: expect.objectContaining({
              value: -8,
              source: expect.objectContaining({ expression: "-#gap" }),
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
