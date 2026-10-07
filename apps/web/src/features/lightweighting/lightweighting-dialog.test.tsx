// @vitest-environment jsdom
import { webcrypto } from "node:crypto"
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ModelBodyGeometry } from "@vibeshape/application/model-bodies"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { StructuralOptimizationResult } from "@vibeshape/structural-optimization/contract"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import { authoredTreeFixture } from "../../test-support/authored-tree-fixture"
import { meshInspection } from "../import/import-test-fixtures"
import { LightweightingDialog } from "./lightweighting-dialog"
import { useLightweightingCommand } from "./use-lightweighting-command"

const ports = vi.hoisted(() => ({
  optimize: vi.fn(),
  inspect: vi.fn(),
  apply: vi.fn(),
  parts: vi.fn(),
  encode: vi.fn(),
}))
vi.mock("@vibeshape/application/authored-parts", () => ({ resolveAuthoredParts: ports.parts }))
vi.mock("@vibeshape/structural-optimization/client", () => ({
  optimizeStructuralModel: ports.optimize,
  StructuralOptimizationError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
}))
vi.mock("@vibeshape/structural-optimization/mesh", () => ({ encodeStructuralStl: ports.encode }))
vi.mock("../../document/document-controller", () => ({
  getProjectActiveWorkBlock: () => null,
  inspectTriangleMeshSource: ports.inspect,
  commitAuthoredTransaction: ports.apply,
}))
vi.mock("../import/import-preview", async () => {
  const { useEffect } = await import("react")
  return {
    ImportPreview: ({ onReady, label }: { onReady: (ready: boolean) => void; label: string }) => {
      useEffect(() => {
        onReady(true)
        return () => onReady(false)
      }, [onReady])
      return <div role="img" aria-label={label} />
    },
  }
})
const fixture = authoredTreeFixture()
const firstPart = fixture.authority.parts[0]
const bodyBinding = firstPart?.bodyHistory[0]
if (!firstPart || !bodyBinding) throw new Error("The fixture requires a Part and a body binding.")
const sourcePartName = firstPart.name
const body: ModelBodyGeometry = {
  featureId: bodyBinding.featureId,
  outputRole: "result",
  contentHash: "pristine-cad-hash",
  representation: "exact-solid",
  shape: {
    valid: true,
    volume: 24000,
    surfaceArea: 5200,
    solidCount: 1,
    faceCount: 6,
    edgeCount: 12,
    bounds: { min: [0, 0, 0], max: [20, 30, 40] },
  },
  mesh: {
    positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0, 40]),
    normals: new Float32Array(12),
    indices: new Uint32Array([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]),
    triangleFaceIds: new Uint32Array(4),
  },
  topologyCandidates: [],
}
const metrics = {
  volumeMm3: 20000,
  massKg: 0.024,
  maxVonMisesMpa: 5,
  maxDisplacementMm: 0.2,
  safetyFactor: 8,
  cases: [
    {
      name: "Load case 1",
      maxVonMisesMpa: 5,
      maxDisplacementMm: 0.2,
      safetyFactor: 8,
      complianceNmm: 2,
    },
  ],
}
const result: StructuralOptimizationResult = {
  schemaVersion: 1,
  status: "improved",
  mesh: { vertices: Array.from(body.mesh.positions), indices: Array.from(body.mesh.indices) },
  baseline: metrics,
  optimized: { ...metrics, volumeMm3: 16000, massKg: 0.0192 },
  sourceVolumeMm3: 24000,
  sourceVolumeLossFraction: 1 / 6,
  cellSizeMm: 4,
  initialCellCount: 100,
  finalCellCount: 80,
  iterations: 12,
  evaluations: 20,
  termination: "iteration-limit",
  warnings: [],
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
function setup(initial = controller, blocked = false, initialPartId = "") {
  const View = ({ state }: { state: DocumentControllerState }) => {
    const [open, setOpen] = useState(true)
    return (
      <I18nProvider i18n={i18n} initialLocale="en">
        <button type="button" onClick={() => setOpen(true)}>
          Open lightweighting
        </button>
        <LightweightingDialog
          controller={state}
          initialPartId={initialPartId}
          blocked={blocked}
          open={open}
          onOpenChange={setOpen}
        />
      </I18nProvider>
    )
  }
  const view = render(<View state={initial} />)
  return {
    ...view,
    update: (state: DocumentControllerState) => view.rerender(<View state={state} />),
  }
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}
async function fill() {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Source Part" }), { key: "Enter" })
  await userEvent.click(screen.getByRole("option", { name: sourcePartName }))
  change("Young’s modulus (MPa)", "2000")
  change("Poisson’s ratio", "0.3")
  change("Yield strength (MPa)", "40")
  change("Density (kg/m³)", "1200")
  change("Total force Z (N)", "-10")
}
async function analyze() {
  await userEvent.click(screen.getByRole("button", { name: "Analyze and optimize" }))
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Apply as new mesh Part" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  )
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal("crypto", webcrypto)
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
    value: function (this: File) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    },
  })
  ports.parts.mockReturnValue([{ part: firstPart, body, status: "available" }])
  ports.optimize.mockResolvedValue(result)
  ports.encode.mockReturnValue(new Uint8Array([1, 2, 3]))
  ports.inspect.mockResolvedValue(meshInspection)
  ports.apply.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
describe("Lightweighting workflow", () => {
  it("captures mouse body selection only when opening, and refuses ambiguous body ownership", () => {
    const { result, rerender } = renderHook(
      ({ selectedBody }) =>
        useLightweightingCommand({ controller, selectedPartId: null, selectedBody }),
      { initialProps: { selectedBody: { featureId: body.featureId, outputRole: "result" } } },
    )
    act(() => result.current.show())
    expect(result.current.initialPartId).toBe(firstPart.id)
    rerender({ selectedBody: { featureId: body.featureId, outputRole: "another-output" } })
    expect(result.current.initialPartId).toBe(firstPart.id)
    act(() => result.current.setOpen(false))
    act(() => result.current.show())
    expect(result.current.initialPartId).toBe("")
    ports.parts.mockReturnValue([
      { part: firstPart, status: "available", body },
      { part: { ...firstPart, id: "another-part" }, status: "available", body },
    ])
    rerender({ selectedBody: { featureId: body.featureId, outputRole: "result" } })
    act(() => result.current.show())
    expect(result.current.initialPartId).toBe("")
  })
  it("prefills a selected exact Part and its bounds, while unavailable targets stay explicit", () => {
    const view = setup(controller, false, firstPart.id)
    expect(screen.getByRole("combobox", { name: "Source Part" }).textContent).toBe(sourcePartName)
    expect((screen.getByLabelText("Voxel cell size (mm)") as HTMLInputElement).value).toBe("4")
    expect((screen.getByLabelText("Young’s modulus (MPa)") as HTMLInputElement).value).toBe("")
    view.unmount()
    setup(controller, false, "missing-part")
    expect(screen.getByRole("combobox", { name: "Source Part" }).textContent).toBe(
      "Choose an exact solid Part",
    )
    expect(ports.optimize).not.toHaveBeenCalled()
  })

  it("fills editable preset values, preserves constraints, and labels manual edits as custom", async () => {
    setup(controller, false, firstPart.id)
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Material preset" }), { key: "Enter" })
    await userEvent.click(screen.getByRole("option", { name: "PETG — UltiMaker" }))
    expect((screen.getByLabelText("Young’s modulus (MPa)") as HTMLInputElement).value).toBe("1939")
    expect((screen.getByLabelText("Poisson’s ratio") as HTMLInputElement).value).toBe("0.35")
    expect((screen.getByLabelText("Yield strength (MPa)") as HTMLInputElement).value).toBe("46.2")
    expect((screen.getByLabelText("Density (kg/m³)") as HTMLInputElement).value).toBe("1270")
    expect((screen.getByLabelText("Required safety factor") as HTMLInputElement).value).toBe("2")
    expect(
      screen.getByRole("link", { name: "Manufacturer data sheet 1" }).getAttribute("href"),
    ).toContain("Ultimaker-PETG-TDS-v1.00.pdf")
    change("Total force Z (N)", "-10")
    change("Required safety factor", "3")
    expect(screen.getByRole("combobox", { name: "Material preset" }).textContent).toBe(
      "PETG — UltiMaker",
    )
    change("Young’s modulus (MPa)", "1800")
    expect(screen.getByRole("combobox", { name: "Material preset" }).textContent).toBe(
      "Custom material",
    )
    expect((screen.getByLabelText("Density (kg/m³)") as HTMLInputElement).value).toBe("1270")
    expect(screen.queryByRole("link", { name: "Manufacturer data sheet 1" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Analyze and optimize" }))
    await waitFor(() => expect(ports.optimize).toHaveBeenCalledOnce())
    expect(ports.optimize.mock.calls[0]?.[0].material).toEqual({
      youngModulusMpa: 1800,
      poissonRatio: 0.35,
      yieldStrengthMpa: 46.2,
      densityKgM3: 1270,
    })
  })

  it("invalidates a completed result when a different material preset is chosen", async () => {
    setup()
    await fill()
    await analyze()
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Material preset" }), { key: "Enter" })
    await userEvent.click(screen.getByRole("option", { name: "PLA — Prusament" }))
    expect(
      (screen.getByRole("button", { name: "Apply as new mesh Part" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
  })

  it("requires explicit exact Part, material values, and a nonzero force before analysis", async () => {
    setup()
    expect(
      (screen.getByRole("button", { name: "Analyze and optimize" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect((screen.getByLabelText("Young’s modulus (MPa)") as HTMLInputElement).value).toBe("")
    await fill()
    expect(
      (screen.getByRole("button", { name: "Analyze and optimize" }) as HTMLButtonElement).disabled,
    ).toBe(false)
    change("Total force Z (N)", "0")
    expect(
      (screen.getByRole("button", { name: "Analyze and optimize" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(ports.optimize).not.toHaveBeenCalled()
  })
  it("uses pristine source mesh and editable exact slab coordinates; Apply only appends a mesh feature", async () => {
    setup()
    await fill()
    await analyze()
    const input = ports.optimize.mock.calls[0]?.[0]
    expect(input.mesh).toEqual({
      vertices: Array.from(body.mesh.positions),
      indices: Array.from(body.mesh.indices),
    })
    expect(input.supports).toEqual([{ min: [0, 0, 0], max: [2, 30, 40] }])
    expect(input.loadCases).toEqual([
      { name: "Load case 1", region: { min: [18, 0, 0], max: [20, 30, 40] }, forceN: [0, 0, -10] },
    ])
    expect(input.maxIterations).toBe(12)
    expect(ports.inspect.mock.calls[0]?.[0]).toMatchObject({ format: "stl", units: "mm" })
    expect(ports.apply).not.toHaveBeenCalled()
    await userEvent.dblClick(screen.getByRole("button", { name: "Apply as new mesh Part" }))
    expect(ports.apply).toHaveBeenCalledOnce()
    const [revision, transaction] = ports.apply.mock.calls[0] ?? []
    expect(revision).toBe(fixture.snapshot.revision)
    const commands = transaction.commands
    expect(commands.at(-1).kind).toBe("org.vibeshape.history.insert-feature")
    expect(commands.at(-1).payload.feature.type.typeId).toBe(
      "org.vibeshape.feature.part-design.imported-mesh",
    )
    expect(
      commands.every(
        ({ kind }: { kind: string }) => !kind.includes("delete") && !kind.includes("remove"),
      ),
    ).toBe(true)
    expect(fixture.authority.parts).toHaveLength(3)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
  it("cancels a single-flight solve on Close and ignores a late response after reopening", async () => {
    const work = deferred<StructuralOptimizationResult>()
    ports.optimize.mockReturnValueOnce(work.promise)
    setup()
    await fill()
    await userEvent.dblClick(screen.getByRole("button", { name: "Analyze and optimize" }))
    expect(ports.optimize).toHaveBeenCalledOnce()
    const signal = ports.optimize.mock.calls[0]?.[1].signal as AbortSignal
    await userEvent.click(within(screen.getByRole("dialog")).getByText("Close"))
    expect(signal.aborted).toBe(true)
    work.resolve(result)
    await userEvent.click(screen.getByRole("button", { name: "Open lightweighting" }))
    expect(screen.queryByRole("img")).toBeNull()
    expect(ports.inspect).not.toHaveBeenCalled()
  })
  it("input edits cancel work and late responses cannot replace a newer result", async () => {
    const old = deferred<StructuralOptimizationResult>()
    ports.optimize.mockReturnValueOnce(old.promise)
    setup()
    await fill()
    await userEvent.click(screen.getByRole("button", { name: "Analyze and optimize" }))
    const signal = ports.optimize.mock.calls[0]?.[1].signal as AbortSignal
    change("Maximum iterations", "13")
    expect(signal.aborted).toBe(true)
    await analyze()
    old.resolve({ ...result, optimized: { ...result.optimized, volumeMm3: 1 } })
    await waitFor(() => expect(ports.inspect).toHaveBeenCalledOnce())
    expect(screen.getByText("Material saved relative to the voxel baseline: 20%.")).toBeTruthy()
    expect(ports.optimize.mock.calls[1]?.[0].maxIterations).toBe(13)
  })
  it.each([
    "Young’s modulus (MPa)",
    "Poisson’s ratio",
    "Yield strength (MPa)",
    "Density (kg/m³)",
    "Required safety factor",
    "Maximum displacement (mm)",
    "Voxel cell size (mm)",
    "Maximum iterations",
    "Case name",
    "Total force X (N)",
  ])("clears ready analysis when %s changes", async (label) => {
    setup()
    await fill()
    await analyze()
    change(label, label === "Case name" ? "Second case name" : "3")
    expect(screen.queryByRole("img")).toBeNull()
    expect(
      (screen.getByRole("button", { name: "Apply as new mesh Part" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
  it("clears ready results for region or preservation changes", async () => {
    setup()
    await fill()
    await analyze()
    fireEvent.change(
      within(screen.getByRole("group", { name: "Fully fixed support region (mm)" })).getByLabelText(
        "Minimum X (mm)",
      ),
      { target: { value: "0.2" } },
    )
    expect(screen.queryByRole("img")).toBeNull()
    await analyze()
    await userEvent.click(screen.getByRole("button", { name: "Add preservation region" }))
    expect(screen.queryByRole("img")).toBeNull()
  })
  it("rejects changed document revision and body content without silently selecting another Part", async () => {
    const view = setup()
    await fill()
    await analyze()
    ports.parts.mockReturnValue([
      { part: firstPart, body: { ...body, contentHash: "changed-hash" }, status: "available" },
    ])
    view.update({
      ...controller,
      report: {
        ...report,
        snapshot: { ...fixture.snapshot, revision: fixture.snapshot.revision + 1 },
      },
    })
    expect(screen.queryByRole("img")).toBeNull()
    expect(
      (screen.getByRole("button", { name: "Apply as new mesh Part" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(screen.getByRole("combobox", { name: "Source Part" }).textContent).toContain(
      firstPart?.name,
    )
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("does not publish a late result when source content changes during solve", async () => {
    const work = deferred<StructuralOptimizationResult>()
    ports.optimize.mockReturnValueOnce(work.promise)
    const view = setup()
    await fill()
    await userEvent.click(screen.getByRole("button", { name: "Analyze and optimize" }))
    ports.parts.mockReturnValue([
      { part: firstPart, body: { ...body, contentHash: "new-body" }, status: "available" },
    ])
    view.update({ ...controller })
    work.resolve(result)
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Analyze and optimize" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    )
    expect(screen.queryByRole("img")).toBeNull()
    expect(ports.inspect).not.toHaveBeenCalled()
  })
  it("shows no-improvement evidence without enabling Apply", async () => {
    ports.optimize.mockResolvedValue({
      ...result,
      status: "no-improvement",
      optimized: result.baseline,
    })
    setup()
    await fill()
    await userEvent.click(screen.getByRole("button", { name: "Analyze and optimize" }))
    await waitFor(() =>
      expect(screen.getByText(messages.app.lightweighting.noImprovement)).toBeTruthy(),
    )
    expect(
      (screen.getByRole("button", { name: "Apply as new mesh Part" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("supports explicit baseline-only analysis with zero optimization iterations", async () => {
    ports.optimize.mockResolvedValue({
      ...result,
      status: "no-improvement",
      optimized: result.baseline,
      iterations: 0,
    })
    setup()
    await fill()
    change("Maximum iterations", "0")
    await userEvent.click(screen.getByRole("button", { name: "Analyze and optimize" }))
    await waitFor(() =>
      expect(screen.getByText(messages.app.lightweighting.noImprovement)).toBeTruthy(),
    )
    expect(ports.optimize.mock.calls[0]?.[0].maxIterations).toBe(0)
    expect(
      (screen.getByRole("button", { name: "Apply as new mesh Part" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
  it("releases the Apply lock on rejection and retries the retained mesh snapshot", async () => {
    ports.apply.mockRejectedValueOnce(new Error("Storage is unavailable"))
    setup()
    await fill()
    await analyze()
    await userEvent.click(screen.getByRole("button", { name: "Apply as new mesh Part" }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(messages.app.lightweighting.saveFailed),
    )
    expect(
      (screen.getByRole("button", { name: "Apply as new mesh Part" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Apply as new mesh Part" }))
    expect(ports.apply).toHaveBeenCalledTimes(2)
    expect(ports.optimize).toHaveBeenCalledOnce()
  })
  it("downloads settings, numerical metrics, and captured source identity", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:lightweighting-report")
    const NativeURL = URL
    vi.stubGlobal(
      "URL",
      class extends NativeURL {
        static createObjectURL = createObjectURL
        static revokeObjectURL = vi.fn()
      },
    )
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    setup()
    await fill()
    await analyze()
    await userEvent.click(screen.getByRole("button", { name: "Download analysis report (JSON)" }))
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob | undefined
    if (!blob) throw new Error("The report download requires a Blob.")
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    })
    const report = JSON.parse(text)
    expect(report.source).toMatchObject({
      documentId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      partId: firstPart.id,
      contentHash: "pristine-cad-hash",
      outputRole: "result",
    })
    expect(report.settings.material).toEqual({
      youngModulusMpa: 2000,
      poissonRatio: 0.3,
      yieldStrengthMpa: 40,
      densityKgM3: 1200,
    })
    expect(report.result.optimized.volumeMm3).toBe(16000)
    expect(report.result).not.toHaveProperty("mesh")
    expect(report.settings).not.toHaveProperty("mesh")
    expect(ports.apply).not.toHaveBeenCalled()
    click.mockRestore()
  })
  it("keeps the unavailable selected Part explicit and clears evidence", async () => {
    const view = setup()
    await fill()
    await analyze()
    ports.parts.mockReturnValue([])
    view.update({ ...controller })
    expect(screen.getByRole("alert").textContent).toBe(messages.app.lightweighting.partUnavailable)
    expect(screen.queryByRole("img")).toBeNull()
    expect(
      (screen.getByRole("button", { name: "Apply as new mesh Part" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(ports.optimize).toHaveBeenCalledOnce()
  })
  it("cancels analysis explicitly and releases failed analysis for retry", async () => {
    const work = deferred<StructuralOptimizationResult>()
    ports.optimize.mockReturnValueOnce(work.promise)
    setup()
    await fill()
    await userEvent.click(screen.getByRole("button", { name: "Analyze and optimize" }))
    const signal = ports.optimize.mock.calls[0]?.[1].signal as AbortSignal
    await userEvent.click(screen.getByRole("button", { name: "Cancel analysis" }))
    expect(signal.aborted).toBe(true)
    ports.optimize.mockRejectedValueOnce(new Error("Numerical solve failed"))
    await userEvent.click(screen.getByRole("button", { name: "Analyze and optimize" }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(messages.app.lightweighting.failed),
    )
    await analyze()
    work.resolve(result)
    await waitFor(() => expect(ports.inspect).toHaveBeenCalledOnce())
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("keeps read-only and blocked sessions unavailable", async () => {
    setup({ ...controller, report: { ...report, mode: "read-only" } }, true)
    expect(
      (screen.getByRole("button", { name: "Analyze and optimize" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole("combobox", { name: "Source Part" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
