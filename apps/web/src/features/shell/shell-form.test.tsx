import "../../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { modelBodyTopologyEvidenceSchema } from "@vibeshape/domain/model-body-topology"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import { ShellForm } from "./shell-form"
import { formatShellMeasurement, type ShellFormMode, shellFormFeature } from "./shell-form-model"
import type { ShellPickRequest } from "./shell-picking"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7801")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7802")
const evidence = modelBodyTopologyEvidenceSchema.parse({
  schemaVersion: 1,
  documentId: sourceId,
  revision: 7,
  generation: 7,
  rebuildId: "shell-form-fixture",
  featureId: sourceId,
  outputRole: "result",
  kind: "face",
  contentHash: "a".repeat(64),
  candidates: [
    {
      candidateId: "face:top",
      kind: "face",
      semanticRole: "top",
      lineageTokens: [],
      signature: {
        kind: "face",
        geometryClass: "plane",
        measure: 600,
        centroid: [0, 0, 40],
        bounds: { min: [-10, -15, 40], max: [10, 15, 40] },
        boundaryCount: 4,
        adjacentGeometryClasses: [],
      },
    },
  ],
})
const mode: ShellFormMode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
  createFeatureId: () => featureId,
  featureLabel: "Shell 1",
}
const copy = {
  ...messages.app.shellOperation,
  submit: messages.app.shellOperation.create,
  openingCount: ({ selected, total }: { selected: number; total: number }) =>
    `${selected} / ${total} faces selected`,
  faceName: ({ number }: { number: number }) => `Face ${number}`,
  face: ({ area, z }: { number: number; area: string; x: string; y: string; z: string }) =>
    `Top face: ${area} mm² at z=${z} mm`,
}
function setup(
  formMode = mode,
  source = evidence,
  status: "ready" | "loading" | "error" = "ready",
  pickingRequest: ShellPickRequest | null = null,
  expandList = true,
) {
  const onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({
    ok: true as const,
  }))
  const onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn()
  const renderForm = (previewStatus: "ready" | "loading" | "error") => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider delayDuration={0}>
        <ShellForm
          baseRevision={7}
          copy={copy}
          mode={formMode}
          evidence={source}
          variables={[]}
          onSave={onSave}
          onSaved={onSaved}
          onCancel={onCancel}
          onPreviewChange={onPreviewChange}
          previewStatus={previewStatus}
          pickingRequest={pickingRequest}
        />
      </TooltipProvider>
    </I18nProvider>
  )
  const view = render(renderForm(status))
  const list = view.container.querySelector("details")
  if (list && expandList) list.open = true
  return {
    ...view,
    onSave,
    onSaved,
    onCancel,
    onPreviewChange,
    setPreviewStatus: (next: "ready" | "loading" | "error") => view.rerender(renderForm(next)),
  }
}
function editedFeature() {
  const feature = shellFormFeature(
    mode,
    featureId,
    { closed: false, thickness: "1 mm", direction: "inward", openingIds: ["face:top"] },
    evidence,
    [],
    { length: "mm", angle: "deg" },
    copy,
  )
  if (!feature) throw new Error("Fixture shell must be valid.")
  return feature
}
afterEach(cleanup)
describe("Shell form and explicit opening repair", () => {
  it("explains a failed exact preview, preserves the draft, and enables Apply only after recovery", async () => {
    const f = setup(mode, evidence, "loading")
    await userEvent.click(screen.getByRole("checkbox", { name: /Top face/ }))
    const thickness = screen.getByRole("combobox", { name: "Wall thickness" }) as HTMLInputElement
    await userEvent.clear(thickness)
    await userEvent.type(thickness, "2 mm")
    f.setPreviewStatus("error")
    expect(screen.getByRole("alert").textContent).toBe(copy.previewFailed)
    const apply = screen.getByRole("button", { name: "Apply shell" }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    await userEvent.click(apply)
    expect(f.onSave).not.toHaveBeenCalled()
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true)
    expect(thickness.value).toBe("2 mm")

    f.setPreviewStatus("loading")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(apply.disabled).toBe(true)
    f.setPreviewStatus("ready")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(apply.disabled).toBe(false)
    await userEvent.click(apply)
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    expect(f.onSave).toHaveBeenCalledTimes(1)
  })
  it("formats native round-off at zero without a negative sign while preserving real negative coordinates", () => {
    expect(formatShellMeasurement(-1e-16)).toBe("0.00")
    expect(formatShellMeasurement(-0)).toBe("0.00")
    expect(formatShellMeasurement(-12.25)).toBe("-12.25")
  })
  it("keeps preview empty until opening selection, then applies exact body evidence without native IDs", async () => {
    const f = setup()
    await waitFor(() => expect(f.onPreviewChange).toHaveBeenLastCalledWith(null))
    await userEvent.click(screen.getByRole("checkbox", { name: /Top face/ }))
    await userEvent.click(screen.getByRole("radio", { name: /Outward/ }))
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            direction: "outward",
            sourceContentHash: evidence.contentHash,
          }),
        }),
      ),
    )
    await userEvent.click(screen.getByRole("button", { name: "Apply shell" }))
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    const call = f.onSave.mock.calls[0]
    if (!call) throw new Error("Shell must save exactly once.")
    const saved = call[1]
    expect(saved.dependencies).toEqual([sourceId])
    expect(saved.parameters.openings).toEqual([
      expect.objectContaining({
        schemaVersion: 1,
        featureId: sourceId,
        outputRole: "result",
        kind: "face",
      }),
    ])
    expect(JSON.stringify(saved.parameters)).not.toContain("candidateId")
    expect(call[0]).toBe(7)
  })
  it("clears stale openings and permits explicit reselection against new source evidence", async () => {
    const f = setup(
      {
        kind: "edit",
        feature: { ...editedFeature(), type: { ...editedFeature().type, schemaVersion: 1 } },
      },
      { ...evidence, contentHash: "b".repeat(64) },
    )
    expect(screen.getByText(copy.repair)).toBeTruthy()
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Apply shell" }))
    expect(f.onSave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("checkbox"))
    await userEvent.click(screen.getByRole("button", { name: "Apply shell" }))
    await waitFor(() => expect(f.onSave).toHaveBeenCalledTimes(1))
    expect(f.onSave.mock.calls[0]?.[1]).toMatchObject({
      id: featureId,
      parameters: { sourceContentHash: "b".repeat(64) },
    })
  })
  it("holds the async save lock, keeps values after failure, and disposes canceled previews", async () => {
    const f = setup()
    await userEvent.click(screen.getByRole("checkbox"))
    let rejectSave!: (error: Error) => void
    f.onSave.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject
        }),
    )
    await userEvent.click(screen.getByRole("button", { name: "Apply shell" }))
    expect(
      (screen.getByRole("button", { name: "Apply shell" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    rejectSave(new Error("Storage failed"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(copy.saveFailed))
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(f.onCancel).toHaveBeenCalledTimes(1)
    f.unmount()
    expect(f.onPreviewChange).toHaveBeenLastCalledWith(null)
  })
  it("blocks Apply during exact preview evaluation", () => {
    setup(mode, evidence, "loading")
    expect(
      (screen.getByRole("button", { name: "Apply shell" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
  it("authors a closed cavity explicitly and restores open face selection when switching back", async () => {
    const f = setup()
    await userEvent.click(screen.getByRole("checkbox", { name: /Top face/ }))
    await userEvent.click(screen.getByRole("radio", { name: "Closed cavity" }))
    expect(screen.queryByRole("checkbox")).toBeNull()
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: expect.objectContaining({ schemaVersion: 2 }),
          parameters: expect.objectContaining({ openings: [] }),
        }),
      ),
    )
    await userEvent.click(screen.getByRole("radio", { name: "Open cavity" }))
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true)
    await userEvent.click(screen.getByRole("radio", { name: "Closed cavity" }))
    await userEvent.click(screen.getByRole("button", { name: "Apply shell" }))
    await waitFor(() => expect(f.onSave).toHaveBeenCalledTimes(1))
    expect(f.onSave.mock.calls[0]?.[1].parameters.openings).toEqual([])
  })
  it("retains a version 2 semantic opening after source dimensions change", () => {
    setup(
      { kind: "edit", feature: editedFeature() },
      {
        ...evidence,
        contentHash: "b".repeat(64),
        candidates: evidence.candidates.map((candidate) => ({
          ...candidate,
          signature: { ...candidate.signature, measure: 700, centroid: [0, 0, 45] },
        })),
      },
    )
    expect(screen.queryByText(copy.repair)).toBeNull()
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true)
  })
  it("does not turn a lost opening into a closed cavity", () => {
    setup(
      { kind: "edit", feature: editedFeature() },
      {
        ...evidence,
        contentHash: "b".repeat(64),
        candidates: evidence.candidates.map((candidate) => ({
          ...candidate,
          semanticRole: "another-face",
        })),
      },
    )
    expect(screen.getByText(copy.repair)).toBeTruthy()
    expect((screen.getByRole("radio", { name: "Open cavity" }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false)
  })
  it("accepts one viewport face request once and rejects stale source evidence", async () => {
    const f = setup(mode, evidence, "ready", {
      sequence: 1,
      featureId,
      sourceContentHash: evidence.contentHash,
      candidateId: "face:top",
    })
    await waitFor(() =>
      expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true),
    )
    await userEvent.click(screen.getByRole("radio", { name: /Outward/ }))
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true)
    f.unmount()
    setup(mode, evidence, "ready", {
      sequence: 2,
      featureId,
      sourceContentHash: "b".repeat(64),
      candidateId: "face:top",
    })
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false)
  })
})

it("keeps the face list collapsed until requested and reports viewport selections", () => {
  const { container } = setup(
    mode,
    evidence,
    "ready",
    {
      sequence: 1,
      featureId,
      sourceContentHash: evidence.contentHash,
      candidateId: "face:top",
    },
    false,
  )
  const list = container.querySelector("details")
  if (!list) throw new Error("Expected the opening face disclosure")
  expect(list.open).toBe(false)
  expect(screen.getByText("1 / 1 faces selected")).toBeTruthy()
  expect((screen.getByRole("checkbox", { hidden: true }) as HTMLInputElement).checked).toBe(true)
})
