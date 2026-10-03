// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { AssemblyInspection } from "@vibeshape/protocol"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { ViewerPreferencesProvider } from "../../shell/viewer-preferences"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { AssemblyExportDialog } from "./assembly-export-dialog"
import { identityAssemblyPose, newAssemblyInstance } from "./assembly-model"
import { assemblyUiFixture } from "./assembly-test-fixture"
import { useAssemblyExport } from "./use-assembly-export"

const ports = vi.hoisted(() => ({ assembly: vi.fn(), model: vi.fn(), download: vi.fn() }))
vi.mock("../../document/document-controller", () => ({
  exportActiveAssembly: ports.assembly,
  prepareActiveDocumentPrint: ports.model,
}))
vi.mock("../../document/document-export", () => ({ downloadDocumentExport: ports.download }))
vi.mock("../../printing/print-preparation-preview", () => ({
  PrintPreparationPreview: () => <div>Prepared geometry preview</div>,
}))
vi.mock("../../printing/slicer-handoff-panel", () => ({ SlicerHandoffPanel: () => null }))
const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider i18n={i18n} initialLocale="en">
    <ViewerPreferencesProvider>{children}</ViewerPreferencesProvider>
  </I18nProvider>
)
const exported = {
  ok: true,
  format: "3mf",
  documentName: "Assembly",
  bodyCount: 1,
  file: new Uint8Array([80, 75]),
}
function fixture(mesh = false, count = 2) {
  const f = assemblyUiFixture()
  const instances = Array.from({ length: count }, (_, index) =>
    newAssemblyInstance(f.definition, `Occurrence ${index + 1}`, identityAssemblyPose, () =>
      id(700 + index),
    ),
  )
  const occurrences = instances.map((instance) => ({
    instanceId: instance.id,
    representation: mesh ? "triangle-mesh" : "exact-solid",
  }))
  return {
    instances,
    inspection: { occurrences, interference: [] } as unknown as AssemblyInspection,
  }
}
async function choose(option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Instances to export" }), { key: "Enter" })
  await userEvent.click(screen.getByRole("option", { name: option }))
}
async function open(f = fixture(), selectedId: string | null = f.instances[0]?.id ?? null) {
  const view = render(<AssemblyExportDialog {...f} selectedId={selectedId} disabled={false} />, {
    wrapper,
  })
  await userEvent.click(screen.getByRole("button", { name: "Export assembly…" }))
  return view
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  HTMLElement.prototype.scrollIntoView = vi.fn()
  ports.assembly.mockResolvedValue(exported)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
describe("Assembly export isolation", () => {
  it("exports one selected instance or every occurrence without calling the model export port", async () => {
    const f = fixture()
    await open(f)
    await userEvent.click(screen.getByRole("button", { name: "Download STL" }))
    expect(ports.assembly).toHaveBeenLastCalledWith(
      { format: "stl", instanceIds: [f.instances[0]?.id] },
      expect.any(AbortSignal),
    )
    await choose("All assembly instances")
    await userEvent.click(screen.getByRole("button", { name: "Download 3MF" }))
    expect(ports.assembly).toHaveBeenLastCalledWith({ format: "3mf" }, expect.any(AbortSignal))
    expect(ports.download).toHaveBeenCalledTimes(2)
    expect(ports.model).not.toHaveBeenCalled()
  })
  it("reports mesh STEP incompatibility and bounds print preparation by source-body count", async () => {
    await open(fixture(true, 9), null)
    expect(screen.getByRole("button", { name: "Download STEP" }).hasAttribute("disabled")).toBe(
      true,
    )
    expect(
      screen
        .getByRole("button", { name: "Prepare assembly for printing" })
        .hasAttribute("disabled"),
    ).toBe(true)
    await choose("Occurrence 2")
    expect(
      screen
        .getByRole("button", { name: "Prepare assembly for printing" })
        .hasAttribute("disabled"),
    ).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Prepare assembly for printing" }))
    await choose("All assembly instances")
    expect(
      screen.getByRole("button", { name: "Generate print preview" }).hasAttribute("disabled"),
    ).toBe(true)
    expect(
      screen
        .getByRole("button", { name: "Export current assembly poses" })
        .hasAttribute("disabled"),
    ).toBe(false)
  })
  it("prepares the scoped assembly through the shared preview and invalidates it after settings change", async () => {
    const f = fixture()
    ports.assembly.mockResolvedValue({
      ...exported,
      printPreparation: {
        meshes: [],
        report: { bodyCount: 1, finCount: 0, contactCount: 0, bounds: [20, 30, 40], warnings: [] },
      },
    })
    await open(f)
    await userEvent.click(screen.getByRole("button", { name: "Prepare assembly for printing" }))
    expect(screen.getByText(/Relative instance poses are preserved/)).toBeDefined()
    await userEvent.click(screen.getByRole("button", { name: "Generate print preview" }))
    await userEvent.click(await screen.findByRole("button", { name: "Download prepared 3MF" }))
    expect(ports.assembly).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "3mf",
        instanceIds: [f.instances[0]?.id],
        printPreparation: expect.objectContaining({ rotationX: 45 }),
      }),
      expect.any(AbortSignal),
    )
    expect(ports.model).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText("Tilt around X (degrees)"), { target: { value: "0" } })
    expect(screen.queryByRole("button", { name: "Download prepared 3MF" })).toBeNull()
  })
  it("locks duplicate activation and permits retry after failure", async () => {
    let reject!: (error: Error) => void
    ports.assembly.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    const hook = renderHook(() => useAssemblyExport())
    let running!: Promise<void>
    act(() => {
      running = hook.result.current.run({ format: "step" })
      void hook.result.current.run({ format: "stl" })
    })
    expect(ports.assembly).toHaveBeenCalledOnce()
    await act(async () => {
      reject(new Error("Worker rejected"))
      await running
    })
    expect(hook.result.current.failed).toBe(true)
    expect(hook.result.current.pending).toBeNull()
    await act(async () => {
      await hook.result.current.run({ format: "3mf" })
    })
    expect(ports.download).toHaveBeenCalledOnce()
    expect(hook.result.current.failed).toBe(false)
  })
  it("aborts a closed dialog and never downloads a late result", async () => {
    let finish!: (value: typeof exported) => void
    ports.assembly.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await open()
    await userEvent.click(screen.getByRole("button", { name: "Download STEP" }))
    await userEvent.click(screen.getByRole("button", { name: "Close export" }))
    expect(ports.assembly.mock.calls[0]?.[1].aborted).toBe(true)
    await act(async () => {
      finish(exported)
    })
    await waitFor(() => expect(ports.download).not.toHaveBeenCalled())
  })
})
