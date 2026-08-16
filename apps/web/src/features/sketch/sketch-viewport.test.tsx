// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  createLengthQuantity,
  createRectangleSketch,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  ActiveSketchSolveResult,
  DocumentControllerState,
} from "../../document/document-controller"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { SketchViewport } from "./sketch-viewport"

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3201")

function sequentialIdFactory<Value>(parse: (value: string) => Value, group: string) {
  let index = 0
  return () => {
    index += 1
    return parse(`0195b5ac-${group}-7a2c-8c33-${index.toString(16).padStart(12, "0")}`)
  }
}

const sketch = createRectangleSketch({
  id: sketchId,
  label: "Sketch 1",
  plane: "xy",
  width: createLengthQuantity(30),
  height: createLengthQuantity(12),
  createEntityId: sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b241"),
  createConstraintId: sequentialIdFactory((value) => sketchConstraintIdSchema.parse(value), "b242"),
})
const pointEntities = sketch.entities.filter((entity) => entity.type === "point")
const controller = {
  status: "ready",
  report: {
    snapshot: { revision: 7, sketches: [sketch] },
    rebuild: { ok: true },
  },
} as unknown as DocumentControllerState

function solveResult(): ActiveSketchSolveResult {
  return {
    ok: true,
    response: {
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f32ff",
      documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f32fe",
      revision: 7,
      generation: 1,
      type: "sketchSolved",
      solution: {
        schemaVersion: 0,
        sketchId,
        sourceRevision: 7,
        status: "fully-constrained",
        degreesOfFreedom: 0,
        maximumResidual: 0,
        points: pointEntities.map(({ id, x, y }) => ({ entityId: id, x, y })),
        circles: [],
        failedConstraintIds: [],
        profileResult: {
          schemaVersion: 0,
          loops: [
            {
              loopIndex: 0,
              parentLoopIndex: null,
              depth: 0,
              signedArea: 360,
              perimeter: 84,
              bounds: { minX: 0, minY: 0, maxX: 30, maxY: 12 },
              sourceEntityIds: sketch.entities
                .filter((entity) => entity.type === "line")
                .map(({ id }) => id),
              segments: sketch.entities
                .filter((entity) => entity.type === "line")
                .map(({ id }) => ({ entityId: id, type: "line" as const, reversed: false })),
            },
          ],
          profiles: [
            {
              profileIndex: 0,
              outerLoopIndex: 0,
              holeLoopIndices: [],
              area: 360,
              perimeter: 84,
              bounds: { minX: 0, minY: 0, maxX: 30, maxY: 12 },
            },
          ],
          diagnostics: [],
        },
        heapCapacityBytes: 1_048_576,
        solverBuild: {
          schemaVersion: 0,
          solver: "SolveSpace",
          solverVersion: "3.2",
          sourceRevision: "27b6a080c8b669421bd4d444650c3b8eddec5687",
          abiVersion: 1,
          moduleSha256: "0".repeat(64),
          wasmSha256: "0".repeat(64),
        },
      },
    },
  }
}

const noOperation = () => undefined

function renderViewport(
  props: Readonly<{
    draft?: React.ComponentProps<typeof SketchViewport>["state"]["draft"]
    editorTool?: React.ComponentProps<typeof SketchViewport>["state"]["editorTool"]
    onDraftChange?: React.ComponentProps<typeof SketchViewport>["actions"]["onDraftChange"]
    onProfileSelect?: React.ComponentProps<typeof SketchViewport>["actions"]["onProfileSelect"]
    onProfilesChange?: React.ComponentProps<typeof SketchViewport>["actions"]["onProfilesChange"]
    sketch: React.ComponentProps<typeof SketchViewport>["state"]["sketch"]
    solveSketch: NonNullable<React.ComponentProps<typeof SketchViewport>["solveSketch"]>
    displayUnits?: React.ComponentProps<typeof DocumentDisplayUnitsProvider>["displayUnits"]
  }>,
) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <DocumentDisplayUnitsProvider
        displayUnits={props.displayUnits ?? { length: "mm", angle: "deg" }}
      >
        <SketchViewport
          solveSketch={props.solveSketch}
          state={{
            construction: false,
            controller,
            draft: props.draft ?? null,
            editorTool: props.editorTool ?? "select",
            selectedEntityIds: [],
            selectedProfile: null,
            sketch: props.sketch,
          }}
          actions={{
            onDraftChange: props.onDraftChange ?? noOperation,
            onFailedConstraintsChange: noOperation,
            onProfileSelect: props.onProfileSelect ?? noOperation,
            onProfilesChange: props.onProfilesChange ?? noOperation,
            onRedo: noOperation,
            onSelectionChange: noOperation,
            onUndo: noOperation,
          }}
        />
      </DocumentDisplayUnitsProvider>
    </I18nProvider>,
  )
}

afterEach(cleanup)

describe("SketchViewport", () => {
  it("renders production solver state and exact profile measurements", async () => {
    const solveSketch = vi.fn(async () => solveResult())
    const onProfilesChange = vi.fn()
    const onProfileSelect = vi.fn()
    renderViewport({ sketch, solveSketch, onProfilesChange, onProfileSelect })

    expect(await screen.findByRole("img", { name: "Solved sketch geometry" })).toBeTruthy()
    expect(await screen.findByText("Fully constrained")).toBeTruthy()
    expect(screen.getByText("Degrees of freedom: 0")).toBeTruthy()
    expect(screen.getByText("Profile: 360 mm² · 84 mm perimeter")).toBeTruthy()
    expect(solveSketch).toHaveBeenCalledWith(7, sketch)
    await waitFor(() => expect(onProfilesChange).toHaveBeenLastCalledWith([expect.any(Object)]))
    fireEvent.pointerDown(document.querySelector('[data-sketch-profile-index="0"]') as Element)
    expect(onProfileSelect).toHaveBeenCalledWith(expect.objectContaining({ sketchId }))
  })

  it("solves and renders an editable transient draft", async () => {
    const solveSketch = vi.fn(async () => solveResult())
    renderViewport({
      draft: sketch,
      editorTool: "line",
      sketch,
      solveSketch,
    })

    expect(screen.getByRole("img", { name: "Editable sketch geometry" })).toBeTruthy()
    await waitFor(() => expect(solveSketch).toHaveBeenCalledWith(7, sketch))
  })

  it("formats solved profile measurements in the selected project unit", async () => {
    renderViewport({
      displayUnits: { length: "cm", angle: "deg" },
      sketch,
      solveSketch: vi.fn(async () => solveResult()),
    })

    expect(await screen.findByText("Profile: 3.6 cm² · 8.4 cm perimeter")).toBeTruthy()
    expect(screen.getByText("XY · cm")).toBeTruthy()
  })

  it("creates line geometry from canvas pointer input without committing the document", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "line",
      sketch: emptySketch,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
      onDraftChange,
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    expect(screen.getByText("Empty sketch")).toBeTruthy()
    expect(screen.getByText("Choose a geometry tool from the toolbar to begin.")).toBeTruthy()
    vi.spyOn(drawing, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(drawing, { clientX: 200, clientY: 300 })
    fireEvent.pointerDown(drawing, { clientX: 600, clientY: 300 })

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: expect.arrayContaining([expect.objectContaining({ type: "line" })]),
        constraints: [expect.objectContaining({ type: "horizontal" })],
      }),
    )
  })

  it("previews and creates a symmetric center rectangle as one draft edit", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "center-rectangle",
      sketch: emptySketch,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
      onDraftChange,
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    vi.spyOn(drawing, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(drawing, { clientX: 400, clientY: 300 })
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180 })
    expect(document.querySelector('[data-sketch-preview-tool="center-rectangle"]')).toBeTruthy()
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(drawing, { clientX: 600, clientY: 180 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: expect.arrayContaining([
          expect.objectContaining({ type: "point", construction: true }),
          expect.objectContaining({ type: "line", construction: true }),
        ]),
        constraints: expect.arrayContaining([
          expect.objectContaining({ type: "horizontal" }),
          expect.objectContaining({ type: "parallel" }),
          expect.objectContaining({ type: "equal" }),
        ]),
      }),
    )
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "point")).toHaveLength(5)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(8)
    expect(draft.constraints).toHaveLength(6)
  })

  it("previews horizontal inference before applying the automatic constraint", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    renderViewport({
      draft: emptySketch,
      editorTool: "line",
      sketch: emptySketch,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    vi.spyOn(drawing, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(drawing, { clientX: 200, clientY: 300 })
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 302 })

    expect(document.querySelector('[data-sketch-inference="horizontal"]')).toBeTruthy()
  })

  it("renders geometric constraint glyphs and driving dimension labels", () => {
    renderViewport({
      draft: sketch,
      sketch,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })

    expect(document.querySelector('[data-sketch-constraint-kind="geometric"]')).toBeTruthy()
    expect(document.querySelector('[data-sketch-constraint-kind="dimension"]')).toBeTruthy()
  })
})
