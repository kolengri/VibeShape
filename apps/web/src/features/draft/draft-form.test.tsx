import "../../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { bodyTopoRefSchema } from "@vibeshape/domain/body-topology-reference"
import { modelBodyTopologyEvidenceSchema } from "@vibeshape/domain/model-body-topology"
import { readDraftFeatureParameters } from "@vibeshape/domain/part-design-draft"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import type { ShellPickRequest } from "../shell/shell-picking"
import { DraftForm, type DraftFormCopy } from "./draft-form"
import { type DraftFormMode, draftFormFeature } from "./draft-form-model"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7901")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7902")
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
  rebuildId: "draft-form-fixture",
  featureId: sourceId,
  outputRole: "result",
  kind: "face",
  contentHash: "a".repeat(64),
  candidates: [side("x-max", 10), side("x-min", -10)],
})
const mode: DraftFormMode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
  createFeatureId: () => featureId,
  featureLabel: "Draft 1",
}
const draft = messages.app.draft
const copy: DraftFormCopy = {
  ...draft,
  submit: draft.create,
  faces: {
    legend: draft.faces,
    description: draft.facesDescription,
    count: ({ selected, total }) => `${selected} / ${total} faces selected`,
    faceName: ({ number }) => `Face ${number}`,
    face: ({ number, x }) => `Side face ${number} at x=${x} mm`,
  },
}
const units = { length: "mm", angle: "deg" } as const

function setup(
  formMode: DraftFormMode = mode,
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
        <DraftForm
          baseRevision={7}
          copy={copy}
          mode={formMode}
          evidence={source}
          referenceOptions={{ planes: [], axes: [] }}
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
const apply = () => screen.getByRole("button", { name: draft.create }) as HTMLButtonElement
const faceBox = (number: number) =>
  screen.getByRole("checkbox", { name: new RegExp(`Side face ${number}`) }) as HTMLInputElement
afterEach(cleanup)

describe("Draft task form", () => {
  it("previews only with selected faces and applies body-bound references once", async () => {
    const f = setup()
    await waitFor(() => expect(f.onPreviewChange).toHaveBeenLastCalledWith(null))
    await userEvent.click(faceBox(1))
    await userEvent.click(screen.getByRole("checkbox", { name: draft.flip }))
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            flip: true,
            neutralPlane: { kind: "origin-plane", plane: "XY" },
          }),
        }),
      ),
    )
    await userEvent.click(apply())
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    const saved = f.onSave.mock.calls[0]?.[1]
    expect(saved?.dependencies).toEqual([sourceId])
    expect(saved?.parameters).toMatchObject({
      faces: [{ featureId: sourceId, outputRole: "result", lineageToken: "side.x-max" }],
      angle: { source: { expression: "3 deg" } },
    })
    const parameters = saved ? readDraftFeatureParameters(saved) : null
    expect(parameters?.angle.value).toBeCloseTo((3 * Math.PI) / 180, 12)
    expect(JSON.stringify(saved?.parameters)).not.toContain("candidateId")
  })

  it("publishes a picking context and toggles one viewport face per request", async () => {
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
    f.unmount()
    setup(mode, evidence, "ready", {
      sequence: 2,
      featureId,
      sourceContentHash: "b".repeat(64),
      candidateId: "face:x-min",
    })
    expect(faceBox(2).checked).toBe(false)
  })

  it.each([
    ["90 deg", draft.invalidRange],
    ["5 mm", draft.invalidDimension],
  ])("rejects the angle %s without saving", async (angle, message) => {
    const f = setup()
    await userEvent.click(faceBox(1))
    const input = screen.getByRole("combobox", { name: draft.angle }) as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, angle)
    await userEvent.click(apply())
    await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0))
    expect(f.onSave).not.toHaveBeenCalled()
  })

  it("restores saved faces and asks for reselection when one is gone", () => {
    const feature = draftFormFeature({
      mode,
      featureId,
      values: { faceIds: ["face:x-max", "face:x-min"], angle: "4 deg", flip: false },
      neutralPlane: { kind: "origin-plane", plane: "XZ" },
      evidence,
      variables: [],
      units,
      copy,
    })
    if (!feature) throw new Error("Fixture Draft must be valid.")
    setup({ kind: "edit", feature })
    expect(faceBox(1).checked).toBe(true)
    expect(faceBox(2).checked).toBe(true)
    expect((screen.getByRole("combobox", { name: draft.angle }) as HTMLInputElement).value).toBe(
      "4 deg",
    )
    cleanup()
    setup({ kind: "edit", feature }, { ...evidence, candidates: evidence.candidates.slice(0, 1) })
    expect(screen.getByText(draft.repair)).toBeTruthy()
    expect(faceBox(1).checked).toBe(false)
  })

  it("explains a failed preview with the worker's face reason, else the generic advice", () => {
    const reason = "Draft cannot tilt selected face 2 or a face tangent to it."
    const failed = setup(mode, evidence, "error", null, reason)
    expect(screen.getByText(reason)).toBeTruthy()
    expect(screen.queryByText(draft.previewFailed)).toBeNull()
    failed.unmount()
    setup(mode, evidence, "error")
    expect(screen.getByText(draft.previewFailed)).toBeTruthy()
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
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(draft.saveFailed))
    expect(faceBox(1).checked).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: draft.cancel }))
    expect(f.onCancel).toHaveBeenCalledTimes(1)
    f.unmount()
    expect(f.onPreviewChange).toHaveBeenLastCalledWith(null)
    setup(mode, evidence, "loading")
    expect(apply().disabled).toBe(true)
  })

  it("asks for a new neutral plane after repair drops a face on the replaced body", async () => {
    const replacementId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7903")
    const faceReference = bodyTopoRefSchema.parse({
      schemaVersion: 1,
      featureId: sourceId,
      outputRole: "result",
      kind: "face",
      semanticRole: "box.face.top",
      signature: {
        kind: "face",
        geometryClass: "PLANE",
        measure: 400,
        centroid: [0, 0, 10],
        bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
        direction: [0, 0, 1],
        directionMode: "oriented",
        boundaryCount: 4,
        adjacentGeometryClasses: [],
      },
    })
    const feature = draftFormFeature({
      mode,
      featureId,
      values: { faceIds: ["face:x-max"], angle: "3 deg", flip: false },
      neutralPlane: { kind: "planar-face", reference: faceReference },
      evidence,
      variables: [],
      units,
      copy,
    })
    if (!feature) throw new Error("Fixture Draft must be valid.")
    const f = setup(
      {
        kind: "edit",
        feature,
        repairTarget: { schemaVersion: 0, featureId: replacementId, outputRole: "result" },
      },
      { ...evidence, featureId: replacementId },
    )
    const source = screen.getByRole("combobox", { name: "Reference source" }) as HTMLSelectElement
    expect(source.selectedOptions[0]?.textContent).toBe("Choose a plane")
    expect(screen.queryByText(/Enter finite coordinates/)).toBeNull()
    expect(screen.queryByRole("spinbutton")).toBeNull()
    await userEvent.click(faceBox(1))
    expect(apply().disabled).toBe(true)
    await userEvent.selectOptions(source, "origin")
    await waitFor(() => expect(apply().disabled).toBe(false))
    await userEvent.click(apply())
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    const saved = f.onSave.mock.calls[0]?.[1]
    const parameters = saved ? readDraftFeatureParameters(saved) : null
    expect(parameters?.neutralPlane).toEqual({ kind: "origin-plane", plane: "XY" })
    expect(parameters?.targetBody.featureId).toBe(replacementId)
  })
})
