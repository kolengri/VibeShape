import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { AssemblyInspection } from "@vibeshape/protocol"
import type { GeometryViewportOptions } from "@vibeshape/viewer/three-viewport"
import { vi } from "../../../../../tests/unit/support/bun-test"

const ports = (() => ({
  create: vi.fn(),
  meshes: vi.fn(),
  highlight: vi.fn(),
  dispose: vi.fn(),
  fit: vi.fn(),
  bed: vi.fn(),
  grid: vi.fn(),
  mode: vi.fn(),
}))()
const originalModule1 = { ...(await import("@vibeshape/viewer/three-viewport")) }
mock.module("@vibeshape/viewer/three-viewport", () => {
  const actual = originalModule1
  return { ...actual, createGeometryViewport: ports.create }
})

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { printerProfileSchema } = await import("@vibeshape/protocol")
const { i18n } = await import("../../i18n")
const { useViewerPreferences, ViewerPreferencesProvider } = await import(
  "../../shell/viewer-preferences"
)
const { authoredTestId: id } = await import("../../test-support/authored-tree-fixture")
const { identityAssemblyPose } = await import("./assembly-model")
const { AssemblyViewport } = await import("./assembly-viewport")
function inspection(): AssemblyInspection {
  const occurrence = (instanceId: string, sourceIndex: number) => ({
    instanceId,
    definitionId: id(5),
    pinRevision: 1,
    sourceIndex,
    selectedBody: { schemaVersion: 0 as const, featureId: id(6), outputRole: "result" },
    contentHash: "a".repeat(64),
    representation: "exact-solid" as const,
    geometryFrame: {
      ...identityAssemblyPose,
      translation: [25, 0, 0] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    },
    mesh: {
      positions: new Float32Array([25, 0, 0, 35, 0, 0, 25, 10, 0, 25, 0, 10]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
      triangleFaceIds: new Uint32Array([1, 2, 3, 4]),
    },
    bounds: {
      min: [25, 0, 0] as [number, number, number],
      max: [35, 10, 10] as [number, number, number],
    },
  })
  return {
    occurrences: [occurrence(id(2), 0), occurrence(id(2), 1), occurrence(id(3), 0)],
    interference: [],
  }
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() })
  ports.create.mockReturnValue({
    setOriginPlaneVisibility: vi.fn(),
    setGroundGrid: ports.grid,
    setPrintBed: ports.bed,
    setMeshes: ports.meshes,
    setInteractionMode: ports.mode,
    setFeatureSelection: ports.highlight,
    dispose: ports.dispose,
    fit: ports.fit,
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
describe("Assembly viewport occurrence identity", () => {
  it("shows only baseline occurrences with navigation and preserves framing across read-only toggles", async () => {
    const current = inspection()
    const baseline = { ...inspection(), occurrences: inspection().occurrences.slice(0, 2) }
    const select = vi.fn()
    const View = ({ readOnly, empty = false }: { readOnly: boolean; empty?: boolean }) => (
      <I18nProvider i18n={i18n} initialLocale="en">
        <ViewerPreferencesProvider>
          <AssemblyViewport
            inspection={readOnly ? (empty ? null : baseline) : current}
            selectedId={id(2)}
            onSelect={select}
            readOnly={readOnly}
          />
        </ViewerPreferencesProvider>
      </I18nProvider>
    )
    const view = render(<View readOnly={false} />)
    await waitFor(() => expect(ports.meshes).toHaveBeenCalled())
    const fits = ports.fit.mock.calls.length
    const options: GeometryViewportOptions = ports.create.mock.calls[0]?.[1]
    view.rerender(<View readOnly />)
    expect(ports.meshes.mock.calls.at(-1)?.[0]).toHaveLength(2)
    expect(ports.meshes.mock.calls.at(-1)?.[0][0].positions).toBe(
      baseline.occurrences[0]?.mesh.positions,
    )
    expect(ports.mode).toHaveBeenLastCalledWith("camera-only")
    expect(ports.highlight).toHaveBeenLastCalledWith(null)
    act(() => options.onSelectionChange?.({ featureId: id(3), faceId: 1, faceOrdinal: 1 }))
    expect(select).not.toHaveBeenCalled()
    expect(ports.fit).toHaveBeenCalledTimes(fits)
    fireEvent.click(screen.getByRole("button", { name: "Fit assembly" }))
    expect(ports.fit).toHaveBeenCalledTimes(fits + 1)
    view.rerender(<View readOnly empty />)
    expect(ports.meshes).toHaveBeenLastCalledWith([])
    view.rerender(<View readOnly={false} />)
    expect(ports.meshes.mock.calls.at(-1)?.[0]).toHaveLength(3)
    expect(ports.mode).toHaveBeenLastCalledWith("select")
    expect(ports.fit).toHaveBeenCalledTimes(fits + 1)
    act(() => options.onSelectionChange?.({ featureId: id(3), faceId: 1, faceOrdinal: 1 }))
    expect(select).toHaveBeenCalledWith(id(3))
    expect(ports.create).toHaveBeenCalledTimes(1)
    expect(ports.dispose).not.toHaveBeenCalled()
  })

  it("updates solved preview meshes without fitting the camera or replacing the renderer", async () => {
    const select = vi.fn()
    const View = ({ value, autoFit }: { value: AssemblyInspection; autoFit: boolean }) => (
      <I18nProvider i18n={i18n} initialLocale="en">
        <ViewerPreferencesProvider>
          <AssemblyViewport
            inspection={value}
            selectedId={null}
            onSelect={select}
            autoFit={autoFit}
          />
        </ViewerPreferencesProvider>
      </I18nProvider>
    )
    const view = render(<View value={inspection()} autoFit />)
    await waitFor(() => expect(ports.meshes).toHaveBeenCalledTimes(1))
    expect(ports.fit).toHaveBeenCalledTimes(1)
    view.rerender(<View value={inspection()} autoFit={false} />)
    await waitFor(() => expect(ports.meshes).toHaveBeenCalledTimes(2))
    view.rerender(<View value={inspection()} autoFit={false} />)
    await waitFor(() => expect(ports.meshes).toHaveBeenCalledTimes(3))
    expect(ports.fit).toHaveBeenCalledTimes(1)
    expect(ports.create).toHaveBeenCalledTimes(1)
  })
  it("renders world meshes once, picks independent instances and highlights every source of the selected occurrence", async () => {
    const value = inspection(),
      select = vi.fn()
    const View = ({ selectedId }: { selectedId: string | null }) => (
      <I18nProvider i18n={i18n} initialLocale="en">
        <ViewerPreferencesProvider>
          <AssemblyViewport inspection={value} selectedId={selectedId} onSelect={select} />
        </ViewerPreferencesProvider>
      </I18nProvider>
    )
    const view = render(<View selectedId={null} />)
    await waitFor(() => expect(ports.meshes).toHaveBeenCalledTimes(1))
    const meshes = ports.meshes.mock.calls[0]?.[0]
    expect(meshes.map((mesh: { featureId: string }) => mesh.featureId)).toEqual([
      id(2),
      id(2),
      id(3),
    ])
    expect(meshes[0].positions).toBe(value.occurrences[0]?.mesh.positions)
    expect(meshes[0].positions[0]).toBe(25)
    const options = ports.create.mock.calls[0]?.[1] as GeometryViewportOptions
    act(() => options.onSelectionChange?.({ featureId: id(3), faceId: 1, faceOrdinal: 0 }))
    expect(select).toHaveBeenCalledWith(id(3))
    view.rerender(<View selectedId={id(2)} />)
    await waitFor(() =>
      expect(ports.highlight).toHaveBeenLastCalledWith(
        expect.objectContaining({ featureId: id(2) }),
      ),
    )
    const highlight = ports.highlight.mock.calls.at(-1)?.[0]
    expect(highlight.positions).toHaveLength(24)
    expect(Array.from(highlight.indices)).toEqual([
      0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3, 4, 6, 5, 4, 5, 7, 4, 7, 6, 5, 6, 7,
    ])
    expect(ports.create).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(ports.dispose).toHaveBeenCalledTimes(1)
  })
})

function PreferencesControls() {
  const actions = useViewerPreferences((state) => state.actions)
  const bedVisible = useViewerPreferences((state) => state.printBedVisible)
  const gridVisible = useViewerPreferences((state) => state.groundGridVisible)
  return (
    <>
      <button
        type="button"
        onClick={() =>
          actions.setPrinterProfile(
            printerProfileSchema.parse({
              version: 1,
              name: "Fixture printer",
              width: 40,
              depth: 40,
              height: 100,
              margin: 0,
            }),
          )
        }
      >
        Set fixture printer
      </button>
      <button type="button" onClick={() => actions.setPrintBedVisible(!bedVisible)}>
        Toggle fixture bed
      </button>
      <button type="button" onClick={() => actions.setGroundGridVisible(!gridVisible)}>
        Toggle fixture grid
      </button>
    </>
  )
}
describe("Assembly print workspace presentation", () => {
  it("synchronizes bed and grid preferences without recreating the viewport or moving world geometry", async () => {
    const value = inspection(),
      onSelect = vi.fn()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <ViewerPreferencesProvider>
          <PreferencesControls />
          <AssemblyViewport inspection={value} selectedId={null} onSelect={onSelect} />
        </ViewerPreferencesProvider>
      </I18nProvider>,
    )
    await waitFor(() => expect(ports.meshes).toHaveBeenCalledTimes(1))
    expect(ports.bed).toHaveBeenLastCalledWith(null)
    expect(ports.grid).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole("button", { name: "Set fixture printer" }))
    fireEvent.click(screen.getByRole("button", { name: "Toggle fixture bed" }))
    await waitFor(() =>
      expect(ports.bed).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: "Fixture printer", exceeded: true, width: 40 }),
      ),
    )
    expect(screen.getByText("X upper boundary: exceeds by 15.00 mm")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Toggle fixture grid" }))
    await waitFor(() => expect(ports.grid).toHaveBeenLastCalledWith(false))
    fireEvent.click(screen.getByRole("button", { name: "Toggle fixture bed" }))
    await waitFor(() => expect(ports.bed).toHaveBeenLastCalledWith(null))
    expect(screen.queryByText("X upper boundary: exceeds by 15.00 mm")).toBeNull()
    expect(ports.create).toHaveBeenCalledTimes(1)
    expect(ports.meshes).toHaveBeenCalledTimes(1)
    expect(ports.meshes.mock.calls[0]?.[0][0].positions).toBe(value.occurrences[0]?.mesh.positions)
  })
})
