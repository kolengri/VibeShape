// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  appendSketchArc,
  appendSketchCircle,
  appendSketchEllipse,
  appendSketchLine,
  appendSketchRectangle,
  createLengthQuantity,
  createRectangleSketch,
  moveSketchPoint,
  type SketchEntity,
  type SketchRecord,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchExternalReferenceIdSchema,
  sketchIdSchema,
  variableIdSchema,
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

const sketchInferenceIndexBuilds = vi.hoisted(() => vi.fn())

vi.mock("@vibeshape/domain", async (importOriginal) => {
  const domain = await importOriginal<typeof import("@vibeshape/domain")>()
  return {
    ...domain,
    createSketchInferenceCandidateQuery: (
      input: Parameters<typeof domain.createSketchInferenceCandidateQuery>[0],
    ) => {
      sketchInferenceIndexBuilds()
      return domain.createSketchInferenceCandidateQuery(input)
    },
  }
})

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3201")

function sequentialIdFactory<Value>(parse: (value: string) => Value, group: string) {
  let index = 0
  return () => {
    index += 1
    return parse(`0195b5ac-${group}-7a2c-8c33-${index.toString(16).padStart(12, "0")}`)
  }
}

function sketchEntitiesOfType<Type extends SketchEntity["type"]>(sketch: SketchRecord, type: Type) {
  return sketch.entities.filter(
    (entity): entity is Extract<SketchEntity, { type: Type }> => entity.type === type,
  )
}

function requiredSketchEntity<Type extends SketchEntity["type"]>(
  sketch: SketchRecord,
  type: Type,
  id?: string,
) {
  const entity = sketchEntitiesOfType(sketch, type).find(
    (candidate) => candidate.id === (id ?? candidate.id),
  )
  if (!entity) throw new Error(`The fixture requires a ${type} entity.`)
  return entity
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
  interactive?: boolean
  overlay?: boolean
  controller?: React.ComponentProps<typeof SketchViewport>["state"]["controller"]
  draft?: React.ComponentProps<typeof SketchViewport>["state"]["draft"]
  editorTool?: React.ComponentProps<typeof SketchViewport>["state"]["editorTool"]
  externalPointCandidates?: React.ComponentProps<
    typeof SketchViewport
  >["state"]["externalPointCandidates"]
  originPlaneVisibility?: React.ComponentProps<
    typeof SketchViewport
  >["state"]["originPlaneVisibility"]
  onDraftChange?: React.ComponentProps<typeof SketchViewport>["actions"]["onDraftChange"]
  onDisplayChange?: React.ComponentProps<typeof SketchViewport>["actions"]["onDisplayChange"]
  onEditorToolChange?: React.ComponentProps<typeof SketchViewport>["actions"]["onEditorToolChange"]
  onConstraintSelectionChange?: React.ComponentProps<
    typeof SketchViewport
  >["actions"]["onConstraintSelectionChange"]
  onProfileSelect?: React.ComponentProps<typeof SketchViewport>["actions"]["onProfileSelect"]
  onOriginPlaneVisibilityChange?: React.ComponentProps<
    typeof SketchViewport
  >["actions"]["onOriginPlaneVisibilityChange"]
  onProfilesChange?: React.ComponentProps<typeof SketchViewport>["actions"]["onProfilesChange"]
  onSelectionChange?: React.ComponentProps<typeof SketchViewport>["actions"]["onSelectionChange"]
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
    controller: props.controller ?? controller,
    draft: props.draft ?? null,
    editorTool: props.editorTool ?? "select",
    externalPointCandidates: props.externalPointCandidates ?? [],
    originPlaneVisibility: props.originPlaneVisibility ?? { xy: true, xz: true, yz: true },
    selectedConstraintId: props.selectedConstraintId ?? null,
    selectedEntityIds: props.selectedEntityIds ?? [],
    selectedProfile: null,
    sketch: props.sketch,
    supportFeatures: props.controller?.report?.snapshot.features ?? [],
  } satisfies React.ComponentProps<typeof SketchViewport>["state"]
}

function viewportActions(props: SketchViewportTestProps) {
  return {
    onDisplayChange: props.onDisplayChange ?? noOperation,
    onDraftChange: props.onDraftChange ?? noOperation,
    onEditorToolChange: props.onEditorToolChange ?? noOperation,
    onConstraintSelectionChange: props.onConstraintSelectionChange ?? noOperation,
    onFailedConstraintsChange: noOperation,
    onOriginPlaneVisibilityChange: props.onOriginPlaneVisibilityChange ?? noOperation,
    onProfileSelect: props.onProfileSelect ?? noOperation,
    onProfilesChange: props.onProfilesChange ?? noOperation,
    onRedo: noOperation,
    onSelectionChange: props.onSelectionChange ?? noOperation,
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
            {...(props.interactive === undefined ? {} : { interactive: props.interactive })}
            {...(props.overlay === undefined ? {} : { overlay: props.overlay })}
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

function lineSketchFixture(
  group: string,
  segments: readonly Readonly<{ end: { x: number; y: number }; start: { x: number; y: number } }>[],
) {
  const createEntityId = sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), group)
  let result: SketchRecord = { ...sketch, constraints: [], entities: [] }
  for (const segment of segments) {
    result = appendSketchLine(result, {
      construction: false,
      createEntityId,
      end: { kind: "new", point: segment.end },
      start: { kind: "new", point: segment.start },
    }).sketch
  }
  return result
}

function denseRectangleSketchFixture(rectangleCount = 24) {
  const createEntityId = sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b261")
  const createConstraintId = sequentialIdFactory(
    (value) => sketchConstraintIdSchema.parse(value),
    "b262",
  )
  let result = sketch
  for (let index = 0; index < rectangleCount; index += 1) {
    const column = index % 6
    const row = Math.floor(index / 6)
    result = appendSketchRectangle(result, {
      createConstraintId,
      createEntityId,
      firstCorner: { x: 40 + column * 12, y: row * 10 },
      oppositeCorner: { x: 48 + column * 12, y: 6 + row * 10 },
    }).sketch
  }
  return result
}

function mockDrawingRectangle(drawing: HTMLElement) {
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
  it("uses a transparent surface in overlay mode", () => {
    const view = renderViewport({
      overlay: true,
      sketch,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const viewport = view.getByRole("region", { name: "2D sketch workspace" })
    expect(viewport.getAttribute("data-overlay")).toBe("true")
    expect(viewport.className).toContain("bg-transparent")
    expect(viewport.className).not.toContain("bg-viewport-background")
  })

  it("keeps the drawing mounted but inert while the 3D context owns navigation", () => {
    const view = renderViewport({
      interactive: false,
      overlay: true,
      sketch,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const viewport = view.container.querySelector<HTMLElement>("[data-interactive='false']")
    expect(viewport).not.toBeNull()
    if (!viewport) return
    expect(viewport.getAttribute("aria-hidden")).toBe("true")
    expect(viewport.hasAttribute("inert")).toBe(true)
    expect(viewport.className).toContain("pointer-events-none")
    expect(viewport.className).toContain("opacity-0")
    expect(viewport.querySelector("svg[role='img']")).toBeTruthy()
    expect(view.queryByRole("region", { name: "2D sketch workspace" })).toBeNull()
  })

  it("publishes the solved draft as world-space display geometry only in orbit mode", async () => {
    const onDisplayChange = vi.fn()
    const view = renderViewport({
      interactive: false,
      onDisplayChange,
      overlay: true,
      sketch,
      solveSketch: vi.fn(async () => solveResult()),
    })

    await waitFor(() =>
      expect(onDisplayChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sketchId,
          curvePositions: expect.any(Float32Array),
        }),
      ),
    )
    const published = onDisplayChange.mock.lastCall?.[0]
    expect(published?.curvePositions.length).toBeGreaterThan(0)

    view.rerender(
      viewportElement({
        interactive: true,
        onDisplayChange,
        overlay: true,
        sketch,
        solveSketch: vi.fn(async () => solveResult()),
      }),
    )
    await waitFor(() => expect(onDisplayChange).toHaveBeenLastCalledWith(null))
  })

  it("uses an earlier coplanar sketch point directly from the drawing", () => {
    const sourcePoint = pointEntities[0]
    if (!sourcePoint) throw new Error("The source sketch fixture must contain a point.")
    const target = { ...sketch, id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3202") }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: target,
      editorTool: "use",
      externalPointCandidates: [
        {
          kind: "point",
          label: "Source sketch · Point",
          sourceSketchId: sketch.id,
          sourcePointId: sourcePoint.id,
          world: [sourcePoint.x, sourcePoint.y, 0],
          x: sourcePoint.x,
          y: sourcePoint.y,
        },
      ],
      onDraftChange,
      sketch: target,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const sourcePointElement = document.querySelector(
      `[data-sketch-available-external-geometry-id="${sourcePoint.id}"]`,
    )
    if (!sourcePointElement) throw new Error("The source point must be selectable on the drawing.")

    fireEvent.pointerDown(sourcePointElement)

    expect(onDraftChange).toHaveBeenCalledOnce()
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReferences: [
          expect.objectContaining({ sourceSketchId: sketch.id, sourcePointId: sourcePoint.id }),
        ],
      }),
    )
  })

  it("uses an earlier sketch line directly from the drawing", () => {
    const sourceLine = sketch.entities.find((entity) => entity.type === "line")
    if (!sourceLine) throw new Error("The source sketch fixture must contain a line.")
    const target = { ...sketch, id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3212") }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: target,
      editorTool: "use",
      externalPointCandidates: [
        {
          kind: "line",
          label: "Source sketch · Line",
          sourceSketchId: sketch.id,
          sourceLineId: sourceLine.id,
          start: { world: [0, 0, 0], x: 0, y: 0 },
          end: { world: [20, 0, 0], x: 20, y: 0 },
        },
      ],
      onDraftChange,
      sketch: target,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const sourceLineElement = document.querySelector(
      `[data-sketch-available-external-geometry-id="${sourceLine.id}"]`,
    )
    if (!sourceLineElement) throw new Error("The source line must be selectable on the drawing.")

    fireEvent.pointerDown(sourceLineElement)

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReferences: [
          expect.objectContaining({
            kind: "line",
            sourceSketchId: sketch.id,
            sourceLineId: sourceLine.id,
          }),
        ],
      }),
    )
  })

  it("renders a solved external line as selectable read-only geometry", async () => {
    const projectedLineId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3231")
    const projectedStartPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3232")
    const projectedEndPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3233")
    const draft = {
      ...sketch,
      externalReferences: [
        {
          schemaVersion: 0 as const,
          id: sketchExternalReferenceIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3234"),
          kind: "line" as const,
          sourceSketchId: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3235"),
          sourceLineId: sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3236"),
          projectedLineId,
          projectedStartPointId,
          projectedEndPointId,
        },
      ],
    }
    const base = solveResult()
    if (!base.ok || base.response.type !== "sketchSolved") throw new Error("Expected solve result.")
    const onSelectionChange = vi.fn()
    renderViewport({
      draft,
      onSelectionChange,
      sketch: draft,
      solveSketch: vi.fn(async () => ({
        ...base,
        response: {
          ...base.response,
          solution: {
            ...base.response.solution,
            points: [
              ...base.response.solution.points,
              { entityId: projectedStartPointId, x: 5, y: 6 },
              { entityId: projectedEndPointId, x: 25, y: 6 },
            ],
          },
        },
      })),
    })

    await waitFor(() =>
      expect(
        document.querySelector(`[data-sketch-external-line-id="${projectedLineId}"]`),
      ).toBeTruthy(),
    )
    const externalLine = document.querySelector(
      `[data-sketch-external-line-id="${projectedLineId}"] line`,
    )
    if (!externalLine) throw new Error("The projected line must expose a selection target.")
    fireEvent.pointerDown(externalLine)
    expect(onSelectionChange).toHaveBeenCalledWith([projectedLineId])
  })

  it("keeps individually toggleable origin references visible while editing a sketch", () => {
    const fixture = lineSketchFixture("b250", [{ start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }])
    const onOriginPlaneVisibilityChange = vi.fn()

    renderViewport({
      draft: fixture,
      onOriginPlaneVisibilityChange,
      originPlaneVisibility: { xy: true, xz: false, yz: true },
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })

    expect(document.querySelector('[data-sketch-origin-plane="xy"]')).toBeTruthy()
    expect(document.querySelector('[data-sketch-origin-plane="xz"]')).toBeNull()
    expect(document.querySelector('[data-sketch-origin-plane="yz"]')).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Hide XY plane" }))
    fireEvent.click(screen.getByRole("button", { name: "Show XZ plane" }))

    expect(onOriginPlaneVisibilityChange).toHaveBeenNthCalledWith(1, "xy", false)
    expect(onOriginPlaneVisibilityChange).toHaveBeenNthCalledWith(2, "xz", true)
  })

  it("splits a clicked line at the pointer as one draft edit", () => {
    const fixture = lineSketchFixture("b251", [{ start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }])
    const target = fixture.entities.find((entity) => entity.type === "line")
    if (!target) throw new Error("The split fixture must contain a line.")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "split",
      onDraftChange,
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const targetElement = document.querySelector(`[data-sketch-entity-id="${target.id}"]`)
    if (!targetElement) throw new Error("The split target must be rendered.")

    fireEvent.pointerDown(targetElement, { clientX: 400, clientY: 300 })

    expect(onDraftChange).toHaveBeenCalledOnce()
    const nextDraft = onDraftChange.mock.calls[0]?.[0]
    expect(nextDraft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(
      2,
    )
    expect(nextDraft.entities.find(({ id }: { id: string }) => id === target.id)).toBeTruthy()
    expect(nextDraft.constraints).toEqual([
      expect.objectContaining({ type: "parallel", firstEntityId: target.id }),
    ])
  })

  it("trims the clicked line segment between neighboring boundaries", () => {
    const fixture = lineSketchFixture("b252", [
      { start: { x: -10, y: 0 }, end: { x: 10, y: 0 } },
      { start: { x: -3, y: -10 }, end: { x: -3, y: 10 } },
      { start: { x: 3, y: -10 }, end: { x: 3, y: 10 } },
    ])
    const target = fixture.entities.find((entity) => entity.type === "line")
    if (!target) throw new Error("The trim fixture must contain a target line.")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "trim",
      onDraftChange,
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const targetElement = document.querySelector(`[data-sketch-entity-id="${target.id}"]`)
    if (!targetElement) throw new Error("The trim target must be rendered.")

    fireEvent.pointerDown(targetElement, { clientX: 400, clientY: 300 })

    expect(onDraftChange).toHaveBeenCalledOnce()
    const nextDraft = onDraftChange.mock.calls[0]?.[0]
    expect(nextDraft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(
      4,
    )
    expect(nextDraft.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "parallel", firstEntityId: target.id }),
      ]),
    )
  })

  it("extends the clicked line endpoint to the nearest bounded line", () => {
    const fixture = lineSketchFixture("b253", [
      { start: { x: -10, y: 0 }, end: { x: 0, y: 0 } },
      { start: { x: 10, y: -10 }, end: { x: 10, y: 10 } },
    ])
    const target = fixture.entities.find((entity) => entity.type === "line")
    if (!target) throw new Error("The extend fixture must contain a target line.")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "extend",
      onDraftChange,
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const targetElement = document.querySelector(`[data-sketch-entity-id="${target.id}"]`)
    if (!targetElement) throw new Error("The extend target must be rendered.")

    fireEvent.pointerDown(targetElement, { clientX: 398, clientY: 300 })

    expect(onDraftChange).toHaveBeenCalledOnce()
    const nextDraft = onDraftChange.mock.calls[0]?.[0]
    const extended = nextDraft.entities.find(({ id }: { id: string }) => id === target.id)
    const endPoint = nextDraft.entities.find(({ id }: { id: string }) => id === extended.endPointId)
    expect(endPoint).toMatchObject({ type: "point", x: 10, y: 0 })
  })

  it("mirrors a preselected line after selecting its axis", () => {
    const fixture = lineSketchFixture("b256", [
      { start: { x: -10, y: 0 }, end: { x: 10, y: 0 } },
      { start: { x: 2, y: 3 }, end: { x: 7, y: 8 } },
    ])
    const [axis, source] = fixture.entities.filter((entity) => entity.type === "line")
    if (!axis || !source) throw new Error("The mirror fixture must contain an axis and a source.")
    const onDraftChange = vi.fn()
    const onEditorToolChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "mirror",
      onDraftChange,
      onEditorToolChange,
      selectedEntityIds: [source.id],
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    expect(document.querySelector("[data-sketch-mirror-instruction]")?.textContent).toBe(
      "Select a mirror line for the selected geometry.",
    )
    const axisElement = document.querySelector(`[data-sketch-entity-id="${axis.id}"]`)
    if (!axisElement) throw new Error("The mirror axis must be rendered.")

    fireEvent.pointerDown(axisElement)

    expect(onDraftChange).toHaveBeenCalledOnce()
    expect(onEditorToolChange).toHaveBeenCalledWith("select")
    const nextDraft = onDraftChange.mock.calls[0]?.[0] as SketchRecord
    const reflectedLine = nextDraft.entities.find(
      (entity) => entity.type === "line" && entity.id !== axis.id && entity.id !== source.id,
    )
    if (reflectedLine?.type !== "line") throw new Error("Mirror must create a reflected line.")
    const reflectedPoints = [reflectedLine.startPointId, reflectedLine.endPointId].map((pointId) =>
      nextDraft.entities.find(({ id }) => id === pointId),
    )
    expect(reflectedPoints).toEqual([
      expect.objectContaining({ type: "point", x: 2, y: -3 }),
      expect.objectContaining({ type: "point", x: 7, y: -8 }),
    ])
    expect(nextDraft.constraints.filter(({ type }) => type === "symmetric")).toHaveLength(2)
  })

  it("keeps Mirror active while selecting sources after the axis", () => {
    const fixture = lineSketchFixture("b257", [
      { start: { x: 0, y: -10 }, end: { x: 0, y: 10 } },
      { start: { x: 3, y: 2 }, end: { x: 8, y: 7 } },
    ])
    const [axis, source] = fixture.entities.filter((entity) => entity.type === "line")
    if (!axis || !source) throw new Error("The mirror fixture must contain an axis and a source.")
    const onDraftChange = vi.fn()
    const onEditorToolChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "mirror",
      onDraftChange,
      onEditorToolChange,
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    expect(document.querySelector("[data-sketch-mirror-instruction]")?.textContent).toBe(
      "Select a mirror line, then select geometry to mirror.",
    )
    const axisElement = document.querySelector(`[data-sketch-entity-id="${axis.id}"]`)
    const sourceElement = document.querySelector(`[data-sketch-entity-id="${source.id}"]`)
    if (!axisElement || !sourceElement) throw new Error("The mirror geometry must be rendered.")

    fireEvent.pointerDown(axisElement)
    expect(onDraftChange).not.toHaveBeenCalled()
    expect(document.querySelector("[data-sketch-mirror-instruction]")?.textContent).toBe(
      "Select geometry to mirror. Press Escape when finished.",
    )

    fireEvent.pointerDown(sourceElement)
    expect(onDraftChange).toHaveBeenCalledOnce()
    expect(onEditorToolChange).not.toHaveBeenCalled()

    fireEvent.keyDown(drawing, { key: "Escape" })
    expect(onEditorToolChange).toHaveBeenCalledWith("select")
  })

  it("previews and commits a preselected connected line-chain offset", () => {
    const fixture = sketch
    const lines = fixture.entities.filter((entity) => entity.type === "line")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "offset",
      onDraftChange,
      selectedEntityIds: lines.map(({ id }) => id),
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    expect(document.querySelector("[data-sketch-offset-instruction]")?.textContent).toBe(
      "Move the pointer to set the signed offset, then click.",
    )

    fireEvent.pointerMove(drawing, { clientX: 400, clientY: 250 })
    const preview = document.querySelector('[data-sketch-preview-tool="offset-distance"]')
    expect(preview).toBeTruthy()
    expect(preview?.querySelectorAll("line")).toHaveLength(4)
    fireEvent.pointerDown(drawing, { button: 0, clientX: 400, clientY: 250 })

    expect(onDraftChange).toHaveBeenCalledOnce()
    const nextDraft = onDraftChange.mock.calls[0]?.[0] as SketchRecord
    expect(nextDraft.entities.filter(({ type }) => type === "line")).toHaveLength(8)
    expect(nextDraft.constraints.filter(({ type }) => type === "offset")).toHaveLength(1)
  })

  it("selects a connected offset source from the canvas and cancels only its distance step", () => {
    const fixture = lineSketchFixture("b259", [{ start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }])
    const line = fixture.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The offset fixture must contain a source line.")
    const onDraftChange = vi.fn()
    const onEditorToolChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "offset",
      onDraftChange,
      onEditorToolChange,
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    const lineElement = document.querySelector(`[data-sketch-entity-id="${line.id}"]`)
    if (!lineElement) throw new Error("The offset source must be rendered.")
    expect(document.querySelector("[data-sketch-offset-instruction]")?.textContent).toBe(
      "Select a line or connected line chain to offset.",
    )

    fireEvent.pointerDown(lineElement)
    expect(document.querySelector("[data-sketch-offset-instruction]")?.textContent).toBe(
      "Move the pointer to set the signed offset, then click.",
    )
    fireEvent.keyDown(drawing, { key: "Escape" })

    expect(onDraftChange).not.toHaveBeenCalled()
    expect(onEditorToolChange).not.toHaveBeenCalled()
    expect(document.querySelector("[data-sketch-offset-instruction]")?.textContent).toBe(
      "Select a line or connected line chain to offset.",
    )
  })

  it("previews a selected geometry transform and commits it as one draft edit", () => {
    const fixture = lineSketchFixture("b25a", [{ start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }])
    const line = fixture.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The transform fixture must contain a line.")
    const onDraftChange = vi.fn()
    const onEditorToolChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "transform",
      onDraftChange,
      onEditorToolChange,
      selectedEntityIds: [line.id],
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    expect(document.querySelector("[data-sketch-transform-manipulator]")).toBeTruthy()
    expect(document.querySelector("[data-sketch-transform-instruction]")?.textContent).toContain(
      "Drag to move",
    )
    const moveX = document.querySelector('[data-sketch-transform-handle="move-x"]')
    if (!moveX) throw new Error("The transform manipulator must expose its horizontal handle.")

    fireEvent.pointerDown(moveX, { clientX: 400, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 480, clientY: 300, pointerId: 1 })

    expect(document.querySelector("[data-sketch-transform-preview]")).toBeTruthy()
    expect(onDraftChange).not.toHaveBeenCalled()
    fireEvent.keyDown(drawing, { key: "Enter" })

    expect(onDraftChange).toHaveBeenCalledOnce()
    expect(onDraftChange.mock.calls[0]?.[1]).toBe("record")
    expect(onEditorToolChange).toHaveBeenCalledWith("select")
    const nextDraft = onDraftChange.mock.calls[0]?.[0] as SketchRecord
    const start = nextDraft.entities.find(({ id }) => id === line.startPointId)
    const end = nextDraft.entities.find(({ id }) => id === line.endPointId)
    expect(start).toMatchObject({ type: "point", x: 10, y: 0 })
    expect(end).toMatchObject({ type: "point", x: 30, y: 0 })
  })

  it("supports post-selection and cancels a pending transform without changing the draft", () => {
    const fixture = lineSketchFixture("b25b", [{ start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }])
    const line = fixture.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The transform fixture must contain a line.")
    const onDraftChange = vi.fn()
    const onEditorToolChange = vi.fn()
    const onSelectionChange = vi.fn()
    const view = renderViewport({
      draft: fixture,
      editorTool: "transform",
      onDraftChange,
      onEditorToolChange,
      onSelectionChange,
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    expect(document.querySelector("[data-sketch-transform-instruction]")?.textContent).toBe(
      "Select sketch geometry to transform.",
    )
    const lineElement = document.querySelector(`[data-sketch-entity-id="${line.id}"]`)
    if (!lineElement) throw new Error("The transform source must be rendered.")
    fireEvent.pointerDown(lineElement)
    expect(onSelectionChange).toHaveBeenCalledWith([line.id])

    view.rerender(
      viewportElement({
        draft: fixture,
        editorTool: "transform",
        onDraftChange,
        onEditorToolChange,
        onSelectionChange,
        selectedEntityIds: [line.id],
        sketch: fixture,
        solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
      }),
    )
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const scale = document.querySelector('[data-sketch-transform-handle="scale"]')
    if (!scale) throw new Error("The transform manipulator must expose its scale handle.")
    fireEvent.pointerDown(scale, { clientX: 430, clientY: 270, pointerId: 2 })
    fireEvent.pointerMove(drawing, { clientX: 460, clientY: 240, pointerId: 2 })
    fireEvent.keyDown(drawing, { key: "Escape" })

    expect(onDraftChange).not.toHaveBeenCalled()
    expect(onEditorToolChange).toHaveBeenCalledWith("select")
  })

  it("snaps a relocated transform origin to authored sketch points without editing geometry", async () => {
    const fixture = lineSketchFixture("b25c", [{ start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }])
    const line = fixture.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The transform fixture must contain a line.")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "transform",
      onDraftChange,
      selectedEntityIds: [line.id],
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const origin = document.querySelector('[data-sketch-transform-handle="origin"]')
    if (!origin) throw new Error("The transform manipulator must expose its origin handle.")

    fireEvent.pointerDown(origin, { clientX: 400, clientY: 300, pointerId: 3 })
    fireEvent.pointerMove(drawing, { clientX: 439, clientY: 300, pointerId: 3 })
    fireEvent.pointerUp(drawing, { clientX: 439, clientY: 300, pointerId: 3 })

    await waitFor(() => {
      const input = screen.getByRole("combobox", { name: "Origin X" }) as HTMLInputElement
      expect(input.value).toBe("10 mm")
    })
    expect(onDraftChange).not.toHaveBeenCalled()
  })

  it("applies variable-aware exact transform values as one recorded edit", async () => {
    const fixture = lineSketchFixture("b25d", [{ start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }])
    const line = fixture.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The transform fixture must contain a line.")
    const onDraftChange = vi.fn()
    const variableController = {
      ...controller,
      report: {
        ...controller.report,
        snapshot: {
          ...controller.report?.snapshot,
          variables: [
            {
              schemaVersion: 0,
              id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3292"),
              name: "spacing",
              expression: "12 mm",
            },
          ],
        },
      },
    } as unknown as DocumentControllerState
    renderViewport({
      controller: variableController,
      draft: fixture,
      editorTool: "transform",
      onDraftChange,
      selectedEntityIds: [line.id],
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })

    fireEvent.change(screen.getByRole("combobox", { name: "Translation X" }), {
      target: { value: "#spacing" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Apply transform" }))

    await waitFor(() => expect(onDraftChange).toHaveBeenCalledOnce())
    expect(onDraftChange.mock.calls[0]?.[1]).toBe("record")
    const nextDraft = onDraftChange.mock.calls[0]?.[0] as SketchRecord
    expect(nextDraft.entities.find(({ id }) => id === line.startPointId)).toMatchObject({ x: 2 })
    expect(nextDraft.entities.find(({ id }) => id === line.endPointId)).toMatchObject({ x: 22 })
  })

  it("previews and applies a linear sketch pattern as one recorded edit", async () => {
    const fixture = lineSketchFixture("b25e", [{ start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }])
    const line = fixture.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The linear-pattern fixture must contain a line.")
    const onDraftChange = vi.fn()
    const onEditorToolChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "linear-pattern",
      onDraftChange,
      onEditorToolChange,
      selectedEntityIds: [line.id],
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })

    expect(screen.getByRole("form", { name: "Linear pattern" })).toBeTruthy()
    expect(
      document.querySelectorAll(
        "[data-sketch-linear-pattern-preview] > [data-sketch-transform-preview]",
      ),
    ).toHaveLength(2)
    fireEvent.change(screen.getByRole("combobox", { name: "First count" }), {
      target: { value: "4" },
    })
    await waitFor(() =>
      expect(
        document.querySelectorAll(
          "[data-sketch-linear-pattern-preview] > [data-sketch-transform-preview]",
        ),
      ).toHaveLength(3),
    )
    fireEvent.click(screen.getByRole("button", { name: "Apply linear pattern" }))

    await waitFor(() => expect(onDraftChange).toHaveBeenCalledOnce())
    expect(onDraftChange.mock.calls[0]?.[1]).toBe("record")
    const nextDraft = onDraftChange.mock.calls[0]?.[0] as SketchRecord
    expect(nextDraft.entities.filter(({ type }) => type === "line")).toHaveLength(4)
    expect(onEditorToolChange).toHaveBeenCalledWith("select")
  })

  it("previews and applies a center-based circular sketch pattern as one recorded edit", async () => {
    const fixture = lineSketchFixture("b25f", [{ start: { x: 10, y: 0 }, end: { x: 20, y: 0 } }])
    const line = fixture.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The circular-pattern fixture must contain a line.")
    const onDraftChange = vi.fn()
    const onEditorToolChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "circular-pattern",
      onDraftChange,
      onEditorToolChange,
      selectedEntityIds: [line.id],
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })

    expect(screen.getByRole("form", { name: "Circular pattern" })).toBeTruthy()
    expect(
      document.querySelectorAll(
        "[data-sketch-circular-pattern-preview] > [data-sketch-transform-preview]",
      ),
    ).toHaveLength(2)
    fireEvent.change(screen.getByRole("combobox", { name: "Instance count" }), {
      target: { value: "4" },
    })
    await waitFor(() =>
      expect(
        document.querySelectorAll(
          "[data-sketch-circular-pattern-preview] > [data-sketch-transform-preview]",
        ),
      ).toHaveLength(3),
    )
    fireEvent.click(screen.getByRole("button", { name: "Apply circular pattern" }))

    await waitFor(() => expect(onDraftChange).toHaveBeenCalledOnce())
    expect(onDraftChange.mock.calls[0]?.[1]).toBe("record")
    const nextDraft = onDraftChange.mock.calls[0]?.[0] as SketchRecord
    expect(nextDraft.entities.filter(({ type }) => type === "line")).toHaveLength(4)
    expect(onEditorToolChange).toHaveBeenCalledWith("select")
  })

  it("splits a circle after two curve clicks with an analytical preview", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const fixture = appendSketchCircle(emptySketch, {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createEntityId: sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b254"),
      perimeterPoint: { x: 5, y: 0 },
    }).sketch
    const circle = fixture.entities.find((entity) => entity.type === "circle")
    if (!circle) throw new Error("The circle split fixture must contain a circle.")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "split",
      onDraftChange,
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const circleElement = document.querySelector(`[data-sketch-entity-id="${circle.id}"]`)
    if (!circleElement) throw new Error("The circle split target must be rendered.")

    fireEvent.pointerDown(circleElement, { clientX: 420, clientY: 300 })
    expect(onDraftChange).not.toHaveBeenCalled()
    expect(document.querySelector('[data-sketch-preview-tool="split-circle-second"]')).toBeTruthy()

    fireEvent.pointerDown(circleElement, { clientX: 400, clientY: 280 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const nextDraft = onDraftChange.mock.calls[0]?.[0]
    expect(
      nextDraft.entities.filter(({ type }: { type: string }) => type === "circle"),
    ).toHaveLength(0)
    expect(nextDraft.entities.filter(({ type }: { type: string }) => type === "arc")).toHaveLength(
      2,
    )
  })

  it("splits an ellipse after two curve clicks with complementary analytical previews", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const fixture = appendSketchEllipse(emptySketch, {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createEntityId: sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b25e"),
      primaryAxisPoint: { kind: "new", point: { x: 10, y: 0 } },
      secondaryRadiusPoint: { x: 0, y: 5 },
    }).sketch
    const ellipse = fixture.entities.find((entity) => entity.type === "ellipse")
    if (!ellipse) throw new Error("The ellipse split fixture must contain an ellipse.")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "split",
      onDraftChange,
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const ellipseElement = document.querySelector(`[data-sketch-entity-id="${ellipse.id}"]`)
    if (!ellipseElement) throw new Error("The ellipse split target must be rendered.")

    fireEvent.pointerDown(ellipseElement, { clientX: 440, clientY: 300 })
    expect(onDraftChange).not.toHaveBeenCalled()
    const preview = document.querySelector('[data-sketch-preview-tool="split-ellipse-second"]')
    expect(preview?.querySelectorAll("polyline")).toHaveLength(2)

    fireEvent.pointerDown(ellipseElement, { clientX: 400, clientY: 260 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const nextDraft = onDraftChange.mock.calls[0]?.[0]
    expect(
      nextDraft.entities.filter(({ type }: { type: string }) => type === "ellipse"),
    ).toHaveLength(0)
    expect(
      nextDraft.entities.filter(({ type }: { type: string }) => type === "elliptical-arc"),
    ).toHaveLength(2)
  })

  it("trims a clicked arc between neighboring line boundaries", () => {
    const createEntityId = sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b255")
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const arcFixture = appendSketchArc(emptySketch, {
      center: { x: 0, y: 0 },
      createEntityId,
      start: { x: 5, y: 0 },
      end: { x: -5, y: 0 },
    }).sketch
    const arc = arcFixture.entities.find((entity) => entity.type === "arc")
    if (!arc) throw new Error("The arc trim fixture must contain an arc.")
    const firstBoundary = appendSketchLine(arcFixture, {
      createEntityId,
      start: { kind: "new", point: { x: 3, y: 0 } },
      end: { kind: "new", point: { x: 3, y: 6 } },
    }).sketch
    const fixture = appendSketchLine(firstBoundary, {
      createEntityId,
      start: { kind: "new", point: { x: -3, y: 0 } },
      end: { kind: "new", point: { x: -3, y: 6 } },
    }).sketch
    const onDraftChange = vi.fn()
    renderViewport({
      draft: fixture,
      editorTool: "trim",
      onDraftChange,
      sketch: fixture,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const arcElement = document.querySelector(`[data-sketch-entity-id="${arc.id}"]`)
    if (!arcElement) throw new Error("The arc trim target must be rendered.")

    fireEvent.pointerDown(arcElement, { clientX: 400, clientY: 280 })

    expect(onDraftChange).toHaveBeenCalledOnce()
    const nextDraft = onDraftChange.mock.calls[0]?.[0]
    expect(nextDraft.entities.filter(({ type }: { type: string }) => type === "arc")).toHaveLength(
      2,
    )
    expect(
      nextDraft.constraints.filter(({ type }: { type: string }) => type === "point-on-line"),
    ).toHaveLength(2)
  })

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

  it("creates a circumscribed polygon from center, radius, and typed side count", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "circumscribed-polygon",
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
      document.querySelector('[data-sketch-preview-tool="regular-polygon-radius"]'),
    ).toBeTruthy()
    expect(document.querySelector('[data-sketch-polygon-preview="circumscribed"]')).toBeTruthy()
    fireEvent.pointerDown(drawing, { clientX: 560, clientY: 300 })
    expect(
      document.querySelector('[data-sketch-preview-tool="regular-polygon-sides"]'),
    ).toBeTruthy()
    expect(document.querySelector('[data-sketch-polygon-side-count="6"]')).toBeTruthy()
    fireEvent.pointerMove(drawing, { clientX: 640, clientY: 300 })
    const pointerSideCount = Number(
      document
        .querySelector("[data-sketch-polygon-side-count]")
        ?.getAttribute("data-sketch-polygon-side-count"),
    )
    expect(pointerSideCount).toBeGreaterThan(6)

    fireEvent.keyDown(drawing, { key: "8" })
    expect(document.querySelector('[data-sketch-polygon-side-count="8"]')?.textContent).toBe("8")
    fireEvent.keyDown(drawing, { key: "Enter" })

    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(8)
    expect(draft.entities.filter(({ type }: { type: string }) => type === "circle")).toEqual([
      expect.objectContaining({ construction: true }),
    ])
    expect(draft.constraints.filter(({ type }: { type: string }) => type === "equal")).toHaveLength(
      7,
    )
  })

  it("keeps invalid inscribed polygon side input pending and commits one valid edit", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "inscribed-polygon",
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
    fireEvent.pointerDown(drawing, { clientX: 560, clientY: 300 })
    expect(document.querySelector('[data-sketch-polygon-preview="inscribed"]')).toBeTruthy()

    fireEvent.keyDown(drawing, { key: "2" })
    fireEvent.keyDown(drawing, { key: "Enter" })
    expect(onDraftChange).not.toHaveBeenCalled()
    expect(
      document.querySelector('[data-sketch-preview-tool="regular-polygon-sides"]'),
    ).toBeTruthy()
    fireEvent.keyDown(drawing, { key: "Backspace" })
    fireEvent.keyDown(drawing, { key: "4" })
    fireEvent.keyDown(drawing, { key: "Enter" })

    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0]
    expect(draft.entities.filter(({ type }: { type: string }) => type === "line")).toHaveLength(4)
    expect(
      draft.constraints.filter(({ type }: { type: string }) => type === "midpoint"),
    ).toHaveLength(4)
    expect(draft.constraints.filter(({ type }: { type: string }) => type === "equal")).toHaveLength(
      3,
    )
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

  it("previews and creates an exact center-point ellipse as one draft edit", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "ellipse",
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
    fireEvent.pointerDown(drawing, { clientX: 600, clientY: 300 })
    fireEvent.pointerMove(drawing, { clientX: 400, clientY: 100 })
    const preview = document.querySelector('[data-sketch-preview-tool="ellipse-secondary"]')
    expect(preview?.querySelector("ellipse")).toBeTruthy()
    expect(preview?.querySelectorAll("line")).toHaveLength(2)
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(drawing, { clientX: 400, clientY: 100 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0] as SketchRecord
    const ellipse = requiredSketchEntity(draft, "ellipse")
    expect(sketchEntitiesOfType(draft, "point")).toHaveLength(3)
    expect(draft.constraints).toHaveLength(0)
    const center = requiredSketchEntity(draft, "point", ellipse.centerPointId)
    const primary = requiredSketchEntity(draft, "point", ellipse.primaryAxisPointId)
    const secondary = requiredSketchEntity(draft, "point", ellipse.secondaryAxisPointId)
    const primaryVector = { x: primary.x - center.x, y: primary.y - center.y }
    const secondaryVector = { x: secondary.x - center.x, y: secondary.y - center.y }
    expect(primaryVector.x * secondaryVector.x + primaryVector.y * secondaryVector.y).toBeCloseTo(0)
    expect(Math.hypot(primaryVector.x, primaryVector.y)).toBeGreaterThan(0)
    expect(Math.hypot(secondaryVector.x, secondaryVector.y)).toBeGreaterThan(0)

    cleanup()
    renderViewport({
      draft,
      editorTool: "select",
      sketch: draft,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const rendered = document.querySelector(
      `[data-sketch-entity-id="${ellipse.id}"][data-sketch-entity-type="ellipse"]`,
    )
    expect(rendered?.tagName.toLowerCase()).toBe("ellipse")
    expect(rendered?.getAttribute("transform")).toContain("rotate(")
  })

  it("previews and creates an exact elliptical arc with the four-pick workflow", () => {
    const emptySketch = { ...sketch, entities: [], constraints: [] }
    const onDraftChange = vi.fn()
    renderViewport({
      draft: emptySketch,
      editorTool: "elliptical-arc",
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
    fireEvent.pointerDown(drawing, { clientX: 600, clientY: 300 })
    fireEvent.pointerMove(drawing, { clientX: 500, clientY: 200 })
    expect(
      document.querySelector('[data-sketch-preview-tool="elliptical-arc-start"] ellipse'),
    ).toBeTruthy()

    fireEvent.pointerDown(drawing, { clientX: 500, clientY: 200 })
    fireEvent.pointerMove(drawing, { clientX: 200, clientY: 300 })
    const arcPreview = document.querySelector('[data-sketch-preview-tool="elliptical-arc-end"]')
    expect(arcPreview?.querySelector("ellipse")).toBeTruthy()
    expect(arcPreview?.querySelector("polyline")).toBeTruthy()
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(drawing, { clientX: 200, clientY: 300 })
    expect(onDraftChange).toHaveBeenCalledOnce()
    const draft = onDraftChange.mock.calls[0]?.[0] as SketchRecord
    const ellipticalArc = requiredSketchEntity(draft, "elliptical-arc")
    expect(sketchEntitiesOfType(draft, "point")).toHaveLength(5)
    expect(draft.constraints).toHaveLength(0)

    cleanup()
    renderViewport({
      draft,
      editorTool: "select",
      sketch: draft,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const rendered = document.querySelector(
      `[data-sketch-entity-id="${ellipticalArc.id}"][data-sketch-entity-type="elliptical-arc"]`,
    )
    expect(rendered?.tagName.toLowerCase()).toBe("polyline")
    expect(rendered?.getAttribute("points")?.split(" ").length).toBeGreaterThan(8)
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

  it("edits an existing dimension in place without replacing its identity", async () => {
    const dimensionConstraint = sketch.constraints.find((constraint) => "value" in constraint)
    if (!dimensionConstraint) throw new Error("The rectangle fixture must contain a dimension.")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: sketch,
      sketch,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
      onDraftChange,
    })
    const dimension = document.querySelector(
      `[data-sketch-constraint-id="${dimensionConstraint.id}"]`,
    )
    if (!dimension) throw new Error("The dimension annotation must be rendered.")

    fireEvent.doubleClick(dimension)
    const expression = screen.getByRole("combobox", { name: "Driving dimension expression" })
    fireEvent.change(expression, { target: { value: "44 mm" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply dimension" }))

    await waitFor(() =>
      expect(onDraftChange).toHaveBeenCalledWith(
        expect.objectContaining({
          constraints: expect.arrayContaining([
            expect.objectContaining({
              id: dimensionConstraint.id,
              value: expect.objectContaining({ value: 44 }),
            }),
          ]),
        }),
      ),
    )
  })

  it("offers icon-only precision tools for the current sketch selection", () => {
    const selectedLine = sketch.entities.find((entity) => entity.type === "line")
    if (!selectedLine) throw new Error("The rectangle fixture must contain a line.")
    const onDraftChange = vi.fn()
    const onEditorToolChange = vi.fn()
    renderViewport({
      draft: sketch,
      sketch,
      selectedEntityIds: [selectedLine.id],
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
      onDraftChange,
      onEditorToolChange,
    })

    expect(screen.getByRole("toolbar", { name: "Sketch precision tools" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Horizontal" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Vertical" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Add drawing dimension" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Add drawing dimension" }))
    expect(onEditorToolChange).toHaveBeenCalledWith("dimension")
    fireEvent.click(screen.getByRole("button", { name: "Vertical" }))
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.arrayContaining([
          expect.objectContaining({ type: "vertical", lineId: selectedLine.id }),
        ]),
      }),
    )
  })

  it("collects compatible geometry through the first-class Dimension tool", () => {
    const selectedLine = requiredSketchEntity(sketch, "line")
    const onSelectionChange = vi.fn()
    const view = renderViewport({
      draft: sketch,
      editorTool: "dimension",
      sketch,
      selectedEntityIds: [selectedLine.id],
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
      onSelectionChange,
    })

    expect(
      screen.getByText("Dimension · Move the pointer to place the annotation, then click."),
    ).toBeTruthy()
    expect(screen.queryByRole("toolbar", { name: "Sketch precision tools" })).toBeNull()

    const otherLine = sketch.entities.find(
      (entity) => entity.type === "line" && entity.id !== selectedLine.id,
    )
    if (!otherLine) throw new Error("The rectangle fixture must contain another line.")
    const target = view.container.querySelector(`[data-sketch-entity-id="${otherLine.id}"]`)
    if (!target) throw new Error("Dimension mode must expose sketch geometry selection targets.")
    fireEvent.pointerDown(target)
    expect(onSelectionChange).toHaveBeenCalledWith([selectedLine.id, otherLine.id])
  })

  it("places and commits a driving dimension without focusing the task panel", async () => {
    const selectedLine = requiredSketchEntity(sketch, "line")
    const onDraftChange = vi.fn()
    renderViewport({
      draft: sketch,
      editorTool: "dimension",
      sketch,
      selectedEntityIds: [selectedLine.id],
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

    fireEvent.pointerMove(drawing, { clientX: 520, clientY: 240 })
    fireEvent.pointerDown(drawing, { button: 0, clientX: 520, clientY: 240 })

    expect(document.querySelector("[data-sketch-dimension-placement-preview]")).toBeTruthy()
    expect(screen.getByRole("form", { name: "Dimension value" })).toBeTruthy()
    const expression = screen.getByRole("combobox", { name: "Driving dimension expression" })
    fireEvent.change(expression, { target: { value: "42 mm" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply dimension" }))

    await waitFor(() =>
      expect(onDraftChange).toHaveBeenCalledWith(
        expect.objectContaining({
          constraints: expect.arrayContaining([
            expect.objectContaining({
              type: "distance",
              firstPointId: selectedLine.startPointId,
              secondPointId: selectedLine.endPointId,
            }),
          ]),
        }),
      ),
    )
  })

  it("cancels dimension input, collected geometry, and the tool in separate Escape stages", () => {
    const selectedLine = requiredSketchEntity(sketch, "line")
    const onEditorToolChange = vi.fn()
    const onSelectionChange = vi.fn()
    const view = renderViewport({
      draft: sketch,
      editorTool: "dimension",
      sketch,
      selectedEntityIds: [selectedLine.id],
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
      onEditorToolChange,
      onSelectionChange,
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
    fireEvent.pointerMove(drawing, { clientX: 520, clientY: 240 })
    fireEvent.pointerDown(drawing, { button: 0, clientX: 520, clientY: 240 })

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Driving dimension expression" }), {
      key: "Escape",
    })
    expect(screen.queryByRole("form", { name: "Dimension value" })).toBeNull()
    expect(onSelectionChange).not.toHaveBeenCalled()

    fireEvent.keyDown(drawing, { key: "Escape" })
    expect(onSelectionChange).toHaveBeenCalledWith([])
    view.rerender(
      viewportElement({
        draft: sketch,
        editorTool: "dimension",
        sketch,
        selectedEntityIds: [],
        solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
        onEditorToolChange,
        onSelectionChange,
      }),
    )
    fireEvent.keyDown(screen.getByRole("img", { name: "Editable sketch geometry" }), {
      key: "Escape",
    })
    expect(onEditorToolChange).toHaveBeenCalledWith("select")
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

  it("keeps drag frames local, streams bounded exact feedback, and commits the final point", async () => {
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
    const readViewportRectangle = vi.spyOn(drawing, "getBoundingClientRect").mockReturnValue({
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
    expect(readViewportRectangle).toHaveBeenCalledOnce()
    fireEvent.pointerMove(drawing, { clientX: 500, clientY: 240, pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180, pointerId: 1 })

    expect(onDraftChange).not.toHaveBeenCalled()
    expect(readViewportRectangle).toHaveBeenCalledOnce()
    const frame = frames.shift()
    if (!frame) throw new Error("The point drag must schedule an animation frame.")
    act(() => frame(0))
    expect(readViewportRectangle).toHaveBeenCalledOnce()
    expect(onDraftChange).not.toHaveBeenCalled()
    expect(
      document.querySelector(`[data-sketch-entity-id="${firstPoint.id}"]`)?.getAttribute("cx"),
    ).toBe("65")
    expect(
      document.querySelector(`[data-sketch-entity-id="${firstPoint.id}"]`)?.getAttribute("cy"),
    ).toBe("36")
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 20)))
    expect(solveSketch).toHaveBeenCalledTimes(1)
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 30)))
    expect(solveSketch).toHaveBeenCalledTimes(2)
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180, pointerId: 1 })
    const continuingFrame = frames.shift()
    if (!continuingFrame) throw new Error("Continued movement must schedule another drag frame.")
    act(() => continuingFrame(50))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 50)))
    expect(solveSketch).toHaveBeenCalledTimes(2)
    expect(solveSketch).toHaveBeenLastCalledWith(
      7,
      sketch,
      expect.objectContaining({
        draggedPoints: [expect.objectContaining({ entityId: firstPoint.id, x: 65, y: 36 })],
      }),
    )

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

  it("defers dense exact feedback until the pointer pauses", async () => {
    const denseSketch = denseRectangleSketchFixture()
    const solveSketch = vi.fn(async () => solveResult())
    const onDraftChange = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    renderViewport({
      controller: {
        ...controller,
        report: {
          snapshot: { revision: 7, sketches: [denseSketch] },
          rebuild: { ok: true },
        },
      } as unknown as DocumentControllerState,
      draft: denseSketch,
      sketch: denseSketch,
      solveSketch,
      onDraftChange,
    })
    await screen.findByText("Fully constrained")
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const draggedPoint = denseSketch.entities.find((entity) => entity.type === "point")
    if (!draggedPoint) throw new Error("The dense sketch fixture must contain a point.")
    const pointElement = document.querySelector(`[data-sketch-entity-id="${draggedPoint.id}"]`)
    if (!pointElement) throw new Error("The dense sketch point must be rendered.")

    fireEvent.pointerDown(pointElement, { pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180, pointerId: 1 })
    const frame = frames.shift()
    if (!frame) throw new Error("The dense point drag must schedule an animation frame.")
    act(() => frame(0))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 80)))

    fireEvent.pointerMove(drawing, { clientX: 620, clientY: 160, pointerId: 1 })
    const continuedFrame = frames.shift()
    if (!continuedFrame) throw new Error("Continued dense dragging must schedule another frame.")
    act(() => continuedFrame(80))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 80)))

    expect(solveSketch).toHaveBeenCalledOnce()
    expect(onDraftChange).not.toHaveBeenCalled()

    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 60)))

    expect(solveSketch).toHaveBeenCalledTimes(2)
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(drawing, { pointerId: 1 })

    expect(onDraftChange).toHaveBeenCalledOnce()
    await waitFor(() => expect(solveSketch).toHaveBeenCalledTimes(2))
  })

  it("keeps very dense point dragging local until release", async () => {
    const denseSketch = denseRectangleSketchFixture(48)
    const solveSketch = vi.fn(async () => solveResult())
    const onDraftChange = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    renderViewport({
      controller: {
        ...controller,
        report: {
          snapshot: { revision: 7, sketches: [denseSketch] },
          rebuild: { ok: true },
        },
      } as unknown as DocumentControllerState,
      draft: denseSketch,
      sketch: denseSketch,
      solveSketch,
      onDraftChange,
    })
    await screen.findByText("Fully constrained")
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const draggedPoint = denseSketch.entities.find((entity) => entity.type === "point")
    if (!draggedPoint) throw new Error("The very dense sketch fixture must contain a point.")
    const pointElement = document.querySelector(`[data-sketch-entity-id="${draggedPoint.id}"]`)
    if (!pointElement) throw new Error("The very dense sketch point must be rendered.")

    fireEvent.pointerDown(pointElement, { pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180, pointerId: 1 })
    const frame = frames.shift()
    if (!frame) throw new Error("The very dense point drag must schedule an animation frame.")
    act(() => frame(0))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 180)))

    expect(solveSketch).toHaveBeenCalledOnce()
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(drawing, { pointerId: 1 })

    expect(onDraftChange).toHaveBeenCalledOnce()
  })

  it("reuses the prewarmed inference index across incremental zoom and point drag", () => {
    const denseSketch = denseRectangleSketchFixture()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    renderViewport({
      draft: denseSketch,
      sketch: denseSketch,
      solveSketch: vi.fn(() => new Promise<ActiveSketchSolveResult>(() => undefined)),
    })
    const drawing = screen.getByRole("img", { name: "Editable sketch geometry" })
    mockDrawingRectangle(drawing)
    const draggedPoint = denseSketch.entities.find((entity) => entity.type === "point")
    if (!draggedPoint) throw new Error("The dense sketch fixture must contain a point.")
    const pointSelector = `[data-sketch-entity-id="${draggedPoint.id}"]`
    const pointElement = document.querySelector(pointSelector)
    if (!pointElement) throw new Error("The dense sketch point must be rendered.")
    const buildsBeforeDrag = sketchInferenceIndexBuilds.mock.calls.length

    fireEvent.wheel(drawing, { clientX: 400, clientY: 300, deltaY: 10 })
    fireEvent.pointerDown(pointElement, { pointerId: 1 })
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180, pointerId: 1 })
    const frame = frames.shift()
    if (!frame) throw new Error("The point drag must schedule an animation frame.")
    act(() => frame(0))

    expect(buildsBeforeDrag).toBeGreaterThan(0)
    expect(sketchInferenceIndexBuilds).toHaveBeenCalledTimes(buildsBeforeDrag)
  })

  it("limits drag-frame rendering to the point and its incident curves", async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const lines = sketch.entities.filter((entity) => entity.type === "line")
    const draggedPoint = pointEntities[0]
    if (!draggedPoint) throw new Error("The rectangle fixture must contain a point.")
    const incidentLines = lines.filter(
      (line) => line.startPointId === draggedPoint.id || line.endPointId === draggedPoint.id,
    )
    const unrelatedLine = lines.find(
      (line) => line.startPointId !== draggedPoint.id && line.endPointId !== draggedPoint.id,
    )
    if (!unrelatedLine) throw new Error("The rectangle fixture must contain an unrelated line.")
    const unrelatedStartPointId = unrelatedLine.startPointId
    let unrelatedLineReads = 0
    const trackedUnrelatedLine = { ...unrelatedLine }
    Object.defineProperty(trackedUnrelatedLine, "startPointId", {
      configurable: true,
      enumerable: true,
      get: () => {
        unrelatedLineReads += 1
        return unrelatedStartPointId
      },
    })
    const trackedSketch = {
      ...sketch,
      entities: sketch.entities.map((entity) =>
        entity.id === unrelatedLine.id ? trackedUnrelatedLine : entity,
      ),
    }
    renderViewport({
      draft: trackedSketch,
      sketch: trackedSketch,
      solveSketch: vi.fn(async () => solveResult()),
    })
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
    const pointElement = document.querySelector(`[data-sketch-entity-id="${draggedPoint.id}"]`)
    const unrelatedElement = document.querySelector(`[data-sketch-entity-id="${unrelatedLine.id}"]`)
    if (!pointElement || !unrelatedElement) {
      throw new Error("The rectangle geometry must be rendered.")
    }

    fireEvent.pointerDown(pointElement, { pointerId: 1 })
    const readsAfterDragStart = unrelatedLineReads
    fireEvent.pointerMove(drawing, { clientX: 600, clientY: 180, pointerId: 1 })
    const frame = frames.shift()
    if (!frame) throw new Error("The point drag must schedule an animation frame.")
    act(() => frame(0))

    const overlay = document.querySelector(`[data-sketch-drag-overlay="${draggedPoint.id}"]`)
    expect(overlay).toBeTruthy()
    expect(overlay?.querySelectorAll("line")).toHaveLength(incidentLines.length)
    expect(drawing.querySelectorAll('[data-sketch-entity-type="line"]')).toHaveLength(lines.length)
    expect(
      incidentLines.every(
        ({ id }) =>
          document.querySelector(`[data-sketch-entity-id="${id}"]`)?.getAttribute("opacity") ===
          "0",
      ),
    ).toBe(true)
    expect(document.querySelector(`[data-sketch-entity-id="${unrelatedLine.id}"]`)).toBe(
      unrelatedElement,
    )
    expect(unrelatedElement.getAttribute("opacity")).toBeNull()
    expect(unrelatedLineReads).toBe(readsAfterDragStart)
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

  it("shows changed authored geometry immediately and resets stale solver continuation", async () => {
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
    expect(document.querySelector(pointSelector)?.getAttribute("cx")).toBe("80")
    await waitFor(() => expect(solveSketch).toHaveBeenCalledTimes(2))
    expect(solveSketch.mock.calls[1]?.[2]?.continuation).toBeNull()
    await act(async () => {
      resolveChangedDraft?.(solveResult(new Map([[firstPoint.id, { x: 12, y: 8 }]])))
    })
    await waitFor(() =>
      expect(document.querySelector(pointSelector)?.getAttribute("cx")).toBe("12"),
    )
  })
})
