import "../../../../../tests/unit/support/dom"

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ModelBodyGeometry } from "@vibeshape/application/model-bodies"
import type {
  StructuralOptimizationInput,
  StructuralOptimizationResult,
} from "@vibeshape/structural-optimization/contract"
import { StructuralOptimizationError } from "../../../../../packages/structural-optimization/src/errors"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"

import type { LightweightingViewportInteraction } from "./lightweighting-dialog"

const ports = (() => ({
  optimize: vi.fn(),
  inspect: vi.fn(),
  apply: vi.fn(),
  parts: vi.fn(),
  encode: vi.fn(),
  exact: vi.fn(),
}))()
mock.module("@vibeshape/application/authored-parts", () => ({ resolveAuthoredParts: ports.parts }))
mock.module("@vibeshape/structural-optimization/client", () => ({
  optimizeStructuralModel: ports.optimize,
  StructuralOptimizationError,
}))
mock.module("./prepare-exact-print-snapshot", () => ({ prepareExactPrintSnapshot: ports.exact }))
const structuralMeshModule = { ...(await import("@vibeshape/structural-optimization/mesh")) }
mock.module("@vibeshape/structural-optimization/mesh", () => ({
  ...structuralMeshModule,
  encodeStructuralSnapshot: ports.encode,
}))
mock.module("../../document/document-controller", () => ({
  getProjectActiveWorkBlock: () => null,
  inspectTriangleMeshSource: ports.inspect,
  commitAuthoredTransaction: ports.apply,
}))
const mockDependency1 = await import("react")
mock.module("../import/import-preview", () => {
  const { useEffect } = mockDependency1
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

const { webcrypto } = await import("node:crypto")
const { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } = await import(
  "@testing-library/react"
)
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { useCallback, useState } = await import("react")
const { i18n } = await import("../../i18n")
const { default: messages } = await import("../../i18n/messages/en.json")
const { authoredTreeFixture } = await import("../../test-support/authored-tree-fixture")
const { meshInspection, inspection: exactInspection } = await import(
  "../import/import-test-fixtures"
)
const { LightweightingTaskPanel } = await import("./lightweighting-dialog")
const { PrintOptimizationTaskPanel } = await import("./print-optimization-task-panel")
const { LightweightingWorkspace } = await import("./lightweighting-workspace")
const { useWorkspaceTask } = await import("../../shell/workspace-task-context")
const { useLightweightingCommand } = await import("./use-lightweighting-command")
const fixture = authoredTreeFixture()
const firstPartCandidate = fixture.authority.parts[0]
const bodyBinding = firstPartCandidate?.bodyHistory[0]
if (!firstPartCandidate || !bodyBinding)
  throw new Error("The fixture requires a Part and a body binding.")
const firstPart = firstPartCandidate
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
    triangleFaceIds: new Uint32Array([1, 2, 3, 4]),
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
let viewportInteraction: LightweightingViewportInteraction | null = null
function receiveInteraction(next: LightweightingViewportInteraction | null) {
  viewportInteraction = next
}
function setup(
  initial = controller,
  blocked = false,
  initialPartId = "",
  callbacks: {
    onApplied?: () => void
    onApplyingChange?: (applying: boolean) => void
  } = {},
  generative = false,
) {
  const View = ({ state }: { state: DocumentControllerState }) => {
    const [open, setOpen] = useState(true)
    return (
      <I18nProvider i18n={i18n} initialLocale="en">
        <button type="button" onClick={() => setOpen(true)}>
          Open lightweighting
        </button>
        {open && (
          <LightweightingTaskPanel
            generative={generative}
            controller={state}
            initialPartId={initialPartId}
            blocked={blocked}
            onClose={() => setOpen(false)}
            onInteractionChange={receiveInteraction}
            {...callbacks}
          />
        )}
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
  fireEvent.change(screen.getByLabelText(label, { selector: "input" }), { target: { value } })
}
async function pickFaces() {
  await userEvent.click(screen.getByRole("button", { name: "Pick support faces" }))
  act(() =>
    viewportInteraction?.onFacePick({
      featureId: body.featureId,
      outputRole: "result",
      faceId: 1,
      faceOrdinal: 1,
    }),
  )
  await userEvent.click(screen.getByRole("button", { name: "Pick load faces for case 1" }))
  act(() =>
    viewportInteraction?.onFacePick({
      featureId: body.featureId,
      outputRole: "result",
      faceId: 2,
      faceOrdinal: 2,
    }),
  )
}
async function fill() {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Source Part" }), { key: "Enter" })
  await userEvent.click(screen.getByRole("option", { name: sourcePartName }))
  const materialDetails = screen.queryByText("Material properties and references", {
    selector: "summary",
  })
  if (materialDetails) await userEvent.click(materialDetails)
  change("Young’s modulus (MPa)", "2000")
  change("Poisson’s ratio", "0.3")
  change("Yield strength (MPa)", "40")
  change("Density (kg/m³)", "1200")
  change("Total force for case 1 (N)", "10")
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Direction for case 1" }), {
    key: "Enter",
  })
  await userEvent.click(screen.getByRole("option", { name: "Positive Z axis" }))
  await userEvent.click(screen.getByRole("button", { name: "Reverse direction for case 1" }))
  await pickFaces()
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
  ports.encode.mockReturnValue({
    bytes: new Uint8Array([1, 2, 3]),
    format: "stl",
    mediaType: "model/stl",
  })
  ports.inspect.mockResolvedValue(meshInspection)
  ports.apply.mockResolvedValue({ ok: true })
})

describe("Generative Design workflow", () => {
  async function generate() {
    await userEvent.click(screen.getByRole("button", { name: "Generate alternatives" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preview candidate 3" })).toBeTruthy(),
    )
  }

  it("guides a first run from missing material to one preview without editing advanced parameters", async () => {
    setup(controller, false, firstPart.id, {}, true)
    const generateButton = screen.getByRole("button", {
      name: "Generate alternatives",
    }) as HTMLButtonElement
    expect(generateButton.disabled).toBe(true)
    const setupAction = screen.getByRole("button", { name: "Choose the material" })
    expect(generateButton.closest("[data-slot=task-panel-footer]")).not.toBeNull()
    expect(setupAction.closest("[data-slot=task-panel-content]")).not.toBeNull()
    const reason = document.getElementById(generateButton.getAttribute("aria-describedby") ?? "")
    expect(reason?.closest("[data-slot=task-panel-content]")).not.toBeNull()
    expect(reason?.closest("footer")).toBeNull()
    expect([...document.querySelectorAll("details")].every((details) => !details.open)).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Choose the material" }))
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Material preset" }))
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Material preset" }), { key: "Enter" })
    await userEvent.click(screen.getByRole("option", { name: "PLA — Prusament" }))
    await userEvent.click(screen.getByRole("button", { name: "Select the fixed faces" }))
    expect(viewportInteraction?.picking).toBe(true)
    act(() =>
      viewportInteraction?.onFacePick({
        featureId: body.featureId,
        outputRole: "result",
        faceId: 1,
        faceOrdinal: 1,
      }),
    )
    expect(generateButton.disabled).toBe(true)
    await userEvent.click(
      screen.getByRole("button", { name: "Select the loaded faces for case 1" }),
    )
    act(() =>
      viewportInteraction?.onFacePick({
        featureId: body.featureId,
        outputRole: "result",
        faceId: 2,
        faceOrdinal: 2,
      }),
    )
    await userEvent.click(screen.getByRole("button", { name: "Enter the force for case 1" }))
    expect(document.activeElement).toBe(screen.getByLabelText("Total force for case 1 (N)"))
    change("Total force for case 1 (N)", "10")
    expect(generateButton.disabled).toBe(false)
    expect([...document.querySelectorAll("details")].every((details) => !details.open)).toBe(true)
    await userEvent.click(generateButton)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preview candidate 1" })).toBeTruthy(),
    )
    expect(ports.optimize).toHaveBeenCalledTimes(1)
    expect(ports.optimize.mock.calls[0]?.[0].objective).toEqual({
      kind: "maximize-stiffness",
      retainedMassFraction: 0.7,
    })
    expect(ports.optimize.mock.calls[0]?.[0].material.youngModulusMpa).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole("button", { name: "Remove 15% of the weight" }))
    expect(screen.queryByRole("region", { name: "Design candidates" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply as new mesh Part" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Remove 15% of the weight" }).getAttribute("aria-pressed"),
    ).toBe("true")
  })

  it("keeps invalid collapsed settings blocking generation and opens them for correction", async () => {
    setup(controller, false, "", {}, true)
    await fill()
    const printer = screen.getByText("Printer settings", { selector: "summary" })
    await userEvent.click(printer)
    change("Layer height (mm)", "5")
    await userEvent.click(printer)
    expect((printer.parentElement as HTMLDetailsElement).open).toBe(false)
    expect(
      (screen.getByRole("button", { name: "Generate alternatives" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Review the settings" }))
    expect((printer.parentElement as HTMLDetailsElement).open).toBe(true)
    change("Layer height (mm)", "0.2")
    expect(
      (screen.getByRole("button", { name: "Generate alternatives" }) as HTMLButtonElement).disabled,
    ).toBe(false)
    expect(ports.optimize).not.toHaveBeenCalled()
  })

  it("reveals a collapsed invalid material field inside the form without moving workspace ancestors", async () => {
    setup(controller, false, "", {}, true)
    await fill()
    change("Poisson’s ratio", "0.8")
    const summary = screen.getByText("Material properties and references", { selector: "summary" })
    await userEvent.click(summary)
    const panel = screen.getByRole("region", { name: "Generative Design" })
    const scroller = panel.querySelector<HTMLElement>("[data-slot=task-panel-content]")
    if (!scroller) throw new Error("Missing generative form scroll container.")
    scroller.scrollTop = 400
    const field = screen.getByLabelText("Poisson’s ratio")
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 500,
    } as DOMRect)
    vi.spyOn(field, "getBoundingClientRect").mockReturnValue({ top: -100, bottom: -68 } as DOMRect)
    const focus = vi.spyOn(field, "focus")
    await userEvent.click(screen.getByRole("button", { name: "Review the settings" }))
    expect((summary.parentElement as HTMLDetailsElement).open).toBe(true)
    expect(scroller.scrollTop).toBe(200)
    expect(document.activeElement).toBe(field)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(
      (screen.getByRole("button", { name: "Generate alternatives" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("passes both FDM support policies to every scenario and invalidates obsolete candidates", async () => {
    ports.optimize.mockImplementation(async (input: StructuralOptimizationInput) => {
      if (!input.fdm) throw new Error("The study must capture FDM settings.")
      const fdmMetrics = {
        unsupportedAreaMm2: input.fdm.supportMode === "allowed" ? 8 : 0,
        requiresSupports: input.fdm.supportMode === "allowed",
        minFeatureSizeBoundMm: 3.99999,
        buildHeightMm: 20,
      }
      return {
        ...result,
        fdm: {
          settings: input.fdm,
          approximation: "conservative-voxel",
          minimumFeatureCubeCells: 1,
          horizontalReachMm: 0.14,
          buildPlateCoordinateMm: 20,
          baseline: fdmMetrics,
          optimized: fdmMetrics,
        },
      }
    })
    setup(controller, false, "", {}, true)
    await fill()
    change("Retained mass targets (%)", "35, 50, 70")
    expect(screen.getByRole("combobox", { name: "Support policy" }).textContent).toBe(
      "Supports allowed",
    )
    change("Minimum feature size (mm)", "")
    expect(
      (screen.getByRole("button", { name: "Generate alternatives" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    change("Minimum feature size (mm)", "0.5")
    change("Layer height (mm)", "5")
    expect(
      (screen.getByRole("button", { name: "Generate alternatives" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    change("Layer height (mm)", "0.2")
    change("Maximum overhang from vertical (degrees)", "90")
    expect(
      (screen.getByRole("button", { name: "Generate alternatives" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    change("Maximum overhang from vertical (degrees)", "35")
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Support policy" }), { key: "Enter" })
    await userEvent.click(screen.getByRole("option", { name: "Without supports" }))
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Build direction" }), { key: "Enter" })
    await userEvent.click(screen.getByRole("option", { name: "Build toward -X" }))
    await generate()
    expect(
      screen.getAllByText("No unsupported area under the selected conservative limits.").length,
    ).toBeGreaterThanOrEqual(3)
    for (const call of ports.optimize.mock.calls)
      expect(call[0].fdm).toEqual({
        buildDirection: "-x",
        supportMode: "forbidden",
        minFeatureSizeMm: 0.5,
        layerHeightMm: 0.2,
        maxOverhangAngleDeg: 35,
      })
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Support policy" }), { key: "Enter" })
    await userEvent.click(screen.getByRole("option", { name: "Supports allowed" }))
    expect(screen.queryByRole("region", { name: "Design candidates" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply as new mesh Part" })).toBeNull()
    await generate()
    expect(ports.optimize).toHaveBeenCalledTimes(6)
    for (const call of ports.optimize.mock.calls.slice(3))
      expect(call[0].fdm.supportMode).toBe("allowed")
    const demand = screen.getAllByRole("region", { name: "FDM support demand" })
    for (const item of demand)
      expect(
        within(item).getByText("Area requiring support (mm²)").nextElementSibling?.textContent,
      ).toBe("8")
    expect(
      screen.getAllByText("This orientation requires supports under the selected limits.").length,
    ).toBeGreaterThanOrEqual(3)
    expect(ports.apply).not.toHaveBeenCalled()
  })

  it("compares independently analyzed targets and previews another candidate without rerunning FEM", async () => {
    ports.optimize.mockImplementation(
      async (input: { objective: { retainedMassFraction: number } }) => {
        const fraction = input.objective.retainedMassFraction
        return {
          ...result,
          optimized: { ...result.optimized, massKg: fraction * 0.024 },
          mesh: { ...result.mesh, vertices: result.mesh.vertices.map((value) => value * fraction) },
        }
      },
    )
    setup(controller, false, "", {}, true)
    await fill()
    change("Retained mass targets (%)", "35, 50, 70")
    expect(screen.queryByRole("combobox", { name: "Optimization objective" })).toBeNull()
    await generate()
    expect(ports.optimize).toHaveBeenCalledTimes(3)
    expect(ports.optimize.mock.calls.map((call) => call[0].objective.retainedMassFraction)).toEqual(
      [0.35, 0.5, 0.7],
    )
    await waitFor(() => expect(ports.inspect).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole("button", { name: "Preview candidate 3" }))
    await waitFor(() => expect(ports.inspect).toHaveBeenCalledTimes(2))
    expect(ports.optimize).toHaveBeenCalledTimes(3)
    expect(
      screen.getByRole("button", { name: "Preview candidate 3" }).getAttribute("aria-pressed"),
    ).toBe("true")
    await userEvent.click(screen.getByRole("button", { name: "Apply as new mesh Part" }))
    await waitFor(() => expect(ports.apply).toHaveBeenCalledTimes(1))
    expect(
      ports.apply.mock.calls[0]?.[1].commands.map(
        (command: { payload: unknown }) => command.payload,
      ),
    ).toContainEqual({ kind: "part.set-visibility", partId: firstPart.id, visible: false })
  })

  it("validates search settings and cancels stale studies when mass targets change", async () => {
    const old = deferred<StructuralOptimizationResult>()
    ports.optimize.mockReturnValueOnce(old.promise)
    setup(controller, false, "", {}, true)
    await fill()
    change("Retained mass targets (%)", "35, 50, 70")
    change("Retained mass targets (%)", "35, 35")
    expect(
      (screen.getByRole("button", { name: "Generate alternatives" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    change("Retained mass targets (%)", "35, 50, 70")
    await userEvent.click(screen.getByRole("button", { name: "Generate alternatives" }))
    const signal = ports.optimize.mock.calls[0]?.[1].signal as AbortSignal
    change("Retained mass targets (%)", "40, 60, 80")
    expect(signal.aborted).toBe(true)
    old.resolve(result)
    await generate()
    await waitFor(() => expect(ports.inspect).toHaveBeenCalledTimes(1))
    expect(
      ports.optimize.mock.calls.slice(1).map((call) => call[0].objective.retainedMassFraction),
    ).toEqual([0.4, 0.6, 0.8])
  })

  it("passes more than eight keep-out regions from the editor to the solver", async () => {
    setup(controller, false, "", {}, true)
    await fill()
    for (let index = 1; index <= 9; index++) {
      await userEvent.click(screen.getByRole("button", { name: "Add keep-out region" }))
      const box = screen.getByRole("group", { name: `Keep-out region ${index}` })
      for (const axis of ["X", "Y", "Z"]) {
        fireEvent.change(within(box).getByLabelText(`Min ${axis} (mm)`), {
          target: { value: "10" },
        })
        fireEvent.change(within(box).getByLabelText(`Max ${axis} (mm)`), {
          target: { value: "12" },
        })
      }
    }
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Add keep-out region" }).disabled,
    ).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Generate alternatives" }))
    await waitFor(() => expect(ports.optimize.mock.calls[0]?.[0].obstacleRegions).toHaveLength(9))
  })

  it("compares extra materials and excludes incomplete keep-out boxes", async () => {
    setup(controller, false, "", {}, true)
    await fill()
    change("Retained mass targets (%)", "35, 50, 70")
    await userEvent.click(screen.getByRole("button", { name: "Prusament PLA" }))
    await userEvent.click(screen.getByRole("button", { name: "Add keep-out region" }))
    expect(
      (screen.getByRole("button", { name: "Generate alternatives" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    const box = screen.getByRole("group", { name: "Keep-out region 1" })
    for (const axis of ["X", "Y", "Z"]) {
      fireEvent.change(within(box).getByLabelText(`Min ${axis} (mm)`), { target: { value: "10" } })
      fireEvent.change(within(box).getByLabelText(`Max ${axis} (mm)`), { target: { value: "12" } })
    }
    await generate()
    await waitFor(() => expect(ports.optimize).toHaveBeenCalledTimes(6))
    expect(ports.optimize.mock.calls[3]?.[0].material.youngModulusMpa).toBe(2300)
    expect(ports.optimize.mock.calls[0]?.[0].obstacleRegions).toEqual([
      { min: [10, 10, 10], max: [12, 12, 12] },
    ])
    change("Maximum iterations", "13")
    expect(screen.queryByRole("region", { name: "Design candidates" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply as new mesh Part" })).toBeNull()
  })

  it("reports infeasible scenarios and invalidates candidates on source revision changes", async () => {
    ports.optimize.mockRejectedValueOnce(
      new StructuralOptimizationError("infeasible-baseline", "Infeasible material"),
    )
    const view = setup(controller, false, "", {}, true)
    await fill()
    change("Retained mass targets (%)", "35, 50, 70")
    await userEvent.click(screen.getByRole("button", { name: "Generate alternatives" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preview candidate 2" })).toBeTruthy(),
    )
    expect(screen.getByText(/35% target: no candidate/)).toBeTruthy()
    view.update({
      ...controller,
      report: {
        ...report,
        snapshot: { ...report.snapshot, revision: report.snapshot.revision + 1 },
      },
    })
    expect(screen.queryByRole("region", { name: "Design candidates" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply as new mesh Part" })).toBeNull()
    expect(ports.apply).not.toHaveBeenCalled()
  })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
describe("Lightweighting workflow", () => {
  it("publishes a stable interaction when the owning workspace stores it in state", async () => {
    const delivered = vi.fn()
    function Workspace() {
      const [interaction, setInteraction] = useState<LightweightingViewportInteraction | null>(null)
      const receive = useCallback((next: LightweightingViewportInteraction | null) => {
        delivered(next)
        setInteraction(next)
      }, [])
      return (
        <I18nProvider i18n={i18n} initialLocale="en">
          <output>{interaction?.source.contentHash}</output>
          <LightweightingTaskPanel
            controller={controller}
            initialPartId={firstPart.id}
            blocked={false}
            onClose={vi.fn()}
            onInteractionChange={receive}
          />
        </I18nProvider>
      )
    }
    render(<Workspace />)
    await waitFor(() => expect(screen.getByText("pristine-cad-hash")).toBeTruthy())
    expect(delivered).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("consumes only active picks, rejects other bodies visibly, and ends one face pick at a time", async () => {
    setup(controller, false, firstPart.id)
    let consumed: boolean | undefined
    act(() => {
      consumed = viewportInteraction?.onFacePick({
        featureId: body.featureId,
        faceId: 1,
        faceOrdinal: 1,
      })
    })
    expect(consumed).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Pick support faces" }))
    expect(viewportInteraction?.picking).toBe(true)
    act(() => {
      consumed = viewportInteraction?.onFacePick({
        featureId: "another-body",
        faceId: 1,
        faceOrdinal: 1,
      })
    })
    expect(consumed).toBe(true)
    expect(screen.getByText(messages.app.lightweighting.wrongBody)).toBeTruthy()
    expect(viewportInteraction?.picking).toBe(true)
    act(() => {
      consumed = viewportInteraction?.onFacePick({
        featureId: body.featureId,
        faceId: 1,
        faceOrdinal: 1,
      })
    })
    expect(consumed).toBe(true)
    expect(viewportInteraction?.picking).toBe(false)
    expect(
      viewportInteraction?.overlays.find(
        (overlay) => overlay.kind === "face" && overlay.role === "support",
      ),
    ).toMatchObject({ faceIds: [1] })
    expect(screen.getByText("1 face selected")).toBeTruthy()
    expect(screen.queryByLabelText("Minimum X (mm)")).toBeNull()
  })

  it("cancels face picking with Escape while leaving the task panel open", async () => {
    setup(controller, false, firstPart.id)
    await userEvent.click(screen.getByRole("button", { name: "Pick support faces" }))
    await userEvent.keyboard("{Escape}")
    expect(viewportInteraction?.picking).toBe(false)
    expect(screen.getByRole("region", { name: "Lightweighting" })).toBeTruthy()
    expect(ports.optimize).not.toHaveBeenCalled()
  })

  it("explains a cancelling face normal and keeps an explicitly chosen axis force visible", async () => {
    ports.parts.mockReturnValue([
      {
        part: firstPart,
        status: "available",
        body: {
          ...body,
          mesh: { ...body.mesh, indices: new Uint32Array([0, 1, 2, 0, 2, 1, 0, 3, 1, 1, 3, 2]) },
        },
      },
    ])
    setup()
    await fill()
    await userEvent.click(screen.getByRole("button", { name: "Pick load faces for case 1" }))
    act(() =>
      viewportInteraction?.onFacePick({
        featureId: body.featureId,
        outputRole: "result",
        faceId: 1,
        faceOrdinal: 1,
      }),
    )
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Direction for case 1" }), {
      key: "Enter",
    })
    await userEvent.click(screen.getByRole("option", { name: "Face normal (outward)" }))
    const analyze = screen.getByRole("button", { name: "Analyze and optimize" })
    expect(analyze).toHaveProperty("disabled", true)
    expect(
      document.getElementById(analyze.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe(
      "The selected faces for case 1 have no combined normal. Choose an axis direction or change the picked faces.",
    )
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Direction for case 1" }), {
      key: "Enter",
    })
    await userEvent.click(screen.getByRole("option", { name: "Positive X axis" }))
    expect(analyze).toHaveProperty("disabled", false)
    expect(
      viewportInteraction?.overlays.find((overlay) => overlay.kind === "force-arrow"),
    ).toMatchObject({ vector: [-10, -0, -0] })
    expect(ports.optimize).not.toHaveBeenCalled()
  })

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
    change("Total force for case 1 (N)", "10")
    await pickFaces()
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
    await waitFor(() => expect(ports.optimize).toHaveBeenCalledTimes(1))
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
    change("Total force for case 1 (N)", "0")
    expect(
      (screen.getByRole("button", { name: "Analyze and optimize" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(ports.optimize).not.toHaveBeenCalled()
  })
  it("maps picked source faces to exact triangle targets; Apply only appends a mesh feature", async () => {
    setup()
    await fill()
    await analyze()
    const input = ports.optimize.mock.calls[0]?.[0]
    expect(input.mesh).toEqual({
      vertices: Array.from(body.mesh.positions),
      indices: Array.from(body.mesh.indices),
    })
    expect(input.supports).toEqual([{ kind: "surface", triangleIndices: [0], depthMm: 4 }])
    expect(input.loadCases).toEqual([
      {
        name: "Load case 1",
        region: { kind: "surface", triangleIndices: [1], depthMm: 4 },
        forceN: [-0, -0, -10],
      },
    ])
    expect(input.maxIterations).toBe(12)
    expect(input.objective).toEqual({ kind: "minimize-mass" })
    expect(ports.inspect.mock.calls[0]?.[0]).toMatchObject({ format: "stl", units: "mm" })
    expect(ports.apply).not.toHaveBeenCalled()
    await userEvent.dblClick(screen.getByRole("button", { name: "Apply as new mesh Part" }))
    expect(ports.apply).toHaveBeenCalledTimes(1)
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
    expect(screen.queryByRole("region", { name: "Lightweighting" })).toBeNull()
  })
  it("selects a target retained mass objective and invalidates the previous analysis", async () => {
    setup()
    await fill()
    await analyze()
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Optimization objective" }), {
      key: "Enter",
    })
    await userEvent.click(screen.getByRole("option", { name: "Maximize stiffness at target mass" }))
    expect(screen.queryByRole("img")).toBeNull()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Apply as new mesh Part" }).disabled,
    ).toBe(true)
    fireEvent.change(screen.getByRole("slider", { name: /Target retained mass/ }), {
      target: { value: "60" },
    })
    await analyze()
    expect(ports.optimize.mock.calls[1]?.[0].objective).toEqual({
      kind: "maximize-stiffness",
      retainedMassFraction: 0.6,
    })
  })
  it("switches to SIMP, invalidates the previous mesh and forwards its target and filter", async () => {
    setup()
    await fill()
    await analyze()
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Optimization method" }), {
      key: "Enter",
    })
    await userEvent.click(screen.getByRole("option", { name: "Topology optimization (SIMP)" }))
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Apply as new mesh Part" }).disabled,
    ).toBe(true)
    expect(screen.queryByRole("combobox", { name: "Optimization objective" })).toBeNull()
    change("Target retained volume (%)", "60")
    change("Density filter radius (mm)", "8")
    await analyze()
    expect(ports.optimize.mock.calls[1]?.[0].algorithm).toEqual({
      kind: "simp",
      volumeFraction: 0.6,
      filterRadiusMm: 8,
      penalty: 3,
    })
    change("Target retained volume (%)", "")
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Analyze and optimize" }).disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Apply as new mesh Part" }).disabled,
    ).toBe(true)
  })
  it("rejects underresolved adaptive walls and passes resolved lattice settings through the same workflow", async () => {
    setup()
    await fill()
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Optimization method" }), {
      key: "Enter",
    })
    await userEvent.click(screen.getByRole("option", { name: "Adaptive lattice (FEM)" }))
    change("Minimum requested wall thickness (mm)", "1")
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Analyze and optimize" }).disabled,
    ).toBe(true)
    change("Minimum requested wall thickness (mm)", "8")
    change("Exterior skin thickness (mm; 0 for open)", "4")
    await analyze()
    expect(ports.optimize.mock.calls[0]?.[0].algorithm).toEqual({
      kind: "adaptive-lattice",
      lattice: "gyroid",
      cellPeriodMm: 40,
      minWallThicknessMm: 8,
      maxWallThicknessMm: 16,
      skinThicknessMm: 4,
      field: "strain-energy",
      gamma: 1,
    })
    change("Field exponent", "2")
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Apply as new mesh Part" }).disabled,
    ).toBe(true)
  })
  it("cancels a single-flight solve on Close and ignores a late response after reopening", async () => {
    const work = deferred<StructuralOptimizationResult>()
    ports.optimize.mockReturnValueOnce(work.promise)
    setup()
    await fill()
    await userEvent.dblClick(screen.getByRole("button", { name: "Analyze and optimize" }))
    expect(ports.optimize).toHaveBeenCalledTimes(1)
    const signal = ports.optimize.mock.calls[0]?.[1].signal as AbortSignal
    await userEvent.click(
      within(screen.getByRole("region", { name: "Lightweighting" })).getByRole("button", {
        name: "Close",
      }),
    )
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
    await waitFor(() => expect(ports.inspect).toHaveBeenCalledTimes(1))
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
    "Total force for case 1 (N)",
    "Region depth (mm)",
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
    change("Region depth (mm)", "3")
    expect(screen.queryByRole("img")).toBeNull()
    await analyze()
    await userEvent.click(screen.getByRole("button", { name: "Pick preserved faces" }))
    act(() =>
      viewportInteraction?.onFacePick({
        featureId: body.featureId,
        outputRole: "result",
        faceId: 3,
        faceOrdinal: 3,
      }),
    )
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
      expect(screen.getByText(messages.app.lightweighting.facesReset)).toBeTruthy(),
    )
    expect(
      (screen.getByRole("button", { name: "Analyze and optimize" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await pickFaces()
    expect(
      (screen.getByRole("button", { name: "Analyze and optimize" }) as HTMLButtonElement).disabled,
    ).toBe(false)
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
    expect(ports.optimize).toHaveBeenCalledTimes(1)
  })
  it("forwards atomic Apply state and success separately from a locked user close", async () => {
    const commit = deferred<{ ok: true }>()
    ports.apply.mockReturnValueOnce(commit.promise)
    const onApplied = vi.fn()
    const onApplyingChange = vi.fn()
    setup(controller, false, "", { onApplied, onApplyingChange })
    await fill()
    await analyze()
    await userEvent.click(screen.getByRole("button", { name: "Apply as new mesh Part" }))
    expect(onApplyingChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole("button", { name: "Close" })).toHaveProperty("disabled", true)
    await userEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.getByRole("region", { name: "Lightweighting" })).toBeTruthy()
    commit.resolve({ ok: true })
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    expect(onApplyingChange.mock.calls).toEqual([[true], [false]])
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
    expect(ports.optimize).toHaveBeenCalledTimes(1)
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
    await waitFor(() => expect(ports.inspect).toHaveBeenCalledTimes(1))
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

describe("Automatic print optimization", () => {
  function printBody(): ModelBodyGeometry {
    return {
      ...body,
      shape: { ...body.shape, volume: 1024, bounds: { min: [0, 0, 0], max: [16, 8, 8] } },
      mesh: {
        positions: new Float32Array([
          0, 0, 0, 0, 0, 8, 0, 8, 0, 0, 8, 8, 16, 0, 0, 16, 0, 8, 16, 8, 0, 16, 8, 8,
        ]),
        normals: new Float32Array(24),
        indices: new Uint32Array([
          0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4,
          1, 5, 7, 1, 7, 3,
        ]),
        triangleFaceIds: new Uint32Array([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]),
      },
    }
  }
  function setupPrint() {
    const sourceBody = printBody()
    ports.exact.mockImplementation(async ({ preserveFaceIds }: { preserveFaceIds: number[] }) => {
      const { mesh: _mesh, ...verification } = result
      const digest = "c".repeat(64)
      return {
        prepared: {
          representation: "exact-solid",
          filename: "optimized.step",
          bytes: new Uint8Array([1, 2, 3]),
          digest,
          source: {
            digest,
            byteLength: 3,
            format: "step",
            normalization: {
              sourceUnit: "millimeter",
              scaleToMillimeters: 1,
              normalizedUnit: "millimeter",
            },
            unitPolicy: "step-system-mm",
            readerPolicyVersion: 1,
          },
        },
        inspection: exactInspection,
        exact: {
          sourceVolumeMm3: 1024,
          volumeMm3: 800,
          preservedFaceCount: preserveFaceIds.length,
          verification,
        },
      }
    })
    ports.parts.mockReturnValue([{ part: firstPart, body: sourceBody, status: "available" }])
    const onManual = vi.fn()
    const onClose = vi.fn()
    const view = render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <PrintOptimizationTaskPanel
          controller={controller}
          initialPartId={firstPart.id}
          blocked={false}
          onClose={onClose}
          onManual={onManual}
          onInteractionChange={receiveInteraction}
        />
      </I18nProvider>,
    )
    return { ...view, sourceBody, onManual, onClose }
  }
  function pick(faceId: number) {
    act(() =>
      viewportInteraction?.onFacePick({
        featureId: body.featureId,
        outputRole: "result",
        faceId,
        faceOrdinal: faceId,
      }),
    )
  }
  async function readyPrint() {
    await userEvent.click(screen.getByRole("button", { name: "Choose print-bed face" }))
    pick(5)
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Material preset" }), { key: "Enter" })
    await userEvent.click(screen.getByRole("option", { name: "PLA — Prusament" }))
  }
  it("starts with a bed face and plastic, preserves only marked regions, and generates a compound torsion case", async () => {
    setupPrint()
    const run = screen.getByRole("button", { name: "Optimize for printing" }) as HTMLButtonElement
    expect(run.disabled).toBe(true)
    await readyPrint()
    expect(run.disabled).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Preserve faces (0)" }))
    pick(3)
    expect(viewportInteraction?.picking).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Finish preserving faces (1)" }))
    await userEvent.click(run)
    await waitFor(() => expect(ports.optimize).toHaveBeenCalledTimes(1))
    const input = ports.optimize.mock.calls[0]?.[0] as StructuralOptimizationInput
    expect(input.includeVoxelGrid).toBe(true)
    expect(input.relativePerformance).toEqual({
      minStiffnessFraction: 0.9,
      minStrengthFraction: 0.9,
    })
    expect(input.loadCases.map(({ name }) => name)).toEqual([
      "Axial tension",
      "Bending 1",
      "Bending 2",
      "Torsion",
    ])
    expect(input.loadCases[3]?.additionalLoads).toHaveLength(1)
    expect(input.preserveRegions).toEqual([
      { kind: "surface", triangleIndices: [4, 5], depthMm: 2 },
    ])
    expect(input.fdm?.buildDirection).toBe("+z")
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Apply as new exact Part" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    )
    expect(ports.apply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Change print-bed face" }))
    pick(1)
    expect(
      (screen.getByRole("button", { name: "Apply as new exact Part" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
  it("filters metal presets and keeps custom properties and real-load setup accessible", async () => {
    const { onManual } = setupPrint()
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Material preset" }), { key: "Enter" })
    expect(screen.queryByRole("option", { name: /6061|304/ })).toBeNull()
    await userEvent.click(screen.getByRole("option", { name: "Custom material" }))
    change("Young’s modulus (MPa)", "2000")
    change("Poisson’s ratio", "0.3")
    change("Yield strength (MPa)", "40")
    change("Density (kg/m³)", "1200")
    await userEvent.click(screen.getByRole("button", { name: "Choose print-bed face" }))
    pick(5)
    expect(
      (screen.getByRole("button", { name: "Optimize for printing" }) as HTMLButtonElement).disabled,
    ).toBe(false)
    await userEvent.click(
      screen.getByText("Advanced optimization settings", { selector: "summary" }),
    )
    change("Minimum retained stiffness (%)", "101")
    expect(
      (screen.getByRole("button", { name: "Optimize for printing" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.click(
      screen.getByRole("button", { name: "Set real supports and loads manually" }),
    )
    expect(onManual).toHaveBeenCalledTimes(1)
  })
  it("rejects foreign faces and cancels face picking before dismissing the task", async () => {
    const { onClose } = setupPrint()
    await userEvent.click(screen.getByRole("button", { name: "Choose print-bed face" }))
    act(() => viewportInteraction?.onFacePick({ featureId: "foreign", faceId: 5, faceOrdinal: 5 }))
    expect(screen.getByRole("alert").textContent).toContain("chosen source Part")
    fireEvent.keyDown(window, { key: "Escape" })
    expect(viewportInteraction?.picking).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })
  it("cancels stale work on parameter edits and suppresses duplicate activation", async () => {
    const work = deferred<StructuralOptimizationResult>()
    ports.optimize.mockReturnValueOnce(work.promise)
    setupPrint()
    await readyPrint()
    const run = screen.getByRole("button", { name: "Optimize for printing" })
    await userEvent.dblClick(run)
    expect(ports.optimize).toHaveBeenCalledTimes(1)
    const signal = ports.optimize.mock.calls[0]?.[1].signal as AbortSignal
    await userEvent.click(screen.getByRole("button", { name: "Cancel analysis" }))
    expect(signal.aborted).toBe(true)
    work.resolve(result)
    await act(async () => {
      await work.promise
    })
    expect(ports.inspect).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByText("Advanced optimization settings", { selector: "summary" }),
    )
    change("Analysis cell size (mm)", "0")
    expect(
      (screen.getByRole("button", { name: "Optimize for printing" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByText(messages.app.printOptimization.errors["invalid-settings"])).toBeTruthy()
  })
  it("applies the inspected exact source once through the ordinary atomic import", async () => {
    setupPrint()
    await readyPrint()
    await userEvent.click(screen.getByRole("button", { name: "Optimize for printing" }))
    const apply = screen.getByRole("button", {
      name: "Apply as new exact Part",
    }) as HTMLButtonElement
    await waitFor(() => expect(apply.disabled).toBe(false))
    await userEvent.dblClick(apply)
    expect(ports.apply).toHaveBeenCalledTimes(1)
    const [revision, transaction] = ports.apply.mock.calls[0] ?? []
    expect(revision).toBe(fixture.snapshot.revision)
    expect(transaction.commands.at(-1).payload.feature.type.typeId).toBe(
      "org.vibeshape.feature.part-design.imported",
    )
    expect(ports.exact).toHaveBeenCalledTimes(1)
  })
  it("invalidates disposable face identities when the native face catalog changes at the same body hash", async () => {
    const { rerender, sourceBody, onClose, onManual } = setupPrint()
    await readyPrint()
    const rebuilt = {
      ...sourceBody,
      mesh: {
        ...sourceBody.mesh,
        triangleFaceIds: new Uint32Array(
          Array.from(sourceBody.mesh.triangleFaceIds, (face) => face + 100),
        ),
      },
    }
    ports.parts.mockReturnValue([{ part: firstPart, body: rebuilt, status: "available" }])
    rerender(
      <I18nProvider i18n={i18n} initialLocale="en">
        <PrintOptimizationTaskPanel
          controller={controller}
          initialPartId={firstPart.id}
          blocked={false}
          onClose={onClose}
          onManual={onManual}
          onInteractionChange={receiveInteraction}
        />
      </I18nProvider>,
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Choose print-bed face" })).toBeTruthy(),
    )
    expect(
      (screen.getByRole("button", { name: "Optimize for printing" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(ports.exact).not.toHaveBeenCalled()
  })
  it("uses print optimization for the registered default command and allows manual setup", async () => {
    const { result: workflow } = renderHook(() =>
      useLightweightingCommand({ controller, selectedPartId: firstPart.id, selectedBody: null }),
    )
    act(() => workflow.current.show())
    expect(workflow.current.mode).toBe("print")
    const sourceBody = printBody()
    ports.parts.mockReturnValue([{ part: firstPart, body: sourceBody, status: "available" }])
    const show = vi.fn()
    function PanelHost() {
      return useWorkspaceTask()?.panel
    }
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <LightweightingWorkspace
          controller={controller}
          workflow={{ ...workflow.current, show }}
          active
        >
          <PanelHost />
        </LightweightingWorkspace>
      </I18nProvider>,
    )
    expect(screen.getByRole("region", { name: "Optimize for 3D printing" })).toBeTruthy()
    await userEvent.click(
      screen.getByRole("button", { name: "Set real supports and loads manually" }),
    )
    expect(show).toHaveBeenCalledWith("structural")
  })
})
