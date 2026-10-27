import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ModelBodyGeometry } from "@vibeshape/application/model-bodies"
import type {
  QuickLightweightingInput,
  QuickLightweightingResult,
} from "@vibeshape/structural-optimization/quick-contract"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"

const ports = (() => ({
  generate: vi.fn(),
  encode: vi.fn(),
  structuralEncode: vi.fn(),
  inspect: vi.fn(),
  apply: vi.fn(),
  parts: vi.fn(),
  previewReady: vi.fn(),
  close: vi.fn(),
  registerSubmission: vi.fn(),
}))()
const originalModule1 = { ...(await import("../../editor-session/editor-session-provider")) }
mock.module("../../editor-session/editor-session-provider", () => ({
  ...originalModule1,
  useRegisterTaskSubmission: ports.registerSubmission,
}))
mock.module("@vibeshape/application/authored-parts", () => ({ resolveAuthoredParts: ports.parts }))
mock.module("@vibeshape/structural-optimization/quick-client", () => ({
  generateQuickLightweighting: ports.generate,
  encodeQuickLightweightingStl: ports.encode,
  QuickLightweightingError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
}))
const structuralMeshModule = { ...(await import("@vibeshape/structural-optimization/mesh")) }
mock.module("@vibeshape/structural-optimization/mesh", () => ({
  ...structuralMeshModule,
  encodeStructuralStl: ports.structuralEncode,
}))
mock.module("../../document/document-controller", () => ({
  inspectTriangleMeshSource: ports.inspect,
  commitAuthoredTransaction: ports.apply,
}))
const mockDependency1 = await import("react")
mock.module("../import/import-preview", () => {
  const { useEffect } = mockDependency1
  return {
    ImportPreview: ({ onReady, label }: { onReady: (ready: boolean) => void; label: string }) => {
      useEffect(() => {
        ports.previewReady.mockImplementation(onReady)
        return () => {
          ports.previewReady.mockReset()
          onReady(false)
        }
      }, [onReady])
      return <div role="img" aria-label={label} />
    },
  }
})

const { webcrypto } = await import("node:crypto")
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { QuickLightweightingError } = await import("@vibeshape/structural-optimization/quick-client")
const { i18n } = await import("../../i18n")
const { default: messages } = await import("../../i18n/messages/en.json")
const { authoredTreeFixture } = await import("../../test-support/authored-tree-fixture")
const { meshInspection } = await import("../import/import-test-fixtures")
const { QuickLightweightingTaskPanel } = await import("./quick-lightweighting-task-panel")

const fixture = authoredTreeFixture()
const firstPart = fixture.authority.parts[0]
const binding = firstPart?.bodyHistory[0]
if (!firstPart || !binding) throw new Error("The fixture requires a Part and body binding.")
const firstPartId = firstPart.id
const firstPartName = firstPart.name
const cube: ModelBodyGeometry = {
  featureId: binding.featureId,
  outputRole: "result",
  contentHash: "exact-cube-hash",
  representation: "exact-solid",
  shape: {
    valid: true,
    volume: 216,
    surfaceArea: 216,
    solidCount: 1,
    faceCount: 6,
    edgeCount: 12,
    bounds: { min: [0, 0, 0], max: [6, 6, 6] },
  },
  mesh: {
    positions: new Float32Array([
      0, 0, 0, 0, 0, 6, 0, 6, 0, 0, 6, 6, 6, 0, 0, 6, 0, 6, 6, 6, 0, 6, 6, 6,
    ]),
    normals: new Float32Array(24),
    indices: new Uint32Array([
      0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1,
      5, 7, 1, 7, 3,
    ]),
    triangleFaceIds: new Uint32Array([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]),
  },
  topologyCandidates: [],
}
const controller = {
  status: "ready",
  saveStatus: "saved",
  authoredSnapshot: fixture.authority,
  report: {
    mode: "read-write",
    snapshot: fixture.snapshot,
    historyItems: fixture.authority.history,
  },
} as unknown as DocumentControllerState
const report = controller.report
if (!report) throw new Error("The fixture requires a report.")
const result: QuickLightweightingResult = {
  schemaVersion: 1,
  mode: "open-organic",
  mesh: { vertices: Array.from(cube.mesh.positions), indices: Array.from(cube.mesh.indices) },
  requestedRemovalPercent: 50,
  removedPercent: 50,
  sourceVolumeMm3: 216,
  resultVolumeMm3: 108,
  cellSizeMm: 0.1875,
  skinThicknessMm: 0.46875,
  cellType: "gyroid",
  latticeCellSizeMm: 1.125,
  warnings: [],
}

function setup(initial = controller) {
  const panel = (state: DocumentControllerState) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <QuickLightweightingTaskPanel
        controller={state}
        initialPartId={firstPartId}
        blocked={false}
        onClose={ports.close}
      />
    </I18nProvider>
  )
  const view = render(panel(initial))
  return { ...view, update: (state: DocumentControllerState) => view.rerender(panel(state)) }
}
async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}
function applyButton() {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Apply lightweighting" })
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("The deferred promise was not initialized.")
  }
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
async function preparedPreview() {
  await advance(650)
  expect(screen.getByRole("img", { name: "Organic mesh preview" })).toBeTruthy()
  act(() => ports.previewReady(true))
  expect(applyButton().disabled).toBe(false)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("crypto", webcrypto)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.setPointerCapture = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  })
  ports.parts.mockReturnValue([{ part: firstPart, body: cube, status: "available" }])
  ports.generate.mockImplementation(async (input: QuickLightweightingInput) => ({
    ...result,
    mode: input.mode,
    requestedRemovalPercent: input.removalPercent,
    cellSizeMm: input.cellSizeMm,
    skinThicknessMm: input.skinThicknessMm,
    cellType: input.cellType ?? "gyroid",
    latticeCellSizeMm: input.latticeCellSizeMm ?? input.cellSizeMm * 6,
  }))
  ports.encode.mockReturnValue(new Uint8Array([1, 2, 3]))
  ports.structuralEncode.mockReturnValue(new Uint8Array([1, 2, 3]))
  ports.inspect.mockResolvedValue(meshInspection)
  ports.apply.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe("quick lightweighting task panel", () => {
  it("reports task submission success only after a validated save", async () => {
    setup()
    const submit = () => ports.registerSubmission.mock.lastCall?.[0]()
    await act(async () => expect(await submit()).toBe(false))
    expect(ports.apply).not.toHaveBeenCalled()
    await preparedPreview()
    ports.apply.mockResolvedValueOnce({ ok: false, diagnostic: { message: "Save failed." } })
    await act(async () => expect(await submit()).toBe(false))
    expect(ports.close).not.toHaveBeenCalled()
    await act(async () => expect(await submit()).toBe(true))
    expect(ports.close).toHaveBeenCalledTimes(1)
  })

  it("keeps the current pointer gesture locked when another slider loses focus", async () => {
    setup()
    const previous = screen.getByRole("slider", { name: /Requested removal/ })
    const current = screen.getByRole("slider", { name: "Sampling detail" })
    fireEvent.focus(previous)
    fireEvent(current, new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    fireEvent.blur(previous)
    fireEvent.lostPointerCapture(previous)
    fireEvent.keyUp(previous, { key: "ArrowRight" })
    fireEvent.change(current, { target: { value: "40" } })
    await advance(1200)
    expect(ports.generate).not.toHaveBeenCalled()
    fireEvent.pointerUp(current)
    await advance(650)
    expect(ports.generate).toHaveBeenCalledTimes(1)
    expect(ports.generate.mock.calls[0]?.[0]).toMatchObject({ cellSizeMm: 0.15 })
  })

  it("waits for all pointer and keyboard gestures on one slider to end", async () => {
    setup()
    const slider = screen.getByRole("slider", { name: /Requested removal/ })
    fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    fireEvent.keyDown(slider, { key: "ArrowRight" })
    fireEvent.keyDown(slider, { key: "ArrowUp" })
    fireEvent.change(slider, { target: { value: "70" } })
    fireEvent.keyUp(slider, { key: "ArrowRight" })
    await advance(1200)
    expect(ports.generate).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider)
    fireEvent.lostPointerCapture(slider)
    await advance(1200)
    expect(ports.generate).not.toHaveBeenCalled()
    fireEvent.keyUp(slider, { key: "ArrowUp" })
    await advance(650)
    expect(ports.generate).toHaveBeenCalledTimes(1)
    expect(ports.generate.mock.calls[0]?.[0]).toMatchObject({ removalPercent: 70 })
  })

  it.each([
    ["quick-removal", "60", "70", { removalPercent: 70 }],
    ["quick-cell-size", "0.25", "0.375", { latticeCellSizeMm: 2.25 }],
    ["quick-detail", "24", "40", { cellSizeMm: 0.15 }],
    ["quick-skin", "3", "4", { skinThicknessMm: 0.75 }],
  ])(
    "waits for the pointer gesture to end on %s, including pauses longer than debounce",
    async (id, first, final, expected) => {
      setup()
      if (id === "quick-skin")
        fireEvent.click(screen.getByRole("button", { name: "Keep exterior" }))
      const slider = document.getElementById(id)
      if (!slider) throw new Error("The slider must be mounted.")
      fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      fireEvent.change(slider, { target: { value: first } })
      await advance(1200)
      expect(ports.generate).not.toHaveBeenCalled()
      fireEvent.change(slider, { target: { value: final } })
      await advance(1200)
      expect(ports.generate).not.toHaveBeenCalled()
      expect(applyButton().disabled).toBe(true)
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Regenerate preview" }).disabled,
      ).toBe(true)
      fireEvent.pointerUp(slider)
      fireEvent.lostPointerCapture(slider)
      await advance(649)
      expect(ports.generate).not.toHaveBeenCalled()
      await advance(1)
      expect(ports.generate).toHaveBeenCalledTimes(1)
      expect(ports.generate.mock.calls[0]?.[0]).toMatchObject(expected)
    },
  )

  it.each(["pointerCancel", "lostPointerCapture", "blur"] as const)(
    "releases the gesture on %s and resumes the final preview",
    async (event) => {
      setup()
      const slider = screen.getByRole("slider", { name: /Requested removal/ })
      fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      fireEvent.change(slider, { target: { value: "65" } })
      await advance(1200)
      expect(ports.generate).not.toHaveBeenCalled()
      fireEvent[event](slider)
      await advance(650)
      expect(ports.generate).toHaveBeenCalledTimes(1)
      expect(ports.generate.mock.calls[0]?.[0]).toMatchObject({ removalPercent: 65 })
    },
  )

  it("cancels old work immediately and waits until a held slider key is released", async () => {
    const pending = deferred<QuickLightweightingResult>()
    ports.generate.mockReturnValueOnce(pending.promise)
    setup()
    await advance(650)
    const signal: AbortSignal = ports.generate.mock.calls[0]?.[1].signal
    const slider = screen.getByRole("slider", { name: /Requested removal/ })
    fireEvent.keyDown(slider, { key: "ArrowRight" })
    expect(signal.aborted).toBe(true)
    fireEvent.change(slider, { target: { value: "60" } })
    await advance(1200)
    fireEvent.keyDown(slider, { key: "ArrowRight", repeat: true })
    fireEvent.change(slider, { target: { value: "70" } })
    await advance(1200)
    expect(ports.generate).toHaveBeenCalledTimes(1)
    fireEvent.keyUp(slider, { key: "ArrowRight" })
    await advance(650)
    expect(ports.generate).toHaveBeenCalledTimes(2)
    expect(ports.generate.mock.calls[1]?.[0]).toMatchObject({ removalPercent: 70 })
    await act(async () => pending.resolve({ ...result, removedPercent: 99 }))
    expect(screen.getByText("Material removed: 50%")).toBeTruthy()
  })

  it("explains a geometry capacity failure and permits regeneration", async () => {
    ports.generate.mockRejectedValueOnce(new QuickLightweightingError("resource-limit", "capacity"))
    setup()
    await advance(650)
    expect(screen.getByText(messages.app.quickLightweighting.resourceLimit)).toBeTruthy()
    expect(applyButton().disabled).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Regenerate preview" }).disabled,
    ).toBe(false)
  })

  it("shows current batch progress, keeps cancellation available, and ignores stale progress", async () => {
    ports.generate.mockReturnValueOnce(deferred<QuickLightweightingResult>().promise)
    setup()
    await advance(650)
    const onProgress = ports.generate.mock.calls[0]?.[1].onProgress
    if (!onProgress) throw new Error("Expected generation progress callback.")
    act(() => onProgress("generating", { phase: "sampling", completed: 128, total: 256 }))
    expect(screen.getByRole("status").textContent).toBe("Sampling the source surface: 128 / 256")
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Cancel generation" }).disabled,
    ).toBe(false)
    act(() => onProgress("generating", { phase: "validation", completed: 64, total: 128 }))
    expect(screen.getByRole("status").textContent).toBe("Checking mesh surface samples: 64 / 128")
    fireEvent.change(screen.getByRole("slider", { name: /Requested removal/ }), {
      target: { value: "70" },
    })
    act(() => onProgress("generating", { phase: "sampling", completed: 256, total: 256 }))
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("automatically generates the preselected cube after 650 ms and gates Apply on preview readiness", async () => {
    setup()
    expect(screen.getByRole("combobox", { name: "Source Part" }).textContent).toContain(
      firstPartName,
    )
    expect(applyButton().disabled).toBe(true)
    await advance(649)
    expect(ports.generate).not.toHaveBeenCalled()
    await advance(1)
    expect(ports.generate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(messages.app.quickLightweighting.schwarzDSampling)).toBeNull()
    expect(ports.generate.mock.calls[0]?.[0]).toEqual({
      schemaVersion: 1,
      mesh: result.mesh,
      mode: "open-organic",
      removalPercent: 50,
      cellSizeMm: 0.1875,
      skinThicknessMm: 0.46875,
      cellType: "gyroid",
      latticeCellSizeMm: 1.125,
    })
    expect(ports.encode).toHaveBeenCalledTimes(1)
    expect(ports.structuralEncode).not.toHaveBeenCalled()
    expect(ports.inspect.mock.calls[0]?.[0]).toMatchObject({ format: "stl", units: "mm" })
    expect(applyButton().disabled).toBe(true)
    expect(screen.getByText(messages.app.quickLightweighting.inspecting)).toBeTruthy()
    act(() => ports.previewReady(true))
    expect(applyButton().disabled).toBe(false)
    await advance(2_000)
    expect(ports.generate).toHaveBeenCalledTimes(1)
    expect(ports.apply).not.toHaveBeenCalled()
  })

  it("debounces sliders and both modes, cancels old work, and ignores its late completion", async () => {
    const old = deferred<QuickLightweightingResult>()
    ports.generate.mockReturnValueOnce(old.promise)
    setup()
    await advance(650)
    const signal: AbortSignal = ports.generate.mock.calls[0]?.[1].signal
    fireEvent.change(screen.getByRole("slider", { name: /Requested removal/ }), {
      target: { value: "70" },
    })
    fireEvent.change(screen.getByRole("slider", { name: "Sampling detail" }), {
      target: { value: "40" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Keep exterior" }))
    fireEvent.change(screen.getByRole("slider", { name: /Skin thickness/ }), {
      target: { value: "4" },
    })
    expect(signal.aborted).toBe(true)
    await advance(649)
    expect(ports.generate).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(ports.generate).toHaveBeenCalledTimes(2)
    expect(ports.generate.mock.calls[1]?.[0]).toMatchObject({
      mesh: result.mesh,
      mode: "preserve-exterior",
      removalPercent: 70,
      cellSizeMm: 0.15,
      skinThicknessMm: 0.6,
    })
    await act(async () => old.resolve({ ...result, removedPercent: 99 }))
    expect(ports.inspect).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Material removed: 50%")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Open organic" }))
    expect(screen.queryByRole("img")).toBeNull()
    expect(applyButton().disabled).toBe(true)
    await advance(650)
    expect(ports.generate.mock.calls[2]?.[0]).toMatchObject({
      mode: "open-organic",
      removalPercent: 70,
      cellSizeMm: 0.15,
      skinThicknessMm: 0.6,
    })
  })

  it("samples the pristine mesh extent instead of tolerance-padded kernel bounds", async () => {
    ports.parts.mockReturnValue([
      {
        part: firstPart,
        status: "available",
        body: {
          ...cube,
          shape: {
            ...cube.shape,
            bounds: {
              min: [-0.0000001, -0.0000001, -0.0000001],
              max: [6.0000001, 6.0000001, 6.0000001],
            },
          },
        },
      },
    ])
    setup()
    fireEvent.click(screen.getByRole("button", { name: "Keep exterior" }))
    await advance(650)
    expect(ports.generate.mock.calls[0]?.[0]).toMatchObject({
      cellSizeMm: 0.1875,
      latticeCellSizeMm: 1.125,
      skinThicknessMm: 0.46875,
      mode: "preserve-exterior",
    })
  })

  it("aborts a pending worker when switching to either exterior mode", async () => {
    const open = deferred<QuickLightweightingResult>()
    const closed = deferred<QuickLightweightingResult>()
    ports.generate.mockReturnValueOnce(open.promise).mockReturnValueOnce(closed.promise)
    setup()
    await advance(650)
    const openSignal: AbortSignal = ports.generate.mock.calls[0]?.[1].signal
    fireEvent.click(screen.getByRole("button", { name: "Keep exterior" }))
    expect(openSignal.aborted).toBe(true)
    await advance(650)
    const closedSignal: AbortSignal = ports.generate.mock.calls[1]?.[1].signal
    expect(ports.generate.mock.calls[1]?.[0]).toMatchObject({
      mode: "preserve-exterior",
      skinThicknessMm: 0.46875,
      cellSizeMm: 0.1875,
    })
    fireEvent.click(screen.getByRole("button", { name: "Open organic" }))
    expect(closedSignal.aborted).toBe(true)
    await advance(650)
    expect(ports.generate.mock.calls[2]?.[0].mode).toBe("open-organic")
    await act(async () => {
      open.resolve(result)
      closed.resolve({ ...result, mode: "preserve-exterior" })
    })
    expect(ports.inspect).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: "Schwarz P", cellType: "schwarz-p", latticeCellSizeMm: 1.125 },
    { label: "Schwarz D", cellType: "schwarz-d", latticeCellSizeMm: 2.25 },
  ])(
    "generates $label cells and cancels the obsolete lattice preview",
    async ({ label, cellType, latticeCellSizeMm }) => {
      const old = deferred<QuickLightweightingResult>()
      ports.generate.mockReturnValueOnce(old.promise)
      setup()
      await advance(650)
      const signal: AbortSignal = ports.generate.mock.calls[0]?.[1].signal
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Cell type" }), { key: "Enter" })
      fireEvent.click(screen.getByRole("option", { name: label }))
      if (cellType === "schwarz-d")
        expect(screen.getByText(messages.app.quickLightweighting.schwarzDSampling)).toBeTruthy()
      else expect(screen.queryByText(messages.app.quickLightweighting.schwarzDSampling)).toBeNull()
      expect(signal.aborted).toBe(true)
      expect(applyButton().disabled).toBe(true)
      await act(async () => old.resolve(result))
      expect(ports.inspect).not.toHaveBeenCalled()
      await advance(650)
      expect(ports.generate.mock.calls[1]?.[0]).toMatchObject({
        mesh: result.mesh,
        cellType,
        latticeCellSizeMm,
      })
      expect(
        within(screen.getByRole("region", { name: "Measured geometry result" })).getByText(label),
      ).toBeTruthy()
    },
  )

  it("keeps physical cell size independent of detail and clamps it only outside six to twelve sampling spacings", async () => {
    setup()
    const period = () => screen.getByRole("slider", { name: /Cell size:/ })
    const detail = () => screen.getByRole("slider", { name: "Sampling detail" })
    fireEvent.change(period(), { target: { value: "0.25" } })
    await advance(650)
    expect(ports.generate.mock.lastCall?.[0]).toMatchObject({
      cellSizeMm: 0.1875,
      latticeCellSizeMm: 1.5,
    })
    act(() => ports.previewReady(true))
    fireEvent.change(detail(), { target: { value: "40" } })
    expect(screen.queryByRole("img")).toBeNull()
    expect(applyButton().disabled).toBe(true)
    await advance(650)
    expect(ports.generate.mock.lastCall?.[0]).toMatchObject({
      cellSizeMm: 0.15,
      latticeCellSizeMm: 1.5,
    })
    fireEvent.change(period(), { target: { value: "0.15" } })
    await advance(650)
    expect(ports.generate.mock.lastCall?.[0].latticeCellSizeMm).toBeCloseTo(0.9)
    fireEvent.change(detail(), { target: { value: "24" } })
    await advance(650)
    expect(ports.generate.mock.lastCall?.[0]).toMatchObject({
      cellSizeMm: 0.25,
      latticeCellSizeMm: 1.5,
    })
    fireEvent.change(period(), { target: { value: "0.5" } })
    await advance(650)
    expect(ports.generate.mock.lastCall?.[0].latticeCellSizeMm).toBe(3)
    fireEvent.change(detail(), { target: { value: "40" } })
    await advance(650)
    expect(ports.generate.mock.lastCall?.[0].cellSizeMm).toBe(0.15)
    expect(ports.generate.mock.lastCall?.[0].latticeCellSizeMm).toBeCloseTo(1.8)
  })

  it.each([
    ["revision", "ready"],
    ["content hash", "ready"],
    ["revision", "generating"],
    ["content hash", "generating"],
    ["revision", "inspecting"],
    ["content hash", "inspecting"],
  ])("rejects changed source %s while the preview is %s", async (change, stage) => {
    const old = deferred<QuickLightweightingResult>()
    const inspecting = deferred<typeof meshInspection>()
    if (stage === "generating") ports.generate.mockReturnValueOnce(old.promise)
    if (stage === "inspecting") ports.inspect.mockReturnValueOnce(inspecting.promise)
    const view = setup()
    if (stage === "ready") await preparedPreview()
    else await advance(650)
    const signal: AbortSignal = ports.generate.mock.calls[0]?.[1].signal
    if (change === "content hash")
      ports.parts.mockReturnValue([
        { part: firstPart, body: { ...cube, contentHash: "changed-cube" }, status: "available" },
      ])
    view.update({
      ...controller,
      report: {
        ...report,
        snapshot: {
          ...fixture.snapshot,
          revision: fixture.snapshot.revision + (change === "revision" ? 1 : 0),
        },
      },
    })
    if (stage !== "ready") expect(signal.aborted).toBe(true)
    expect(applyButton().disabled).toBe(true)
    expect(screen.queryByRole("img")).toBeNull()
    await act(async () => {
      old.resolve(result)
      inspecting.resolve(meshInspection)
    })
    expect(ports.inspect).toHaveBeenCalledTimes(stage === "generating" ? 0 : 1)
    expect(screen.queryByRole("img")).toBeNull()
    fireEvent.click(applyButton())
    expect(ports.apply).not.toHaveBeenCalled()
  })

  it("applies one append-only mesh import transaction while retaining the exact source", async () => {
    const saving = deferred<{ ok: true }>()
    ports.apply.mockReturnValueOnce(saving.promise)
    const before = structuredClone(fixture.authority)
    setup()
    await preparedPreview()
    fireEvent.click(applyButton())
    fireEvent.click(applyButton())
    expect(ports.apply).toHaveBeenCalledTimes(1)
    expect(applyButton().disabled).toBe(true)
    const [revision, transaction] = ports.apply.mock.calls[0] ?? []
    expect(revision).toBe(fixture.snapshot.revision)
    expect(transaction.commands.at(-1)).toMatchObject({
      kind: "org.vibeshape.history.insert-feature",
      payload: { feature: { type: { typeId: "org.vibeshape.feature.part-design.imported-mesh" } } },
    })
    expect(
      transaction.commands.every(
        ({ kind }: { kind: string }) => !kind.includes("delete") && !kind.includes("remove"),
      ),
    ).toBe(true)
    expect(fixture.authority).toEqual(before)
    await act(async () => saving.resolve({ ok: true }))
    expect(ports.close).toHaveBeenCalledTimes(1)
  })

  it.each(["exception", "diagnostic"])(
    "releases the Apply lock after a save %s and permits retry",
    async (failure) => {
      const diagnostic = "The document revision changed before saving."
      if (failure === "exception")
        ports.apply.mockRejectedValueOnce(new Error("storage unavailable"))
      else ports.apply.mockResolvedValueOnce({ ok: false, diagnostic: { message: diagnostic } })
      setup()
      await preparedPreview()
      fireEvent.click(applyButton())
      await advance(0)
      expect(screen.getByRole("alert").textContent).toBe(
        failure === "exception" ? messages.app.quickLightweighting.saveFailed : diagnostic,
      )
      expect(applyButton().disabled).toBe(false)
      expect(ports.close).not.toHaveBeenCalled()
      fireEvent.click(applyButton())
      await advance(0)
      expect(ports.apply).toHaveBeenCalledTimes(2)
      expect(ports.close).toHaveBeenCalledTimes(1)
    },
  )

  it("shows an accessible persistent reason and does not generate in a read-only project", async () => {
    setup({ ...controller, report: { ...report, mode: "read-only" } })
    await advance(2_000)
    expect(ports.generate).not.toHaveBeenCalled()
    expect(applyButton().disabled).toBe(true)
    const reasonId = applyButton().getAttribute("aria-describedby")
    expect(reasonId).toBeTruthy()
    expect(document.getElementById(reasonId ?? "")?.textContent).toContain(
      messages.app.quickLightweighting.blocked,
    )
    expect(screen.getAllByText(messages.app.quickLightweighting.blocked).length).toBeGreaterThan(0)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Regenerate preview" }).disabled,
    ).toBe(true)
  })
})
