// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { boxFeatureType, createLengthQuantity, datumPlaneFeatureType } from "@vibeshape/domain"
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
import { i18n } from "../i18n"
import { GeometryViewport, viewerMeshes, viewerSketches } from "./geometry-viewport"

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
const sketchDisplay = {
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f2605",
  curvePositions: new Float32Array([0, 0, 0, 20, 0, 0]),
  constructionCurvePositions: new Float32Array(),
  pointPositions: new Float32Array([0, 0, 0, 20, 0, 0]),
  constructionPointPositions: new Float32Array(),
}

function readyController(
  features: readonly { id: string; dependencies: readonly string[] }[],
  geometry: readonly { featureId: string; geometry: { mesh: typeof mesh } }[],
  sketches: readonly (typeof sketchDisplay)[] = [],
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
      },
      rebuild: { ok: true, response: { geometry, sketches } },
    },
  } as unknown as DocumentControllerState
}

function renderViewport(
  controller: DocumentControllerState,
  selection: ViewerSelection | null = null,
  originPlaneSelection?: Readonly<{
    selectedPlane: "xy" | "xz" | "yz"
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
  passive = false,
) {
  const port: GeometryViewportPort = {
    setFeaturePreselection: vi.fn(),
    setFeatureSelection: vi.fn(),
    setMeshes: vi.fn(),
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
  const element = (nextController: DocumentControllerState, nextPassive = passive) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <GeometryViewport
          controller={nextController}
          createViewport={createViewport}
          selection={selection}
          onSelectionChange={onSelectionChange}
          passive={nextPassive}
          {...featureHighlight}
          {...(featurePreview ? { featurePreview } : {})}
          {...(originPlaneSelection ? { originPlaneSelection } : {})}
          {...(originPlaneVisibility ? { originPlaneVisibility } : {})}
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
    rerenderPassive: (nextPassive: boolean) => result.rerender(element(controller, nextPassive)),
  }
}

afterEach(cleanup)

beforeEach(() => {
  saveActiveProjectThumbnailMock.mockReset()
  saveActiveProjectThumbnailMock.mockResolvedValue({ ok: true })
})

describe("GeometryViewport", () => {
  it("preserves the viewer and camera while passive context disables chrome and input", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const { container, createViewport, port, rerenderPassive, unmount } = renderViewport(controller)
    await waitFor(() =>
      expect(port.setMeshes).toHaveBeenCalledWith([{ featureId: boxId, ...mesh }]),
    )
    expect(createViewport).toHaveBeenCalledOnce()
    expect(port.fit).toHaveBeenCalledOnce()

    rerenderPassive(true)
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
    expect(port.dispose).not.toHaveBeenCalled()

    rerenderPassive(false)
    expect(screen.getByRole("region", { name: "3D viewport" })).toBeTruthy()
    expect(createViewport).toHaveBeenCalledOnce()
    expect(port.fit).toHaveBeenCalledOnce()
    expect(port.dispose).not.toHaveBeenCalled()

    unmount()
    expect(port.dispose).toHaveBeenCalledOnce()
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
      expect.objectContaining({ onSelectionChange }),
    )
    expect(port.setMeshes).toHaveBeenCalledWith([{ featureId: boxId, ...mesh }])
    expect(port.setOriginPlaneVisibility).toHaveBeenCalledWith({ xy: true, xz: true, yz: true })
    expect(port.setOriginPlaneSelection).toHaveBeenCalledWith(null)
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

  it("initializes an empty 3D viewport for origin-plane preselection and selection", async () => {
    const onSelect = vi.fn()
    const { createViewport, port } = renderViewport(readyController([], []), null, {
      selectedPlane: "xz",
      onSelect,
    })

    await waitFor(() => expect(createViewport).toHaveBeenCalledOnce())
    expect(port.setMeshes).toHaveBeenCalledWith([])
    expect(port.setOriginPlaneSelection).toHaveBeenCalledWith("xz")
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
