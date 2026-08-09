// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { GeometryViewport as GeometryViewportPort, ViewerSelection } from "@vibeshape/viewer"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { GeometryViewport, viewerMeshes } from "./geometry-viewport"

const boxId = "0195b5ac-b220-7a2c-8c33-67a36a7f2602"
const booleanId = "0195b5ac-b220-7a2c-8c33-67a36a7f2603"
const mesh = {
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 20, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
}

function readyController(
  features: readonly { id: string; dependencies: readonly string[] }[],
  geometry: readonly { featureId: string; geometry: { mesh: typeof mesh } }[],
) {
  return {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      snapshot: { features },
      rebuild: { ok: true, response: { geometry } },
    },
  } as unknown as DocumentControllerState
}

function renderViewport(
  controller: DocumentControllerState,
  selection: ViewerSelection | null = null,
) {
  const port: GeometryViewportPort = {
    setMeshes: vi.fn(),
    fit: vi.fn(),
    clearSelection: vi.fn(),
    dispose: vi.fn(),
  }
  const onSelectionChange = vi.fn()
  const createViewport = vi.fn(() => port)
  const result = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <GeometryViewport
        controller={controller}
        createViewport={createViewport}
        selection={selection}
        onSelectionChange={onSelectionChange}
      />
    </I18nProvider>,
  )
  return { ...result, createViewport, onSelectionChange, port }
}

afterEach(cleanup)

describe("GeometryViewport", () => {
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
    expect(createViewport).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), {
      onSelectionChange,
    })
    expect(port.setMeshes).toHaveBeenCalledWith([{ featureId: boxId, ...mesh }])
    expect(
      screen
        .getByRole("region", { name: "3D viewport" })
        .getAttribute("data-rendered-feature-count"),
    ).toBe("1")

    fireEvent.click(screen.getByRole("button", { name: "Fit view" }))
    expect(port.fit).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
    expect(port.clearSelection).toHaveBeenCalledOnce()

    unmount()
    expect(port.dispose).toHaveBeenCalledOnce()
  })

  it("renders only terminal feature geometry and reports an empty model", () => {
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

    const empty = renderViewport(readyController([], []))
    expect(empty.createViewport).not.toHaveBeenCalled()
    expect(screen.getByText("Create a feature to display its rebuilt geometry.").textContent).toBe(
      "Create a feature to display its rebuilt geometry.",
    )
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
        <GeometryViewport
          controller={controller}
          createViewport={createViewport}
          selection={null}
          onSelectionChange={onSelectionChange}
        />
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
})
