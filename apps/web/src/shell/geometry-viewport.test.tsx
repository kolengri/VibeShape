// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import {
  boxFeatureType,
  createLengthQuantity,
  datumPlaneFeatureType,
  type SketchProfileSelector,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import type {
  GeometryViewportOptions,
  GeometryViewport as GeometryViewportPort,
  ViewerSelection,
} from "@vibeshape/viewer"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../document/document-controller"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import { createSketchProjectionStore } from "../features/sketch/sketch-projection-store"
import { i18n } from "../i18n"
import {
  GeometryViewport,
  type GeometryViewportSketchContext,
  viewerMeshes,
  viewerSketchDisplay,
  viewerSketches,
  withActiveSketchDisplay,
} from "./geometry-viewport"

const { saveActiveProjectThumbnailMock } = vi.hoisted(() => ({
  saveActiveProjectThumbnailMock: vi.fn(),
}))

vi.mock("../document/document-controller", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../document/document-controller")>()
  return { ...actual, saveActiveProjectThumbnail: saveActiveProjectThumbnailMock }
})

const boxId = "0195b5ac-b220-7a2c-8c33-67a36a7f2602"
const booleanId = "0195b5ac-b220-7a2c-8c33-67a36a7f2603"
const datumId = "0195b5ac-b220-7a2c-8c33-67a36a7f2604"
const mesh = {
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 20, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
}
const sketchDisplay: SketchDisplayRecord = {
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f2605",
  frame: {
    origin: [0, 0, 0] as const,
    xAxis: [1, 0, 0] as const,
    yAxis: [0, 1, 0] as const,
    normal: [0, 0, 1] as const,
  },
  profiles: [],
  curvePositions: new Float32Array([0, 0, 0, 20, 0, 0]),
  constructionCurvePositions: new Float32Array(),
  pointPositions: new Float32Array([0, 0, 0, 20, 0, 0]),
  constructionPointPositions: new Float32Array(),
}

const firstProfileBoundaryId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2611")
const secondProfileBoundaryId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2612")
const thirdProfileBoundaryId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2613")
const fourthProfileBoundaryId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2614")
const profileBoundaryIds = [
  firstProfileBoundaryId,
  secondProfileBoundaryId,
  thirdProfileBoundaryId,
  fourthProfileBoundaryId,
]
const profileSelector: SketchProfileSelector = {
  schemaVersion: 0,
  sketchId: sketchIdSchema.parse(sketchDisplay.sketchId),
  outerBoundaryEntityIds: profileBoundaryIds,
  holeBoundaryEntityIds: [],
}
const profileSketchDisplay: SketchDisplayRecord = {
  ...sketchDisplay,
  profiles: [
    {
      selector: profileSelector,
      outerLoop: {
        segments: [
          {
            entityId: firstProfileBoundaryId,
            type: "line",
            reversed: false,
            samples: [
              [0, 0],
              [10, 0],
            ],
          },
          {
            entityId: secondProfileBoundaryId,
            type: "line",
            reversed: false,
            samples: [
              [10, 0],
              [10, 10],
            ],
          },
          {
            entityId: thirdProfileBoundaryId,
            type: "line",
            reversed: false,
            samples: [
              [10, 10],
              [0, 10],
            ],
          },
          {
            entityId: fourthProfileBoundaryId,
            type: "line",
            reversed: false,
            samples: [
              [0, 10],
              [0, 0],
            ],
          },
        ],
      },
      holeLoops: [],
    },
  ],
}
const secondProfileSketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2620")
const secondProfileSelector: SketchProfileSelector = {
  ...profileSelector,
  sketchId: secondProfileSketchId,
}
const secondProfileSketchDisplay: SketchDisplayRecord = {
  ...profileSketchDisplay,
  sketchId: secondProfileSketchId,
  profiles: profileSketchDisplay.profiles.map((profile) => ({
    ...profile,
    selector: secondProfileSelector,
  })),
}

function planarFaceCandidate(
  candidateId: string,
  meshFaceId: number,
  semanticRole: string,
  centroid: readonly [number, number, number],
) {
  return {
    candidateId,
    kind: "face" as const,
    lineageTokens: [],
    meshFaceId,
    referenceGeometry: { kind: "plane-face" as const, normal: [0, 0, 1] as const },
    semanticRole,
    signature: {
      adjacentGeometryClasses: [],
      boundaryCount: 4,
      bounds: { min: centroid, max: centroid },
      centroid,
      direction: [0, 0, 1] as const,
      directionMode: "oriented" as const,
      geometryClass: "PLANE" as const,
      kind: "face" as const,
      measure: 100,
    },
  }
}

function readyController(
  features: readonly { id: string; dependencies: readonly string[]; label?: string }[],
  geometry: readonly {
    featureId: string
    geometry: {
      mesh: typeof mesh
      topologyCandidates?: readonly ReturnType<typeof planarFaceCandidate>[]
    }
  }[],
  sketches: readonly SketchDisplayRecord[] = [],
) {
  return {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      snapshot: {
        features: features.map((feature) => ({
          type: boxFeatureType.type,
          parameters: {},
          references: [],
          suppressed: false,
          ...feature,
        })),
        sketches: sketches.map(({ sketchId }, index) => ({
          id: sketchId,
          label: `Sketch ${index + 1}`,
        })),
      },
      rebuild: { ok: true, response: { geometry, sketches } },
    },
  } as unknown as DocumentControllerState
}

function renderViewport(
  controller: DocumentControllerState,
  selection: ViewerSelection | null = null,
  originPlaneSelection?: Readonly<{
    mode: "create" | "replace"
    selectedPlane: "xy" | "xz" | "yz" | null
    onSelect: (plane: "xy" | "xz" | "yz") => void
  }>,
  featurePreview?: FeaturePreviewState,
  originPlaneVisibility?: Readonly<{
    visibility: { xy: boolean; xz: boolean; yz: boolean }
    onChange: (plane: "xy" | "xz" | "yz", visible: boolean) => void
  }>,
  featureHighlight?: Readonly<{
    preselectedFeatureId?: string
    selectedFeatureId?: string
  }>,
  sketchContext?: GeometryViewportSketchContext,
  idleOriginPlaneSelection?: Readonly<{
    selectedPlane: "xy" | "xz" | "yz" | null
    onSelect: (plane: "xy" | "xz" | "yz" | null) => void
  }>,
  sketchProfileSelection?: Readonly<{
    selectedProfiles: readonly SketchProfileSelector[]
    onSelect: (
      profile: SketchProfileSelector | null,
      profiles: readonly SketchProfileSelector[],
      intent: "replace" | "toggle",
    ) => void
  }>,
) {
  const port: GeometryViewportPort = {
    clearSketchProjection: vi.fn(),
    orientToFrame: vi.fn(() => true),
    setSketchProjection: vi.fn(() => true),
    setInteractionMode: vi.fn(),
    setFeaturePreselection: vi.fn(),
    setFeatureSelection: vi.fn(),
    setMeshes: vi.fn(),
    setSketchReferenceCandidates: vi.fn(),
    setSketchReferencePreselection: vi.fn(),
    setSketchProfilePreselection: vi.fn(),
    setSketchProfileSelection: vi.fn(),
    setSketchProfileSelections: vi.fn(),
    setSelectionCandidateStackPreserved: vi.fn(),
    setSelectionPreselection: vi.fn(),
    setSketches: vi.fn(),
    setOriginPlaneSelection: vi.fn(),
    setOriginPlaneVisibility: vi.fn(),
    fit: vi.fn(),
    clearSelection: vi.fn(),
    dispose: vi.fn(),
  }
  const onSelectionChange = vi.fn()
  const createViewport = vi.fn(
    (_canvas: HTMLCanvasElement, _options: GeometryViewportOptions) => port,
  )
  const element = (nextController: DocumentControllerState, nextSketchContext = sketchContext) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <GeometryViewport
          controller={nextController}
          createViewport={createViewport}
          selection={selection}
          onSelectionChange={onSelectionChange}
          {...(nextSketchContext ? { sketchContext: nextSketchContext } : {})}
          {...featureHighlight}
          {...(featurePreview ? { featurePreview } : {})}
          {...(originPlaneSelection ? { originPlaneSelection } : {})}
          {...(originPlaneVisibility ? { originPlaneVisibility } : {})}
          {...(idleOriginPlaneSelection ? { idleOriginPlaneSelection } : {})}
          {...(sketchProfileSelection ? { sketchProfileSelection } : {})}
        />
      </TooltipProvider>
    </I18nProvider>
  )
  const result = render(element(controller))
  return {
    ...result,
    createViewport,
    onSelectionChange,
    port,
    rerenderController: (nextController: DocumentControllerState) =>
      result.rerender(element(nextController)),
    rerenderSketchContext: (nextSketchContext?: GeometryViewportSketchContext) =>
      result.rerender(element(controller, nextSketchContext)),
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  saveActiveProjectThumbnailMock.mockReset()
  saveActiveProjectThumbnailMock.mockResolvedValue({ ok: true })
})

describe("GeometryViewport", () => {
  it("adapts bounded saved profile loops to one stable viewer region", () => {
    const [sketch] = viewerSketches(readyController([], [], [profileSketchDisplay]))

    expect(Array.from(sketch?.profiles?.[0]?.outerPositions ?? [])).toEqual([
      0, 0, 10, 0, 10, 10, 0, 10,
    ])
    expect(sketch?.profiles?.[0]?.selector).toEqual(profileSelector)
  })

  it("reports saved profile hover and selection through semantic selectors", async () => {
    const onSelect = vi.fn()
    const controller = readyController([], [], [profileSketchDisplay])
    const { createViewport, port } = renderViewport(
      controller,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [profileSelector], onSelect },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const renderedSketches = vi.mocked(port.setSketches).mock.calls.at(-1)?.[0] ?? []
    const profile = renderedSketches[0]?.profiles?.[0]
    expect(profile).toBeDefined()
    expect(port.setSketchProfileSelections).toHaveBeenCalledWith([profile])

    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onSketchProfilePreselectionChange?.(profile ?? null))
    expect(screen.getByRole("status").textContent).toContain("Select profile: Sketch 1 · Profile 1")

    act(() => options?.onSketchProfileSelectionChange?.(profile ?? null, "replace"))
    expect(onSelect).toHaveBeenCalledWith(profileSelector, [profileSelector], "replace")
  })

  it("renders every selected profile and forwards additive selection intent", async () => {
    const onSelect = vi.fn()
    const { createViewport, port } = renderViewport(
      readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [profileSelector, secondProfileSelector], onSelect },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const renderedProfiles =
      vi
        .mocked(port.setSketches)
        .mock.calls.at(-1)?.[0]
        .flatMap((sketch) => sketch.profiles ?? []) ?? []
    expect(port.setSketchProfileSelections).toHaveBeenCalledWith(renderedProfiles)
    act(() =>
      createViewport.mock.calls[0]?.[1].onSketchProfileSelectionChange?.(
        renderedProfiles[1] ?? null,
        "toggle",
      ),
    )
    expect(onSelect).toHaveBeenCalledWith(secondProfileSelector, [secondProfileSelector], "toggle")
  })

  it("offers a focusable model-mode control for every saved profile", async () => {
    const onSelect = vi.fn()
    renderViewport(
      readyController([], [], [profileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect },
    )

    const profilePicker = await screen.findByRole("combobox", {
      name: "Select saved profile",
    })
    const profileOption = screen.getByRole("option", { name: "Sketch 1 · Profile 1" })
    profilePicker.focus()
    expect(document.activeElement).toBe(profilePicker)
    fireEvent.change(profilePicker, { target: { value: profileOption.getAttribute("value") } })
    expect(onSelect).toHaveBeenCalledWith(profileSelector, [profileSelector], "replace")
  })

  it("keeps the maximum supported profile set in one compact native picker", async () => {
    const baseProfile = profileSketchDisplay.profiles[0]
    if (!baseProfile) throw new Error("The saved-profile fixture must contain one profile.")
    const profiles = Array.from({ length: 2_000 }, (_, index) => ({
      ...baseProfile,
      selector: {
        ...profileSelector,
        outerBoundaryEntityIds: [
          sketchEntityIdSchema.parse(
            `0195b5ac-b220-7a2c-8c33-${String(index + 3_000).padStart(12, "0")}`,
          ),
        ],
      },
    }))
    renderViewport(
      readyController([], [], [{ ...profileSketchDisplay, profiles }]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect: vi.fn() },
    )

    expect(await screen.findAllByRole("combobox", { name: "Select saved profile" })).toHaveLength(1)
    expect(screen.getAllByRole("option")).toHaveLength(2_001)
  })

  it("requires an explicit choice when saved profiles overlap", async () => {
    const onSelect = vi.fn()
    const { createViewport, port } = renderViewport(
      readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const profiles =
      vi
        .mocked(port.setSketches)
        .mock.calls.at(-1)?.[0]
        .flatMap((sketch) => sketch.profiles ?? []) ?? []
    expect(profiles).toHaveLength(2)

    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onSketchProfileCandidateStackCommit?.(profiles))
    const chooser = await screen.findByRole("listbox", { name: "Select profile" })
    expect(chooser.querySelectorAll('[role="option"]')).toHaveLength(2)
    fireEvent.keyDown(chooser, { key: "ArrowDown" })
    fireEvent.keyDown(chooser, { key: "Enter" })

    expect(onSelect).toHaveBeenCalledWith(secondProfileSelector, [secondProfileSelector], "replace")
    expect(port.setSketchProfileSelections).toHaveBeenCalledWith([profiles[1]])
  })

  it("dismisses an overlapping-profile chooser when rendered sketches change", async () => {
    const { createViewport, port, rerenderController } = renderViewport(
      readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect: vi.fn() },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const profiles =
      vi
        .mocked(port.setSketches)
        .mock.calls.at(-1)?.[0]
        .flatMap((sketch) => sketch.profiles ?? []) ?? []
    act(() => createViewport.mock.calls[0]?.[1].onSketchProfileCandidateStackCommit?.(profiles))
    await screen.findByRole("listbox", { name: "Select profile" })

    rerenderController(readyController([], [], [profileSketchDisplay]))
    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Select profile" })).toBeNull(),
    )
  })

  it("dismisses an overlapping-profile chooser after another canvas selection", async () => {
    const { createViewport, port } = renderViewport(
      readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect: vi.fn() },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const profiles =
      vi
        .mocked(port.setSketches)
        .mock.calls.at(-1)?.[0]
        .flatMap((sketch) => sketch.profiles ?? []) ?? []
    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onSketchProfileCandidateStackCommit?.(profiles))
    await screen.findByRole("listbox", { name: "Select profile" })

    act(() => options?.onSketchProfileSelectionChange?.(profiles[0] ?? null, "replace"))
    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Select profile" })).toBeNull(),
    )
  })

  it("replaces the committed sketch display with the active unsaved display", () => {
    const committedDisplay = viewerSketchDisplay(sketchDisplay)
    const activeDisplay = {
      ...committedDisplay,
      curvePositions: new Float32Array([5, 0, 0, 25, 0, 0]),
    }

    expect(withActiveSketchDisplay([committedDisplay], activeDisplay)).toEqual([activeDisplay])
    expect(withActiveSketchDisplay([committedDisplay], null)).toEqual([committedDisplay])
  })

  it("keeps the active 3D sketch display out of the normal 2D editor", () => {
    const committedDisplay = viewerSketchDisplay(sketchDisplay)
    const activeDisplay = {
      ...committedDisplay,
      curvePositions: new Float32Array([5, 0, 0, 25, 0, 0]),
    }

    expect(withActiveSketchDisplay([], activeDisplay, false)).toEqual([])
    expect(withActiveSketchDisplay([], activeDisplay, true)).toEqual([activeDisplay])
  })

  it("preserves the viewer and camera while passive context disables chrome and input", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const frame = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    } as const
    const { container, createViewport, port, rerenderSketchContext, unmount } =
      renderViewport(controller)
    await waitFor(() =>
      expect(port.setMeshes).toHaveBeenCalledWith([{ featureId: boxId, ...mesh }]),
    )
    expect(createViewport).toHaveBeenCalledOnce()
    expect(port.fit).toHaveBeenCalledOnce()

    rerenderSketchContext({
      frame,
      mode: "normal",
      referenceSelection: {
        candidates: [
          {
            kind: "model-point",
            label: "Box · Vertex 1",
            featureId: boxId,
            candidateId: "vertex-1",
            position: [0, 0, 0],
          },
        ],
        onSelect: vi.fn(),
      },
    })
    const viewport = container.querySelector<HTMLElement>("[data-passive='true']")
    expect(viewport).not.toBeNull()
    if (!viewport) return
    expect(viewport.getAttribute("data-passive")).toBe("true")
    expect(viewport.getAttribute("aria-hidden")).toBe("true")
    expect(viewport.className).toContain("pointer-events-none")
    expect(viewport.querySelector("canvas")).toBeTruthy()
    expect(screen.queryByRole("region", { name: "3D viewport" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Fit view" })).toBeNull()
    expect(screen.queryByRole("img", { name: "World axes" })).toBeNull()
    expect(screen.queryByText("XYZ · mm")).toBeNull()
    expect(createViewport).toHaveBeenCalledOnce()
    expect(port.fit).toHaveBeenCalledOnce()
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("camera-only")
    expect(port.setSketchReferenceCandidates).toHaveBeenLastCalledWith([])
    expect(port.orientToFrame).toHaveBeenCalledOnce()
    expect(port.orientToFrame).toHaveBeenCalledWith(frame)
    expect(port.dispose).not.toHaveBeenCalled()

    rerenderSketchContext({ frame, mode: "orbit" })
    const orbitViewport = container.querySelector<HTMLElement>("[data-sketch-context-mode='orbit']")
    expect(orbitViewport?.className).not.toContain("pointer-events-none")
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("camera-only")
    expect(port.orientToFrame).toHaveBeenCalledOnce()

    rerenderSketchContext({ frame, mode: "normal" })
    expect(port.orientToFrame).toHaveBeenCalledTimes(2)

    rerenderSketchContext()
    expect(screen.getByRole("region", { name: "3D viewport" })).toBeTruthy()
    expect(createViewport).toHaveBeenCalledOnce()
    expect(port.fit).toHaveBeenCalledOnce()
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("select")
    expect(port.dispose).not.toHaveBeenCalled()

    unmount()
    expect(port.dispose).toHaveBeenCalledOnce()
  })

  it("applies sketch projection updates imperatively without remounting the viewer", async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const frame = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    } as const
    const store = createSketchProjectionStore()
    const firstBounds = { minX: -100, minY: -75, width: 200, height: 150 }
    store.getState().publish({ frame, bounds: firstBounds })
    const { createViewport, port, rerenderSketchContext } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      { frame, mode: "normal", projectionStore: store },
    )

    await waitFor(() => expect(port.setSketchProjection).toHaveBeenCalledWith(frame, firstBounds))
    expect(createViewport).toHaveBeenCalledOnce()
    const referenceCandidateCalls = vi.mocked(port.setSketchReferenceCandidates).mock.calls.length
    const interactionModeCalls = vi.mocked(port.setInteractionMode).mock.calls.length
    const secondBounds = { minX: -50, minY: -40, width: 100, height: 80 }
    const latestBounds = { minX: -40, minY: -30, width: 80, height: 60 }
    act(() => store.getState().publish({ frame, bounds: secondBounds }))
    act(() => store.getState().publish({ frame, bounds: latestBounds }))
    expect(frames).toHaveLength(1)
    expect(port.setSketchProjection).toHaveBeenCalledOnce()
    const projectionFrame = frames.shift()
    if (!projectionFrame) throw new Error("The latest sketch projection must schedule a frame.")
    act(() => projectionFrame(0))
    expect(port.setSketchProjection).toHaveBeenLastCalledWith(frame, latestBounds)
    expect(port.setSketchReferenceCandidates).toHaveBeenCalledTimes(referenceCandidateCalls)
    expect(port.setInteractionMode).toHaveBeenCalledTimes(interactionModeCalls)

    rerenderSketchContext({ frame, mode: "orbit", projectionStore: store })
    expect(port.clearSketchProjection).toHaveBeenCalled()
    const callsBeforeOrbitUpdate = vi.mocked(port.setSketchProjection).mock.calls.length
    act(() => store.getState().publish({ frame, bounds: firstBounds }))
    expect(vi.mocked(port.setSketchProjection).mock.calls).toHaveLength(callsBeforeOrbitUpdate)

    rerenderSketchContext({ frame, mode: "normal", projectionStore: store })
    expect(port.setSketchProjection).toHaveBeenLastCalledWith(frame, firstBounds)
    expect(createViewport).toHaveBeenCalledOnce()
    expect(port.dispose).not.toHaveBeenCalled()
  })

  it("routes graphical sketch-reference hover and selection through the persistent 3D viewer", async () => {
    const candidate = {
      kind: "point" as const,
      label: "Source · Point",
      position: [2, 3, 0] as const,
      sourcePointId: "point-1",
      sourceSketchId: "sketch-1",
    }
    const lineCandidate = {
      kind: "line" as const,
      label: "Source · Line",
      start: [0, 0, 0] as const,
      end: [10, 0, 0] as const,
      sourceLineId: "line-1",
      sourceSketchId: "sketch-1",
    }
    const modelPointCandidate = {
      kind: "model-point" as const,
      label: "Box · Vertex 1",
      featureId: boxId,
      candidateId: "vertex-1",
      position: [2, 3, 4] as const,
    }
    const modelLineCandidate = {
      kind: "model-line" as const,
      label: "Box · Edge 1",
      featureId: boxId,
      candidateId: "edge-1",
      start: [0, 0, 0] as const,
      end: [10, 0, 0] as const,
    }
    const modelCurveCandidate = {
      kind: "model-curve" as const,
      label: "Cylinder · Circular edge 1",
      featureId: boxId,
      candidateId: "circle-1",
      points: [
        [5, 0, 0],
        [0, 5, 0],
        [-5, 0, 0],
        [0, -5, 0],
        [5, 0, 0],
      ] as const,
      sourceType: "circle" as const,
    }
    const onSelect = vi.fn()
    const controller = readyController([], [])
    const { createViewport, port } = renderViewport(
      controller,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        frame: null,
        mode: "orbit",
        referenceSelection: {
          candidates: [
            candidate,
            lineCandidate,
            modelPointCandidate,
            modelLineCandidate,
            modelCurveCandidate,
          ],
          onSelect,
        },
      },
    )

    await waitFor(() =>
      expect(port.setSketchReferenceCandidates).toHaveBeenCalledWith([
        candidate,
        lineCandidate,
        modelPointCandidate,
        modelLineCandidate,
        modelCurveCandidate,
      ]),
    )
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("sketch-reference-select")
    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onSketchReferencePreselectionChange?.(candidate))
    expect(screen.getByText("Use reference: Source · Point", { exact: true }).textContent).toBe(
      "Use reference: Source · Point",
    )

    act(() =>
      options?.onSketchReferenceCandidateStackChange?.([
        candidate,
        lineCandidate,
        modelPointCandidate,
      ]),
    )
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    const selectOther = screen.getByRole("listbox", { name: "Select other reference" })
    expect(document.activeElement).toBe(selectOther)
    expect(selectOther.getAttribute("aria-activedescendant")).toBe(
      "sketch-reference-select-other-0",
    )
    expect(
      screen.getByRole("option", { name: "1/3 Source · Point" }).getAttribute("aria-selected"),
    ).toBe("true")
    expect(port.setSketchReferencePreselection).toHaveBeenLastCalledWith(candidate)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    expect(
      screen.getByRole("option", { name: "2/3 Source · Line" }).getAttribute("aria-selected"),
    ).toBe("true")
    expect(selectOther.getAttribute("aria-activedescendant")).toBe(
      "sketch-reference-select-other-1",
    )
    expect(port.setSketchReferencePreselection).toHaveBeenLastCalledWith(lineCandidate)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`", shiftKey: true })
    expect(
      screen.getByRole("option", { name: "1/3 Source · Point" }).getAttribute("aria-selected"),
    ).toBe("true")
    fireEvent.keyDown(viewport, { key: "Enter" })
    expect(onSelect).toHaveBeenLastCalledWith(candidate)
    expect(screen.queryByRole("listbox", { name: "Select other reference" })).toBeNull()
    expect(document.activeElement).toBe(viewport)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    fireEvent.keyDown(viewport, { key: "Escape" })
    expect(screen.queryByRole("listbox", { name: "Select other reference" })).toBeNull()
    expect(port.setSketchReferencePreselection).toHaveBeenLastCalledWith(candidate)

    fireEvent.pointerLeave(viewport)
    expect(port.setSketchReferencePreselection).toHaveBeenLastCalledWith(null)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    fireEvent.click(screen.getByRole("option", { name: "3/3 Box · Vertex 1" }))
    expect(onSelect).toHaveBeenLastCalledWith(modelPointCandidate)
    expect(screen.queryByRole("listbox", { name: "Select other reference" })).toBeNull()
    expect(document.activeElement).toBe(viewport)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    expect(document.activeElement).toBe(
      screen.getByRole("listbox", { name: "Select other reference" }),
    )
    act(() => options?.onSketchReferenceCandidateStackChange?.([]))
    expect(screen.queryByRole("listbox", { name: "Select other reference" })).toBeNull()
    expect(document.activeElement).toBe(viewport)

    options?.onSketchReferenceSelectionChange?.(candidate)
    expect(onSelect).toHaveBeenCalledWith(candidate)
    act(() => options?.onSketchReferencePreselectionChange?.(lineCandidate))
    expect(screen.getByText("Use reference: Source · Line", { exact: true })).toBeTruthy()
    options?.onSketchReferenceSelectionChange?.(lineCandidate)
    expect(onSelect).toHaveBeenCalledWith(lineCandidate)
    options?.onSketchReferenceSelectionChange?.(modelPointCandidate)
    options?.onSketchReferenceSelectionChange?.(modelLineCandidate)
    options?.onSketchReferenceSelectionChange?.(modelCurveCandidate)
    expect(onSelect).toHaveBeenCalledWith(modelPointCandidate)
    expect(onSelect).toHaveBeenCalledWith(modelLineCandidate)
    expect(onSelect).toHaveBeenCalledWith(modelCurveCandidate)

    fireEvent.change(
      screen.getByRole("combobox", { name: "Select a reference with the keyboard" }),
      {
        target: { value: "4" },
      },
    )
    expect(onSelect).toHaveBeenLastCalledWith(modelCurveCandidate)
  })

  it("routes planar-face intersection selection through normal face picking in orbit mode", async () => {
    const selection = { featureId: boxId, faceId: 17, faceOrdinal: 3 }
    const onSelect = vi.fn()
    const { createViewport, onSelectionChange, port } = renderViewport(
      readyController(
        [{ id: boxId, dependencies: [] }],
        [{ featureId: boxId, geometry: { mesh } }],
      ),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        frame: null,
        mode: "orbit",
        faceIntersectionSelection: { onSelect },
      },
    )

    await waitFor(() => expect(port.setInteractionMode).toHaveBeenLastCalledWith("select"))
    expect(screen.getByText("Intersection · Select one planar model face")).toBeTruthy()
    const options = createViewport.mock.calls[0]?.[1]
    options?.onSelectionChange?.(selection)
    expect(onSelect).toHaveBeenCalledWith(selection)
    expect(onSelectionChange).not.toHaveBeenCalled()

    options?.onSelectionChange?.(null)
    expect(onSelectionChange).toHaveBeenCalledWith(null)
  })

  it("renders exact unsaved meshes as a distinct preview state", async () => {
    const previewMesh = { featureId: boxId, appearance: "preview" as const, ...mesh }
    const { port } = renderViewport(readyController([], []), null, undefined, {
      status: "ready",
      meshes: [previewMesh],
    })

    await waitFor(() => expect(port.setMeshes).toHaveBeenCalledWith([previewMesh]))
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-preview-status")).toBe("ready")
    expect(viewport.getAttribute("data-preview-feature-count")).toBe("1")
    expect(screen.getByRole("status").textContent).toBe("Unsaved extrusion preview")
  })

  it("owns the imperative viewer lifecycle and exposes fit for rebuilt terminal geometry", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const selection = { featureId: boxId, faceId: 7, faceOrdinal: 2 }
    const { createViewport, onSelectionChange, port, unmount } = renderViewport(
      controller,
      selection,
    )

    await waitFor(() => expect(createViewport).toHaveBeenCalledOnce())
    expect(createViewport).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({ onSelectionChange: expect.any(Function) }),
    )
    createViewport.mock.calls[0]?.[1].onSelectionChange?.(selection)
    expect(onSelectionChange).toHaveBeenCalledWith(selection)
    expect(port.setMeshes).toHaveBeenCalledWith([{ featureId: boxId, ...mesh }])
    expect(port.setOriginPlaneVisibility).toHaveBeenCalledWith({ xy: true, xz: true, yz: true })
    expect(port.setOriginPlaneSelection).toHaveBeenCalledWith(null, false, false)
    expect(
      screen
        .getByRole("region", { name: "3D viewport" })
        .getAttribute("data-rendered-feature-count"),
    ).toBe("1")
    expect(port.fit).toHaveBeenCalledOnce()
    expect(screen.getByRole("img", { name: "World axes" })).toBeTruthy()
    expect(screen.getByText("XYZ · mm")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Fit view" }))
    expect(port.fit).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
    expect(port.clearSelection).toHaveBeenCalledOnce()

    unmount()
    expect(port.dispose).toHaveBeenCalledOnce()
  })

  it("preserves the camera when rebuilt geometry replaces the displayed mesh", async () => {
    const firstController = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const updatedMesh = {
      ...mesh,
      positions: new Float32Array([0, 0, 0, 30, 0, 0, 0, 30, 0]),
    }
    const { port, rerenderController } = renderViewport(firstController)

    await waitFor(() => expect(port.fit).toHaveBeenCalledOnce())
    rerenderController(
      readyController(
        [{ id: boxId, dependencies: [] }],
        [{ featureId: boxId, geometry: { mesh: updatedMesh } }],
      ),
    )

    await waitFor(() =>
      expect(port.setMeshes).toHaveBeenLastCalledWith([{ featureId: boxId, ...updatedMesh }]),
    )
    expect(port.fit).toHaveBeenCalledOnce()
  })

  it("renders only terminal feature geometry and retains origin-plane context for an empty model", async () => {
    const controller = readyController(
      [
        { id: boxId, dependencies: [] },
        { id: booleanId, dependencies: [boxId] },
      ],
      [
        { featureId: boxId, geometry: { mesh } },
        { featureId: booleanId, geometry: { mesh } },
      ],
    )
    expect(viewerMeshes(controller)).toEqual([{ featureId: booleanId, ...mesh }])
    expect(viewerMeshes(controller, [booleanId])).toEqual([])

    const empty = renderViewport(readyController([], []))
    await waitFor(() => expect(empty.createViewport).toHaveBeenCalledOnce())
    expect(screen.getByText("Create a feature to display its rebuilt geometry.").textContent).toBe(
      "Create a feature to display its rebuilt geometry.",
    )
  })

  it("highlights hovered and opened features by exact identity, including historical geometry", async () => {
    const controller = readyController(
      [
        { id: boxId, dependencies: [] },
        { id: booleanId, dependencies: [boxId] },
      ],
      [
        { featureId: boxId, geometry: { mesh } },
        { featureId: booleanId, geometry: { mesh } },
      ],
    )
    const { port } = renderViewport(controller, null, undefined, undefined, undefined, {
      preselectedFeatureId: booleanId,
      selectedFeatureId: boxId,
    })

    await waitFor(() =>
      expect(port.setFeatureSelection).toHaveBeenLastCalledWith({ featureId: boxId, ...mesh }),
    )
    expect(port.setFeaturePreselection).toHaveBeenLastCalledWith({
      featureId: booleanId,
      ...mesh,
    })
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-selected-feature")).toBe(boxId)
    expect(viewport.getAttribute("data-preselected-feature")).toBe(booleanId)
  })

  it("uses the unsaved candidate mesh for an opened feature highlight", async () => {
    const previewMesh = {
      featureId: boxId,
      appearance: "preview" as const,
      ...mesh,
      positions: new Float32Array([0, 0, 0, 40, 0, 0, 0, 40, 0]),
    }
    const { port } = renderViewport(
      readyController(
        [{ id: boxId, dependencies: [] }],
        [{ featureId: boxId, geometry: { mesh } }],
      ),
      null,
      undefined,
      { status: "ready", meshes: [previewMesh], candidateMesh: previewMesh },
      undefined,
      { selectedFeatureId: boxId },
    )

    await waitFor(() => expect(port.setFeatureSelection).toHaveBeenLastCalledWith(previewMesh))
  })

  it("renders exact saved sketches with the model and filters hidden sketch identities", async () => {
    const controller = readyController([], [], [sketchDisplay])
    expect(viewerSketches(controller)).toEqual([sketchDisplay])
    expect(viewerSketches(controller, [sketchDisplay.sketchId])).toEqual([])

    const { port } = renderViewport(controller)
    await waitFor(() => expect(port.setSketches).toHaveBeenCalledWith([sketchDisplay]))
    expect(
      screen
        .getByRole("region", { name: "3D viewport" })
        .getAttribute("data-rendered-sketch-count"),
    ).toBe("1")
    expect(screen.queryByText("Create a feature to display its rebuilt geometry.")).toBeNull()
  })

  it("renders datum planes as reference geometry while keeping them independently hideable", () => {
    const datumFeature = {
      schemaVersion: 0,
      id: datumId,
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(10),
      },
      dependencies: [],
      references: [],
      suppressed: false,
    }
    const controller = readyController(
      [{ id: boxId, dependencies: [] }, datumFeature],
      [
        { featureId: boxId, geometry: { mesh } },
        { featureId: datumId, geometry: { mesh } },
      ],
    )

    expect(viewerMeshes(controller)).toEqual([
      { featureId: boxId, ...mesh },
      { featureId: datumId, appearance: "datum", ...mesh },
    ])
    expect(viewerMeshes(controller, [datumId])).toEqual([{ featureId: boxId, ...mesh }])
  })

  it("reveals the previous terminal body only for transient sketch-edit rollback", () => {
    const controller = readyController(
      [
        { id: boxId, dependencies: [] },
        { id: booleanId, dependencies: [boxId] },
      ],
      [
        { featureId: boxId, geometry: { mesh } },
        { featureId: booleanId, geometry: { mesh } },
      ],
    )

    expect(viewerMeshes(controller)).toEqual([{ featureId: booleanId, ...mesh }])
    expect(viewerMeshes(controller, [booleanId])).toEqual([])
    expect(viewerMeshes(controller, [], [booleanId])).toEqual([{ featureId: boxId, ...mesh }])
  })

  it("initializes an empty 3D viewport for origin-plane preselection and selection", async () => {
    const onSelect = vi.fn()
    const { createViewport, port } = renderViewport(readyController([], []), null, {
      mode: "create",
      selectedPlane: "xz",
      onSelect,
    })

    await waitFor(() => expect(createViewport).toHaveBeenCalledOnce())
    expect(port.setMeshes).toHaveBeenCalledWith([])
    expect(port.setOriginPlaneSelection).toHaveBeenCalledWith("xz", true, false)
    expect(screen.queryByText("Create a feature to display its rebuilt geometry.")).toBeNull()
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-origin-plane-selection")).toBe("xz")

    const options = createViewport.mock.calls[0]?.[1]
    options?.onOriginPlanePreselectionChange?.("yz")
    await waitFor(() => expect(viewport.getAttribute("data-origin-plane-preselection")).toBe("yz"))
    expect(screen.getByText("Click to sketch on YZ plane").textContent).toBe(
      "Click to sketch on YZ plane",
    )
    options?.onOriginPlaneSelectionChange?.("xy")
    expect(onSelect).toHaveBeenCalledWith("xy")
  })

  it("keeps an idle origin-plane selection visible without activating support selection", async () => {
    const onSelect = vi.fn()
    const { createViewport, port } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        selectedPlane: "yz",
        onSelect,
      },
    )

    await waitFor(() => expect(createViewport).toHaveBeenCalledOnce())
    expect(port.setOriginPlaneSelection).toHaveBeenCalledWith("yz", false, true)
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-origin-plane-selection")).toBe("yz")

    const options = createViewport.mock.calls[0]?.[1]
    options?.onOriginPlaneSelectionChange?.("xz")
    expect(onSelect).toHaveBeenCalledWith("xz")
    options?.onOriginPlaneSelectionChange?.(null)
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it("explains graphical support replacement without highlighting a false origin plane", async () => {
    const { port } = renderViewport(readyController([], []), null, {
      mode: "replace",
      selectedPlane: null,
      onSelect: vi.fn(),
    })

    await waitFor(() =>
      expect(port.setOriginPlaneSelection).toHaveBeenCalledWith(null, true, false),
    )
    expect(
      screen.getByText(
        "Select an earlier origin plane, datum plane, or supported planar model face to replace the sketch support.",
      ),
    ).toBeTruthy()
    expect(screen.getByText("Current support: model face")).toBeTruthy()
  })

  it("labels and disambiguates overlapping model faces for sketch support", async () => {
    const boxSelection = { featureId: boxId, faceId: 3, faceOrdinal: 99 }
    const extrusionSelection = { featureId: booleanId, faceId: 7, faceOrdinal: 88 }
    const extrusionSideSelection = { featureId: booleanId, faceId: 9, faceOrdinal: 77 }
    const unsupportedSelection = { featureId: booleanId, faceId: 11, faceOrdinal: 66 }
    const { createViewport, onSelectionChange, port } = renderViewport(
      readyController(
        [
          { id: boxId, dependencies: [], label: "Box 1" },
          { id: booleanId, dependencies: [], label: "Extrusion 1" },
        ],
        [
          {
            featureId: boxId,
            geometry: {
              mesh,
              topologyCandidates: [
                planarFaceCandidate("box-face", 3, "primitive.box.cap.end", [0, 0, 0]),
              ],
            },
          },
          {
            featureId: booleanId,
            geometry: {
              mesh,
              topologyCandidates: [
                planarFaceCandidate("extrusion-cap", 7, "extrusion.cap.end", [0, 0, 10]),
                planarFaceCandidate("extrusion-wall", 9, "extrusion.side.1", [10, 0, 5]),
                planarFaceCandidate("unknown-wall", 11, "generated.face", [-10, 0, 5]),
              ],
            },
          },
        ],
      ),
      null,
      { mode: "create", selectedPlane: "xy", onSelect: vi.fn() },
    )

    await waitFor(() => expect(createViewport).toHaveBeenCalledOnce())
    const options = createViewport.mock.calls[0]?.[1]
    expect(options?.isSelectionCandidateEligible?.(boxSelection)).toBe(true)
    expect(options?.isSelectionCandidateEligible?.(extrusionSelection)).toBe(true)
    expect(options?.isSelectionCandidateEligible?.(extrusionSideSelection)).toBe(true)
    expect(options?.isSelectionCandidateEligible?.(unsupportedSelection)).toBe(false)
    act(() =>
      options?.onSelectionCandidateStackChange?.([
        unsupportedSelection,
        boxSelection,
        extrusionSelection,
      ]),
    )
    expect(screen.getByText("Click to sketch on Box 1 · Face 1")).toBeTruthy()

    act(() => options?.onSelectionCandidateStackCommit?.([boxSelection, extrusionSelection]))
    const listbox = await screen.findByRole("listbox", { name: "Select sketch support" })
    expect(port.setSelectionCandidateStackPreserved).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole("option", { name: "1/2 Box 1 · Face 1" })).toBeTruthy()
    const extrusionOption = screen.getByRole("option", { name: "2/2 Extrusion 1 · Face 1" })
    fireEvent.pointerEnter(extrusionOption)
    expect(port.setSelectionPreselection).toHaveBeenLastCalledWith(extrusionSelection)
    expect(screen.getByText("Click to sketch on Extrusion 1 · Face 1")).toBeTruthy()

    fireEvent.click(extrusionOption)
    expect(port.setSelectionCandidateStackPreserved).toHaveBeenLastCalledWith(false)
    expect(onSelectionChange).toHaveBeenLastCalledWith(extrusionSelection)
    expect(screen.queryByRole("listbox", { name: "Select sketch support" })).toBeNull()
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(document.activeElement).toBe(viewport)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    const keyboardListbox = screen.getByRole("listbox", { name: "Select sketch support" })
    fireEvent.keyDown(keyboardListbox, { code: "Backquote", key: "`" })
    expect(port.setSelectionPreselection).toHaveBeenLastCalledWith(extrusionSelection)
    fireEvent.keyDown(keyboardListbox, { code: "Backquote", key: "`", shiftKey: true })
    expect(port.setSelectionPreselection).toHaveBeenLastCalledWith(boxSelection)
    fireEvent.keyDown(keyboardListbox, { key: "Escape" })
    expect(screen.queryByRole("listbox", { name: "Select sketch support" })).toBeNull()
    expect(document.activeElement).toBe(viewport)

    act(() => options?.onSelectionCandidateStackCommit?.([boxSelection, extrusionSelection]))
    await screen.findByRole("listbox", { name: "Select sketch support" })
    act(() => options?.onSelectionCandidateStackChange?.([boxSelection]))
    expect(screen.queryByRole("listbox", { name: "Select sketch support" })).toBeNull()
    expect(port.setSelectionCandidateStackPreserved).toHaveBeenLastCalledWith(false)
    expect(document.activeElement).toBe(viewport)

    act(() => options?.onSelectionCandidateStackChange?.([boxSelection, extrusionSelection]))
    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Select sketch support" }), {
      key: "Enter",
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith(boxSelection)
    expect(listbox).not.toBe(document.activeElement)
  })

  it("forwards individual origin-plane visibility and exposes accessible toggles", async () => {
    const onChange = vi.fn()
    const visibility = { xy: true, xz: false, yz: true }
    const { port } = renderViewport(readyController([], []), null, undefined, undefined, {
      visibility,
      onChange,
    })

    await waitFor(() => expect(port.setOriginPlaneVisibility).toHaveBeenCalledWith(visibility))
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-origin-plane-visibility")).toBe("xy,yz")

    fireEvent.click(screen.getByRole("button", { name: "Hide XY plane" }))
    fireEvent.click(screen.getByRole("button", { name: "Show XZ plane" }))

    expect(onChange).toHaveBeenNthCalledWith(1, "xy", false)
    expect(onChange).toHaveBeenNthCalledWith(2, "xz", true)
    expect(document.querySelector('[data-plane-symbol="XY"]')).toBeTruthy()
    expect(document.querySelector('[data-plane-symbol="XZ"]')).toBeTruthy()
    expect(document.querySelector('[data-plane-symbol="YZ"]')).toBeTruthy()
  })

  it("contains renderer initialization failures as a localized viewport state", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const createViewport = vi.fn(async () => {
      throw new Error("WebGL2 is unavailable.")
    })
    const onSelectionChange = vi.fn()

    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <TooltipProvider>
          <GeometryViewport
            controller={controller}
            createViewport={createViewport}
            selection={null}
            onSelectionChange={onSelectionChange}
          />
        </TooltipProvider>
      </I18nProvider>,
    )

    expect(
      (
        await screen.findByText(
          "WebGL2 is unavailable in this browser or device. Modeling data remains saved.",
        )
      ).textContent,
    ).toBe("WebGL2 is unavailable in this browser or device. Modeling data remains saved.")
  })

  it("retries one failed derived thumbnail write before marking the revision complete", async () => {
    vi.useFakeTimers()
    saveActiveProjectThumbnailMock
      .mockResolvedValueOnce({
        ok: false,
        diagnostic: { code: "storage-unavailable", message: "Preview storage was unavailable." },
      })
      .mockResolvedValueOnce({ ok: true })
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    ;(controller.report?.snapshot as { id: string; revision: number }).id = "project-1"
    ;(controller.report?.snapshot as { id: string; revision: number }).revision = 3

    renderViewport(controller)

    await vi.waitFor(() => expect(saveActiveProjectThumbnailMock).toHaveBeenCalledOnce())
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(250)
    await vi.waitFor(() => expect(saveActiveProjectThumbnailMock).toHaveBeenCalledTimes(2))
    vi.useRealTimers()
  })
})
