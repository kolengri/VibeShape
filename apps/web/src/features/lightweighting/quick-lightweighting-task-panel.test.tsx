// @vitest-environment jsdom
import { webcrypto } from "node:crypto"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { ModelBodyGeometry } from "@vibeshape/application/model-bodies"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type {
  QuickLightweightingInput,
  QuickLightweightingResult,
} from "@vibeshape/structural-optimization/quick-contract"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import { authoredTreeFixture } from "../../test-support/authored-tree-fixture"
import { meshInspection } from "../import/import-test-fixtures"
import { QuickLightweightingTaskPanel } from "./quick-lightweighting-task-panel"

const ports = vi.hoisted(() => ({
  generate: vi.fn(),
  encode: vi.fn(),
  structuralEncode: vi.fn(),
  inspect: vi.fn(),
  apply: vi.fn(),
  parts: vi.fn(),
  previewReady: vi.fn(),
  close: vi.fn(),
}))
vi.mock("@vibeshape/application/authored-parts", () => ({ resolveAuthoredParts: ports.parts }))
vi.mock("@vibeshape/structural-optimization/quick-client", () => ({
  generateQuickLightweighting: ports.generate,
  encodeQuickLightweightingStl: ports.encode,
  QuickLightweightingError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
}))
vi.mock("@vibeshape/structural-optimization/mesh", () => ({
  encodeStructuralStl: ports.structuralEncode,
}))
vi.mock("../../document/document-controller", () => ({
  inspectTriangleMeshSource: ports.inspect,
  commitAuthoredTransaction: ports.apply,
}))
vi.mock("../import/import-preview", async () => {
  const { useEffect } = await import("react")
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
  it("automatically generates the preselected cube after 650 ms and gates Apply on preview readiness", async () => {
    setup()
    expect(screen.getByRole("combobox", { name: "Source Part" }).textContent).toContain(
      firstPartName,
    )
    expect(applyButton().disabled).toBe(true)
    await advance(649)
    expect(ports.generate).not.toHaveBeenCalled()
    await advance(1)
    expect(ports.generate).toHaveBeenCalledOnce()
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
    expect(ports.encode).toHaveBeenCalledOnce()
    expect(ports.structuralEncode).not.toHaveBeenCalled()
    expect(ports.inspect.mock.calls[0]?.[0]).toMatchObject({ format: "stl", units: "mm" })
    expect(applyButton().disabled).toBe(true)
    expect(screen.getByText(messages.app.quickLightweighting.inspecting)).toBeTruthy()
    act(() => ports.previewReady(true))
    expect(applyButton().disabled).toBe(false)
    await advance(2_000)
    expect(ports.generate).toHaveBeenCalledOnce()
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
    expect(ports.generate).toHaveBeenCalledOnce()
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
    expect(ports.inspect).toHaveBeenCalledOnce()
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
    expect(ports.inspect).toHaveBeenCalledOnce()
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
    expect(ports.apply).toHaveBeenCalledOnce()
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
    expect(ports.close).toHaveBeenCalledOnce()
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
      expect(ports.close).toHaveBeenCalledOnce()
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
