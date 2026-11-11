import "../../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { modelBodyTopologyEvidenceSchema } from "@vibeshape/domain/model-body-topology"
import { readThickenFeatureParameters } from "@vibeshape/domain/part-design-thicken"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import type { ShellPickRequest } from "../shell/shell-picking"
import { ThickenForm, type ThickenFormCopy } from "./thicken-form"
import { type ThickenFormMode, thickenFormFeature } from "./thicken-form-model"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7a01")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7a02")
const side = (name: string, x: number) => ({
  candidateId: `face:${name}`,
  kind: "face" as const,
  lineageTokens: [`side.${name}`],
  signature: {
    kind: "face" as const,
    geometryClass: "PLANE",
    measure: 200,
    centroid: [x, 0, 5] as [number, number, number],
    bounds: { min: [x, -10, 0], max: [x, 10, 10] },
    boundaryCount: 4,
    adjacentGeometryClasses: [],
  },
})
const evidence = modelBodyTopologyEvidenceSchema.parse({
  schemaVersion: 1,
  documentId: sourceId,
  revision: 7,
  generation: 7,
  rebuildId: "thicken-form-fixture",
  featureId: sourceId,
  outputRole: "result",
  kind: "face",
  contentHash: "a".repeat(64),
  candidates: [side("x-max", 10), side("x-min", -10)],
})
const mode: ThickenFormMode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
  createFeatureId: () => featureId,
  featureLabel: "Thicken 1",
}
const thicken = messages.app.thicken
const copy: ThickenFormCopy = {
  ...thicken,
  submit: thicken.create,
  faces: {
    legend: thicken.faces,
    description: thicken.facesDescription,
    count: ({ selected, total }) => `${selected} / ${total} faces selected`,
    faceName: ({ number }) => `Face ${number}`,
    face: ({ number, x }) => `Side face ${number} at x=${x} mm`,
  },
  thicknessDescription: thicken.thicknessDescription,
  sides: { outward: thicken.outward, inward: thicken.inward, symmetric: thicken.symmetric },
  operations: {
    new: thicken.operationNew,
    add: thicken.operationAdd,
    remove: thicken.operationRemove,
  },
}
const units = { length: "mm", angle: "deg" } as const

function setup(
  formMode: ThickenFormMode = mode,
  source = evidence,
  status: "ready" | "loading" | "error" = "ready",
  pickingRequest: ShellPickRequest | null = null,
  previewDiagnostic?: string,
) {
  const onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({
    ok: true as const,
  }))
  const onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn(),
    onPickingContextChange = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider delayDuration={0}>
        <ThickenForm
          baseRevision={7}
          copy={copy}
          mode={formMode}
          evidence={source}
          variables={[]}
          onSave={onSave}
          onSaved={onSaved}
          onCancel={onCancel}
          onPreviewChange={onPreviewChange}
          previewStatus={status}
          previewDiagnostic={previewDiagnostic}
          pickingRequest={pickingRequest}
          onPickingContextChange={onPickingContextChange}
        />
      </TooltipProvider>
    </I18nProvider>,
  )
  const list = view.container.querySelector("details")
  if (list) list.open = true
  return { ...view, onSave, onSaved, onCancel, onPreviewChange, onPickingContextChange }
}
const apply = () => screen.getByRole("button", { name: thicken.create }) as HTMLButtonElement
const faceBox = (number: number) =>
  screen.getByRole("checkbox", { name: new RegExp(`Side face ${number}`) }) as HTMLInputElement
afterEach(cleanup)

describe("Thicken task form", () => {
  it("previews only with selected faces and applies body-bound references once", async () => {
    const f = setup()
    await waitFor(() => expect(f.onPreviewChange).toHaveBeenLastCalledWith(null))
    await userEvent.click(faceBox(1))
    await userEvent.click(screen.getByRole("radio", { name: thicken.symmetric }))
    await userEvent.click(screen.getByRole("radio", { name: thicken.operationAdd }))
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({ side: "symmetric", operation: "add" }),
        }),
      ),
    )
    await userEvent.click(apply())
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    const saved = f.onSave.mock.calls[0]?.[1]
    expect(saved?.dependencies).toEqual([sourceId])
    expect(saved?.parameters).toMatchObject({
      faces: [{ featureId: sourceId, outputRole: "result", lineageToken: "side.x-max" }],
      thickness: { source: { expression: "2 mm" } },
    })
    expect(saved ? readThickenFeatureParameters(saved)?.thickness.value : null).toBe(2)
    expect(JSON.stringify(saved?.parameters)).not.toContain("candidateId")
  })

  it("toggles one viewport face per picking request", async () => {
    const f = setup(mode, evidence, "ready", {
      sequence: 1,
      featureId,
      sourceContentHash: evidence.contentHash,
      candidateId: "face:x-min",
    })
    await waitFor(() => expect(faceBox(2).checked).toBe(true))
    expect(f.onPickingContextChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ featureId, openingIds: ["face:x-min"] }),
    )
  })

  it.each([
    ["20000 mm", thicken.invalidRange],
    ["5 deg", thicken.invalidDimension],
  ])("rejects the thickness %s without saving", async (thickness, message) => {
    const f = setup()
    await userEvent.click(faceBox(1))
    const input = screen.getByRole("combobox", { name: thicken.thickness }) as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, thickness)
    await userEvent.click(apply())
    await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0))
    expect(f.onSave).not.toHaveBeenCalled()
  })

  it("restores saved values and asks for reselection when a face is gone", () => {
    const feature = thickenFormFeature({
      mode,
      featureId,
      values: {
        faceIds: ["face:x-max", "face:x-min"],
        thickness: "3 mm",
        side: "inward",
        operation: "remove",
      },
      evidence,
      variables: [],
      units,
      copy,
    })
    if (!feature) throw new Error("Fixture Thicken must be valid.")
    setup({ kind: "edit", feature })
    expect(faceBox(1).checked).toBe(true)
    expect(faceBox(2).checked).toBe(true)
    expect(
      (screen.getByRole("combobox", { name: thicken.thickness }) as HTMLInputElement).value,
    ).toBe("3 mm")
    expect((screen.getByRole("radio", { name: thicken.inward }) as HTMLInputElement).checked).toBe(
      true,
    )
    cleanup()
    setup({ kind: "edit", feature }, { ...evidence, candidates: evidence.candidates.slice(0, 1) })
    expect(screen.getByText(thicken.repair)).toBeTruthy()
    expect(faceBox(1).checked).toBe(false)
  })

  it("shows the worker's reason for a failed preview, else the generic advice", () => {
    const reason =
      "Thicken offset 6 mm inward reaches the 5 mm curvature radius of selected face 1."
    const failed = setup(mode, evidence, "error", null, reason)
    expect(screen.getByText(reason)).toBeTruthy()
    failed.unmount()
    setup(mode, evidence, "error")
    expect(screen.getByText(thicken.previewFailed)).toBeTruthy()
  })

  it("holds the save lock, keeps values after failure, and blocks Apply while previewing", async () => {
    const f = setup()
    await userEvent.click(faceBox(1))
    let rejectSave!: (error: Error) => void
    f.onSave.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject
        }),
    )
    await userEvent.click(apply())
    expect(apply().disabled).toBe(true)
    await userEvent.click(apply())
    expect(f.onSave).toHaveBeenCalledTimes(1)
    rejectSave(new Error("Storage failed"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(thicken.saveFailed))
    expect(faceBox(1).checked).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: thicken.cancel }))
    expect(f.onCancel).toHaveBeenCalledTimes(1)
    f.unmount()
    expect(f.onPreviewChange).toHaveBeenLastCalledWith(null)
    setup(mode, evidence, "loading")
    expect(apply().disabled).toBe(true)
  })
})
