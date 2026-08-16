// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  appendSketchArc,
  appendSketchLine,
  createLengthQuantity,
  createRectangleSketch,
  moveSketchPoint,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { useState } from "react"
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

function solveResult(
  pointOverrides: ReadonlyMap<string, Readonly<{ x: number; y: number }>> = new Map(),
): ActiveSketchSolveResult {
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
        points: pointEntities.map(({ id, x, y }) => ({
          entityId: id,
          ...(pointOverrides.get(id) ?? { x, y }),
        })),
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

type SketchViewportTestProps = Readonly<{
  draft?: React.ComponentProps<typeof SketchViewport>["state"]["draft"]
  editorTool?: React.ComponentProps<typeof SketchViewport>["state"]["editorTool"]
  onDraftChange?: React.ComponentProps<typeof SketchViewport>["actions"]["onDraftChange"]
  onEditorToolChange?: React.ComponentProps<typeof SketchViewport>["actions"]["onEditorToolChange"]
  onConstraintSelectionChange?: React.ComponentProps<
    typeof SketchViewport
  >["actions"]["onConstraintSelectionChange"]
  onProfileSelect?: React.ComponentProps<typeof SketchViewport>["actions"]["onProfileSelect"]
  onProfilesChange?: React.ComponentProps<typeof SketchViewport>["actions"]["onProfilesChange"]
  selectedConstraintId?: React.ComponentProps<
    typeof SketchViewport
  >["state"]["selectedConstraintId"]
  selectedEntityIds?: React.ComponentProps<typeof SketchViewport>["state"]["selectedEntityIds"]
  sketch: React.ComponentProps<typeof SketchViewport>["state"]["sketch"]
  solveSketch: NonNullable<React.ComponentProps<typeof SketchViewport>["solveSketch"]>
  displayUnits?: React.ComponentProps<typeof DocumentDisplayUnitsProvider>["displayUnits"]
}>

function viewportState(props: SketchViewportTestProps) {
  return {
    construction: false,
    controller,
    draft: props.draft ?? null,
    editorTool: props.editorTool ?? "select",
    selectedConstraintId: props.selectedConstraintId ?? null,
    selectedEntityIds: props.selectedEntityIds ?? [],
    selectedProfile: null,
    sketch: props.sketch,
  } satisfies React.ComponentProps<typeof SketchViewport>["state"]
}

function viewportActions(props: SketchViewportTestProps) {
  return {
    onDraftChange: props.onDraftChange ?? noOperation,
    onEditorToolChange: props.onEditorToolChange ?? noOperation,
    onConstraintSelectionChange: props.onConstraintSelectionChange ?? noOperation,
    onFailedConstraintsChange: noOperation,
    onProfileSelect: props.onProfileSelect ?? noOperation,
    onProfilesChange: props.onProfilesChange ?? noOperation,
    onRedo: noOperation,
    onSelectionChange: noOperation,
    onUndo: noOperation,
  } satisfies React.ComponentProps<typeof SketchViewport>["actions"]
}

function viewportElement(props: SketchViewportTestProps) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <DocumentDisplayUnitsProvider
        displayUnits={props.displayUnits ?? { length: "mm", angle: "deg" }}
      >
        <TooltipProvider delayDuration={0}>
          <SketchViewport
            solveSketch={props.solveSketch}
            state={viewportState(props)}
            actions={viewportActions(props)}
          />
        </TooltipProvider>
      </DocumentDisplayUnitsProvider>
    </I18nProvider>
  )
}

function renderViewport(props: SketchViewportTestProps) {
  return render(viewportElement(props))
}

function StatefulSketchViewport(
  props: Omit<SketchViewportTestProps, "draft" | "sketch"> & {
    onDraftChange?: NonNullable<SketchViewportTestProps["onDraftChange"]>
  },
) {
  const [draft, setDraft] = useState(sketch)
  return viewportElement({
    ...props,
    draft,
    sketch,
    onDraftChange: (nextDraft, mode) => {
      setDraft(nextDraft)
      props.onDraftChange?.(nextDraft, mode)
    },
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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
    expect(solveSketch).toHaveBeenCalledWith(7, sketch, {
      continuation: null,
      draggedPoints: [],
    })
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
    await waitFor(() =>
      expect(solveSketch).toHaveBeenCalledWith(7, sketch, {
        continuation: null,
        draggedPoints: [],
      }),
    )
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

  it("previews and creates a midpoint line with persistent symmetry", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "midpoint-line",
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
    expect(document.querySelector('[data-sketch-preview-tool="midpoint-line"]')).toBeTruthy()
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(drawing, { clientX: 600, clientY: 180 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "point")).toHaveLength(3)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(1)
    expect(draft.entities).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "point", construction: true })]),
    )
    expect(draft.constraints).toEqual([expect.objectContaining({ type: "midpoint" })])
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

  it("previews and creates an aligned rectangle with persistent design intent", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "aligned-rectangle",
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

    fireEvent.pointerDown(drawing, { clientX: 220, clientY: 360 })
    fireEvent.pointerMove(drawing, { clientX: 520, clientY: 260 })
    expect(
      document.querySelector('[data-sketch-preview-tool="aligned-rectangle-end"]'),
    ).toBeTruthy()

    fireEvent.pointerDown(drawing, { clientX: 520, clientY: 260 })
    fireEvent.pointerMove(drawing, { clientX: 560, clientY: 140 })
    const widthPreview = document.querySelector(
      '[data-sketch-preview-tool="aligned-rectangle-width"]',
    )
    expect(widthPreview?.querySelector("polygon")).toBeTruthy()
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(drawing, { clientX: 560, clientY: 140 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "point")).toHaveLength(4)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(4)
    expect(draft.constraints).toEqual([
      expect.objectContaining({ type: "perpendicular" }),
      expect.objectContaining({ type: "parallel" }),
      expect.objectContaining({ type: "parallel" }),
    ])
  })

  it("previews and creates a centered aligned rectangle with a persistent center axis", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "centered-aligned-rectangle",
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
    fireEvent.pointerMove(drawing, { clientX: 560, clientY: 300 })
    expect(
      document.querySelector('[data-sketch-preview-tool="centered-aligned-rectangle-side"]'),
    ).toBeTruthy()

    fireEvent.pointerDown(drawing, { clientX: 560, clientY: 300 })
    fireEvent.pointerMove(drawing, { clientX: 520, clientY: 180 })
    const widthPreview = document.querySelector(
      '[data-sketch-preview-tool="centered-aligned-rectangle-width"]',
    )
    expect(widthPreview?.querySelector("polygon")).toBeTruthy()
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(drawing, { clientX: 520, clientY: 180 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "point")).toHaveLength(7)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(5)
    expect(
      draft.entities.filter(
        ({ type, construction }: { construction: boolean; type: string }) =>
          type === "line" && construction,
      ),
    ).toHaveLength(1)
    expect(draft.constraints.map(({ type }: { type: string }) => type)).toEqual([
      "perpendicular",
      "parallel",
      "parallel",
      "midpoint",
      "midpoint",
      "midpoint",
    ])
  })

  it("previews and creates a straight slot with analytical tangent end caps", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "slot",
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

    fireEvent.pointerDown(drawing, { clientX: 240, clientY: 300 })
    fireEvent.pointerMove(drawing, { clientX: 520, clientY: 300 })
    expect(document.querySelector('[data-sketch-preview-tool="slot-end"]')).toBeTruthy()
    fireEvent.pointerDown(drawing, { clientX: 520, clientY: 300 })
    fireEvent.pointerMove(drawing, { clientX: 520, clientY: 180 })
    const widthPreview = document.querySelector('[data-sketch-preview-tool="slot-width"]')
    expect(widthPreview?.querySelectorAll("line")).toHaveLength(3)
    expect(widthPreview?.querySelectorAll("polyline")).toHaveLength(2)
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(drawing, { clientX: 520, clientY: 180 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "point")).toHaveLength(6)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(3)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "arc")).toHaveLength(2)
    expect(
      draft.entities.filter(
        ({ type, construction }: { construction: boolean; type: string }) =>
          type === "line" && construction,
      ),
    ).toHaveLength(1)
    expect(draft.constraints.map(({ type }: { type: string }) => type)).toEqual(["parallel"])
  })

  it("previews and creates a centered slot around a midpoint-constrained centerline", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "centered-slot",
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
    fireEvent.pointerMove(drawing, { clientX: 560, clientY: 300 })
    const endPreview = document.querySelector('[data-sketch-preview-tool="centered-slot-end"]')
    expect(endPreview?.querySelector("line")?.getAttribute("x1")).toBe("-40")
    expect(endPreview?.querySelector("line")?.getAttribute("x2")).toBe("40")
    fireEvent.pointerDown(drawing, { clientX: 560, clientY: 300 })
    fireEvent.pointerMove(drawing, { clientX: 560, clientY: 180 })
    const widthPreview = document.querySelector('[data-sketch-preview-tool="centered-slot-width"]')
    expect(widthPreview?.querySelectorAll("line")).toHaveLength(3)
    expect(widthPreview?.querySelectorAll("polyline")).toHaveLength(2)

    fireEvent.pointerDown(drawing, { clientX: 560, clientY: 180 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "point")).toHaveLength(7)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(3)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "arc")).toHaveLength(2)
    expect(draft.constraints.map(({ type }: { type: string }) => type)).toEqual([
      "midpoint",
      "parallel",
    ])
  })

  it("turns one selected line into a straight slot with one width click", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const lineSketch = appendSketchLine(emptySketch, {
      construction: false,
      createEntityId: sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b247"),
      end: { kind: "new", point: { x: 24, y: 0 } },
      start: { kind: "new", point: { x: -24, y: 0 } },
    }).sketch
    const centerLine = lineSketch.entities.find((entity) => entity.type === "line")
    if (!centerLine) throw new Error("Expected the slot source line to exist.")
    const onDraftChange = vi.fn()
    const onEditorToolChange = vi.fn()
    renderViewport({
      draft: lineSketch,
      editorTool: "slot-from-selection",
      onDraftChange,
      onEditorToolChange,
      selectedEntityIds: [centerLine.id],
      sketch: lineSketch,
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

    fireEvent.pointerMove(drawing, { clientX: 400, clientY: 180 })
    const preview = document.querySelector('[data-sketch-preview-tool="slot-from-selection-width"]')
    expect(preview?.querySelectorAll("line")).toHaveLength(3)
    expect(preview?.querySelectorAll("polyline")).toHaveLength(2)
    fireEvent.pointerDown(drawing, { clientX: 400, clientY: 180 })

    expect(onDraftChange).toHaveBeenCalledOnce()
    expect(onEditorToolChange).toHaveBeenCalledWith("select")
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "point")).toHaveLength(6)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(3)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "arc")).toHaveLength(2)
    expect(
      draft.entities.find(({ id }: { id: string }) => id === centerLine.id)?.construction,
    ).toBe(true)
    expect(draft.constraints.map(({ type }: { type: string }) => type)).toEqual(["parallel"])
  })

  it("previews and creates a three-point arc as one draft edit", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "three-point-arc",
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

    fireEvent.pointerDown(drawing, { clientX: 200, clientY: 300 })
    fireEvent.pointerDown(drawing, { clientX: 600, clientY: 300 })
    fireEvent.pointerMove(drawing, { clientX: 400, clientY: 160 })
    expect(
      document.querySelector('[data-sketch-preview-tool="three-point-arc-point"]'),
    ).toBeTruthy()
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(drawing, { clientX: 400, clientY: 160 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "point")).toHaveLength(3)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "arc")).toHaveLength(1)
    expect(draft.constraints).toEqual([])
  })

  it("creates a tangent arc from a line endpoint and returns to the line tool", () => {
    const onDraftChange = vi.fn()
    const onEditorToolChange = vi.fn()
    renderViewport({
      draft: sketch,
      editorTool: "tangent-arc",
      sketch,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
      onDraftChange,
      onEditorToolChange,
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
    const startPoint = pointEntities[0]
    if (!startPoint) throw new Error("The rectangle fixture must contain a point.")
    const pointElement = document.querySelector(`[data-sketch-entity-id="${startPoint.id}"]`)
    if (!pointElement) throw new Error("The tangent start point must be rendered.")

    fireEvent.pointerDown(pointElement)
    fireEvent.pointerMove(drawing, { clientX: 520, clientY: 180 })
    expect(document.querySelector('[data-sketch-preview-tool="tangent-arc"]')).toBeTruthy()
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(drawing, { clientX: 520, clientY: 180 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "arc")).toHaveLength(1)
    expect(draft.constraints).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "tangent" })]),
    )
    expect(onEditorToolChange).toHaveBeenCalledWith("line")
  })

  it("previews and creates a circle through three picked points as one draft edit", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "three-point-circle",
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

    fireEvent.pointerDown(drawing, { clientX: 200, clientY: 300 })
    fireEvent.pointerDown(drawing, { clientX: 600, clientY: 300 })
    fireEvent.pointerMove(drawing, { clientX: 400, clientY: 160 })
    expect(
      document.querySelector('[data-sketch-preview-tool="three-point-circle-third"]'),
    ).toBeTruthy()
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(drawing, { clientX: 400, clientY: 160 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "point")).toHaveLength(4)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "circle")).toHaveLength(1)
    expect(draft.constraints).toHaveLength(3)
    expect(draft.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "point-on-curve" }),
        expect.objectContaining({ type: "point-on-curve" }),
        expect.objectContaining({ type: "point-on-curve" }),
      ]),
    )
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

  it("suppresses inference with Shift and persists a midpoint point relation", () => {
    const onDraftChange = vi.fn()
    renderViewport({
      draft: sketch,
      editorTool: "point",
      sketch,
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

    fireEvent.pointerMove(drawing, { clientX: 400, clientY: 324, shiftKey: true })
    expect(document.querySelector('[data-sketch-inference="midpoint"]')).toBeNull()
    fireEvent.pointerMove(drawing, { clientX: 400, clientY: 324 })
    expect(document.querySelector('[data-sketch-inference="midpoint"]')).toBeTruthy()
    fireEvent.pointerDown(drawing, { clientX: 400, clientY: 324 })

    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    const createdPoint = draft.entities
      .filter(({ type }: { type: string }) => type === "point")
      .at(-1)
    const referenceLine = sketch.entities.find((entity) => entity.type === "line")
    if (!createdPoint || !referenceLine) throw new Error("Midpoint inference must create a point.")
    expect(draft.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "midpoint",
          pointId: createdPoint.id,
          lineId: referenceLine?.id,
        }),
      ]),
    )
  })

  it("persists perpendicular inference for a connected non-axis line", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const diagonalSketch = appendSketchLine(emptySketch, {
      createEntityId: sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b243"),
      start: { kind: "new", point: { x: -30, y: -20 } },
      end: { kind: "new", point: { x: 0, y: 0 } },
    }).sketch
    const referenceLine = diagonalSketch.entities.find((entity) => entity.type === "line")
    if (!referenceLine) throw new Error("The diagonal fixture must contain a line.")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: diagonalSketch,
      editorTool: "line",
      sketch: diagonalSketch,
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
    const pointElement = document.querySelector(
      `[data-sketch-entity-id="${referenceLine.endPointId}"]`,
    )
    if (!pointElement) throw new Error("The diagonal endpoint must be rendered.")

    fireEvent.pointerDown(pointElement)
    fireEvent.pointerMove(drawing, { clientX: 380, clientY: 140 })
    expect(document.querySelector('[data-sketch-direction-inference="perpendicular"]')).toBeTruthy()
    fireEvent.pointerDown(drawing, { clientX: 380, clientY: 140 })

    const draft = onDraftChange.mock.calls[0]?.[0]
    const createdLine = draft.entities
      .filter(({ type }: { type: string }) => type === "line")
      .at(-1)
    if (!createdLine) throw new Error("Perpendicular inference must create a line.")
    expect(draft.constraints).toEqual([
      expect.objectContaining({
        type: "perpendicular",
        firstEntityId: referenceLine.id,
        secondEntityId: createdLine.id,
      }),
    ])
  })

  it("persists tangent inference when Line continues from an arc endpoint", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const arcSketch = appendSketchArc(emptySketch, {
      center: { x: 0, y: 0 },
      createEntityId: sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b244"),
      start: { x: 10, y: 0 },
      end: { x: 0, y: 10 },
    }).sketch
    const arc = arcSketch.entities.find((entity) => entity.type === "arc")
    if (!arc) throw new Error("The arc fixture must contain an arc.")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: arcSketch,
      editorTool: "line",
      sketch: arcSketch,
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
    const startPoint = document.querySelector(`[data-sketch-entity-id="${arc.startPointId}"]`)
    if (!startPoint) throw new Error("The arc start point must be rendered.")

    fireEvent.pointerDown(startPoint)
    fireEvent.pointerMove(drawing, { clientX: 420, clientY: 200 })
    expect(document.querySelector('[data-sketch-direction-inference="tangent"]')).toBeTruthy()
    fireEvent.pointerDown(drawing, { clientX: 420, clientY: 200 })

    const draft = onDraftChange.mock.calls[0]?.[0]
    const createdLine = draft.entities
      .filter(({ type }: { type: string }) => type === "line")
      .at(-1)
    if (!createdLine) throw new Error("Tangent inference must create a line.")
    expect(draft.constraints).toEqual([
      expect.objectContaining({ type: "tangent", arcId: arc.id, lineId: createdLine.id }),
    ])
  })

  it("renders selectable geometric constraint glyphs and driving dimension labels", () => {
    const onConstraintSelectionChange = vi.fn()
    renderViewport({
      draft: sketch,
      sketch,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
      onConstraintSelectionChange,
    })

    expect(document.querySelector('[data-sketch-constraint-kind="geometric"]')).toBeTruthy()
    const dimension = document.querySelector('[data-sketch-constraint-kind="dimension"]')
    expect(dimension).toBeTruthy()
    fireEvent.click(dimension as Element)
    expect(onConstraintSelectionChange).toHaveBeenCalledWith(
      sketch.constraints.find((constraint) => "value" in constraint)?.id,
    )
  })

  it("offers icon-only precision tools for the current sketch selection", () => {
    const selectedLine = sketch.entities.find((entity) => entity.type === "line")
    if (!selectedLine) throw new Error("The rectangle fixture must contain a line.")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: sketch,
      sketch,
      selectedEntityIds: [selectedLine.id],
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
      onDraftChange,
    })

    expect(screen.getByRole("toolbar", { name: "Sketch precision tools" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Horizontal" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Vertical" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Add drawing dimension" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Vertical" }))
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.arrayContaining([
          expect.objectContaining({ type: "vertical", lineId: selectedLine.id }),
        ]),
      }),
    )
  })

  it("forwards the previous exact solution and active point drag to the solver", async () => {
    const solveSketch = vi.fn(async () => solveResult())
    renderViewport({ draft: sketch, sketch, solveSketch })
    await screen.findByText("Fully constrained")
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
    const firstPoint = pointEntities[0]
    if (!firstPoint) throw new Error("The rectangle fixture must contain a point.")
    const pointElement = document.querySelector(`[data-sketch-entity-id="${firstPoint.id}"]`)
    if (!pointElement) throw new Error("The first sketch point must be rendered.")

    fireEvent.pointerDown(pointElement, { pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180, pointerId: 1 })

    await waitFor(() =>
      expect(solveSketch).toHaveBeenCalledWith(
        7,
        sketch,
        expect.objectContaining({
          continuation: expect.objectContaining({
            sketchId,
            points: expect.arrayContaining([expect.objectContaining({ entityId: firstPoint.id })]),
          }),
          draggedPoints: [expect.objectContaining({ entityId: firstPoint.id, x: 65, y: 36 })],
        }),
      ),
    )
  })

  it("keeps drag frames local and commits only the final point position", async () => {
    const solveSketch = vi.fn(async () => solveResult())
    const onDraftChange = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    renderViewport({ draft: sketch, sketch, solveSketch, onDraftChange })
    await screen.findByText("Fully constrained")
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
    const firstPoint = pointEntities[0]
    if (!firstPoint) throw new Error("The rectangle fixture must contain a point.")
    const pointElement = document.querySelector(`[data-sketch-entity-id="${firstPoint.id}"]`)
    if (!pointElement) throw new Error("The first sketch point must be rendered.")

    fireEvent.pointerDown(pointElement, { pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 500, clientY: 240, pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180, pointerId: 1 })

    expect(onDraftChange).not.toHaveBeenCalled()
    const frame = frames.shift()
    if (!frame) throw new Error("The point drag must schedule an animation frame.")
    act(() => frame(0))
    expect(onDraftChange).not.toHaveBeenCalled()
    expect(
      document.querySelector(`[data-sketch-entity-id="${firstPoint.id}"]`)?.getAttribute("cx"),
    ).toBe("65")
    expect(
      document.querySelector(`[data-sketch-entity-id="${firstPoint.id}"]`)?.getAttribute("cy"),
    ).toBe("36")

    fireEvent.pointerUp(drawing, { pointerId: 1 })

    expect(onDraftChange).toHaveBeenCalledTimes(1)
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: expect.arrayContaining([
          expect.objectContaining({ id: firstPoint.id, type: "point", x: 65, y: 36 }),
        ]),
      }),
      "record",
    )
  })

  it("persists midpoint inference in the single point-drag commit", () => {
    const onDraftChange = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    renderViewport({
      draft: sketch,
      sketch,
      solveSketch: vi.fn(async () => solveResult()),
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
    const draggedPoint = pointEntities[0]
    const midpointLine = sketch.entities.filter((entity) => entity.type === "line")[2]
    if (!draggedPoint || !midpointLine) throw new Error("The rectangle fixture is incomplete.")
    const pointElement = document.querySelector(`[data-sketch-entity-id="${draggedPoint.id}"]`)
    if (!pointElement) throw new Error("The dragged sketch point must be rendered.")

    fireEvent.pointerDown(pointElement, { pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 390, clientY: 280, pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 400, clientY: 276, pointerId: 1 })
    expect(frames).toHaveLength(1)
    expect(document.querySelector('[data-sketch-inference="midpoint"]')).toBeNull()
    const frame = frames.shift()
    if (!frame) throw new Error("The point drag must schedule an animation frame.")
    act(() => frame(0))
    expect(document.querySelector('[data-sketch-inference="midpoint"]')).toBeTruthy()
    expect(onDraftChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(drawing, { pointerId: 1 })

    expect(onDraftChange).toHaveBeenCalledOnce()
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: expect.arrayContaining([
          expect.objectContaining({ id: draggedPoint.id, type: "point", x: 15, y: 12 }),
        ]),
        constraints: expect.arrayContaining([
          expect.objectContaining({
            type: "midpoint",
            pointId: draggedPoint.id,
            lineId: midpointLine.id,
          }),
        ]),
      }),
      "record",
    )
  })

  it("renders the latest drag immediately and coalesces stale in-flight solves", async () => {
    const firstPoint = pointEntities[0]
    if (!firstPoint) throw new Error("The rectangle fixture must contain a point.")
    let resolveInFlight: ((result: ActiveSketchSolveResult) => void) | null = null
    const solveSketch = vi
      .fn<NonNullable<React.ComponentProps<typeof SketchViewport>["solveSketch"]>>()
      .mockResolvedValueOnce(solveResult())
      .mockImplementationOnce(
        () =>
          new Promise<ActiveSketchSolveResult>((resolve) => {
            resolveInFlight = resolve
          }),
      )
      .mockResolvedValue(solveResult())
    const onDraftChange = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    render(<StatefulSketchViewport solveSketch={solveSketch} onDraftChange={onDraftChange} />)
    await screen.findByText("Fully constrained")
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
    const pointSelector = `[data-sketch-entity-id="${firstPoint.id}"]`
    const pointElement = document.querySelector(pointSelector)
    if (!pointElement) throw new Error("The first sketch point must be rendered.")
    const moveAndFlush = (clientX: number, clientY: number) => {
      fireEvent.pointerMove(drawing, { clientX, clientY, pointerId: 1 })
      const frame = frames.shift()
      if (!frame) throw new Error("The point drag must schedule an animation frame.")
      act(() => frame(0))
    }

    fireEvent.pointerDown(pointElement, { pointerId: 1 })
    moveAndFlush(500, 240)
    await waitFor(() => expect(solveSketch).toHaveBeenCalledTimes(2))
    moveAndFlush(600, 180)

    expect(solveSketch).toHaveBeenCalledTimes(2)
    expect(document.querySelector(pointSelector)?.getAttribute("cx")).toBe("65")
    expect(document.querySelector(pointSelector)?.getAttribute("cy")).toBe("36")
    await act(async () => resolveInFlight?.(solveResult()))
    await waitFor(() => expect(solveSketch).toHaveBeenCalledTimes(3))
    expect(solveSketch).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ id: sketch.id }),
      expect.objectContaining({
        draggedPoints: [{ entityId: firstPoint.id, x: 65, y: 36 }],
      }),
    )
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 50)))
    expect(solveSketch).toHaveBeenCalledTimes(3)
  })

  it("keeps the final drag target when the pointer is released before the frame", async () => {
    const firstPoint = pointEntities[0]
    if (!firstPoint) throw new Error("The rectangle fixture must contain a point.")
    const finalPoint = { x: 65, y: 36 }
    let resolveReleasedDrag: ((result: ActiveSketchSolveResult) => void) | null = null
    const solveSketch = vi
      .fn<NonNullable<React.ComponentProps<typeof SketchViewport>["solveSketch"]>>()
      .mockResolvedValueOnce(solveResult())
      .mockImplementationOnce(
        () =>
          new Promise<ActiveSketchSolveResult>((resolve) => {
            resolveReleasedDrag = resolve
          }),
      )
      .mockResolvedValue(solveResult(new Map([[firstPoint.id, finalPoint]])))
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id)
    })
    render(<StatefulSketchViewport solveSketch={solveSketch} />)
    await screen.findByText("Fully constrained")
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
    const pointSelector = `[data-sketch-entity-id="${firstPoint.id}"]`
    const pointElement = document.querySelector(pointSelector)
    if (!pointElement) throw new Error("The first sketch point must be rendered.")

    fireEvent.pointerDown(pointElement, { pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180, pointerId: 1 })
    fireEvent.pointerUp(drawing, { pointerId: 1 })

    expect(frames).toHaveLength(0)
    expect(document.querySelector(pointSelector)?.getAttribute("cx")).toBe("65")
    expect(document.querySelector(pointSelector)?.getAttribute("cy")).toBe("36")
    await waitFor(() => expect(solveSketch).toHaveBeenCalledTimes(2))
    expect(solveSketch).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ id: sketch.id }),
      expect.objectContaining({
        draggedPoints: [{ entityId: firstPoint.id, ...finalPoint }],
      }),
    )

    await act(async () =>
      resolveReleasedDrag?.(solveResult(new Map([[firstPoint.id, finalPoint]]))),
    )
    await waitFor(() => expect(solveSketch).toHaveBeenCalledTimes(3))
    expect(document.querySelector(pointSelector)?.getAttribute("cx")).toBe("65")
    expect(document.querySelector(pointSelector)?.getAttribute("cy")).toBe("36")
  })

  it("cancels the queued drag frame when pointer input is interrupted", async () => {
    const firstPoint = pointEntities[0]
    if (!firstPoint) throw new Error("The rectangle fixture must contain a point.")
    const onDraftChange = vi.fn()
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    const cancelAnimationFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        frames.delete(id)
      })
    render(
      <StatefulSketchViewport
        solveSketch={vi.fn(async () => solveResult())}
        onDraftChange={onDraftChange}
      />,
    )
    await screen.findByText("Fully constrained")
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
    const pointElement = document.querySelector(`[data-sketch-entity-id="${firstPoint.id}"]`)
    if (!pointElement) throw new Error("The first sketch point must be rendered.")

    fireEvent.pointerDown(pointElement, { pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180, pointerId: 1 })
    fireEvent.pointerCancel(drawing, { pointerId: 1 })

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(frames).toHaveLength(0)
    expect(onDraftChange).toHaveBeenCalledTimes(1)
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 20)))
    expect(onDraftChange).toHaveBeenCalledTimes(1)
  })

  it("keeps the last exact geometry visible while a changed draft is solving", async () => {
    const firstPoint = pointEntities[0]
    if (!firstPoint) throw new Error("The rectangle fixture must contain a point.")
    let resolveChangedDraft: ((result: ActiveSketchSolveResult) => void) | null = null
    const solveSketch = vi
      .fn<NonNullable<React.ComponentProps<typeof SketchViewport>["solveSketch"]>>()
      .mockResolvedValueOnce(solveResult())
      .mockImplementationOnce(
        () =>
          new Promise<ActiveSketchSolveResult>((resolve) => {
            resolveChangedDraft = resolve
          }),
      )
    const result = renderViewport({ draft: sketch, sketch, solveSketch })
    await screen.findByText("Fully constrained")
    const pointSelector = `[data-sketch-entity-id="${firstPoint.id}"]`
    expect(document.querySelector(pointSelector)?.getAttribute("cx")).toBe(String(firstPoint.x))
    const movedDraft = moveSketchPoint(sketch, firstPoint.id, { x: 80, y: 80 })

    result.rerender(viewportElement({ draft: movedDraft, sketch, solveSketch }))

    await screen.findByText("Solving the saved sketch locally…")
    expect(document.querySelector(pointSelector)?.getAttribute("cx")).toBe(String(firstPoint.x))
    await waitFor(() => expect(solveSketch).toHaveBeenCalledTimes(2))
    await act(async () => {
      resolveChangedDraft?.(solveResult(new Map([[firstPoint.id, { x: 12, y: 8 }]])))
    })
    await waitFor(() =>
      expect(document.querySelector(pointSelector)?.getAttribute("cx")).toBe("12"),
    )
  })
})
