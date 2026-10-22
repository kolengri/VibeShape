import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import { modelBodyTopologyEvidenceSchema } from "@vibeshape/domain/model-body-topology"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import { editPartDesignTool, modifyingSolidTargetFeatures } from "../part-design/part-design-tool"
import { PressPullForm } from "./press-pull-form"
import {
  type PressPullFormMode,
  pressPullFormFeature,
  pressPullSourceIsCurrent,
} from "./press-pull-form-model"

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7801")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7802")
const signature = {
  kind: "face",
  geometryClass: "PLANE",
  measure: 240,
  centroid: [0, 0, 10],
  bounds: { min: [-10, -6, 10], max: [10, 6, 10] },
  boundaryCount: 4,
  adjacentGeometryClasses: [],
}
const evidence = modelBodyTopologyEvidenceSchema.parse({
  schemaVersion: 1,
  documentId: sourceId,
  revision: 7,
  generation: 7,
  rebuildId: "press-pull-fixture",
  featureId: sourceId,
  outputRole: "result",
  kind: "face",
  contentHash: "a".repeat(64),
  candidates: [
    { candidateId: "face:top", kind: "face", semanticRole: "top", lineageTokens: [], signature },
  ],
})
const mode: PressPullFormMode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
  sourceContentHash: evidence.contentHash,
  face: bodyFaceRefSchema.parse({
    schemaVersion: 1,
    kind: "face",
    featureId: sourceId,
    outputRole: "result",
    semanticRole: "top",
    signature,
  }),
  createFeatureId: () => featureId,
  featureLabel: "Press Pull 1",
}
const copy = { ...messages.app.pressPull, submit: messages.app.pressPull.create }
afterEach(cleanup)
function setup(
  formMode = mode,
  source = evidence,
  status: "ready" | "loading" | "error" = "ready",
) {
  const onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({
    ok: true as const,
  }))
  const onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <PressPullForm
        baseRevision={7}
        mode={formMode}
        evidence={source}
        variables={[]}
        copy={copy}
        onSave={onSave}
        onSaved={onSaved}
        onCancel={onCancel}
        onPreviewChange={onPreviewChange}
        previewStatus={status}
      />
    </I18nProvider>,
  )
  return { ...view, onSave, onSaved, onCancel, onPreviewChange }
}
describe("Press Pull parameter lifecycle", () => {
  it("previews signed parameters without saving and applies exactly one normal feature mutation", async () => {
    const user = userEvent.setup(),
      view = setup()
    const input = screen.getByRole("combobox", { name: copy.distance })
    await user.clear(input)
    await user.type(input, "-2 mm")
    await waitFor(() =>
      expect(view.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({ distance: expect.objectContaining({ value: -2 }) }),
        }),
      ),
    )
    expect(view.onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: copy.submit }))
    await waitFor(() => expect(view.onSave).toHaveBeenCalledTimes(1))
    expect(view.onSave.mock.calls[0]?.[0]).toBe(7)
    expect(view.onSave.mock.calls[0]?.[1].parameters).toMatchObject({
      targetBody: mode.kind === "create" ? mode.targetBody : null,
      distance: { value: -2 },
    })
    expect(view.onSaved).toHaveBeenCalledTimes(1)
  })
  it("cancels without saving and clears the disposable preview on unmount", async () => {
    const user = userEvent.setup(),
      view = setup()
    await waitFor(() =>
      expect(view.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: featureId }),
      ),
    )
    await user.click(screen.getByRole("button", { name: copy.cancel }))
    expect(view.onCancel).toHaveBeenCalledTimes(1)
    expect(view.onSave).not.toHaveBeenCalled()
    view.unmount()
    expect(view.onPreviewChange).toHaveBeenLastCalledWith(null)
  })
  it("blocks Apply while preview is pending or the source hash is stale", async () => {
    const pending = setup(mode, evidence, "loading")
    expect(screen.getByRole("button", { name: copy.submit }).hasAttribute("disabled")).toBe(true)
    pending.unmount()
    const stale = setup(mode, { ...evidence, contentHash: "b".repeat(64) })
    expect(screen.getByRole("button", { name: copy.submit }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByText(copy.unavailable)).toBeTruthy()
    expect(stale.onSave).not.toHaveBeenCalled()
  })
  it("edits the same feature and refuses silent rebinding on source or topology changes", () => {
    const original = pressPullFormFeature(
      mode,
      featureId,
      "2 mm",
      evidence,
      [],
      { length: "mm", angle: "deg" },
      copy,
    )
    if (!original) throw new Error("Fixture requires a valid feature.")
    expect(editPartDesignTool(original)).toEqual({ kind: "edit-press-pull", featureId })
    expect(modifyingSolidTargetFeatures([original])).toEqual([original])
    const edit: PressPullFormMode = { kind: "edit", feature: original }
    const updated = pressPullFormFeature(
      edit,
      sourceId,
      "-1 mm",
      evidence,
      [],
      { length: "mm", angle: "deg" },
      copy,
    )
    expect(updated?.id).toBe(featureId)
    expect(updated?.parameters).toMatchObject({ distance: { value: -1 } })
    expect(pressPullSourceIsCurrent(edit, { ...evidence, candidates: [] })).toBe(false)
    expect(pressPullSourceIsCurrent(edit, { ...evidence, contentHash: "b".repeat(64) })).toBe(false)
    const duplicate = { ...evidence.candidates[0], candidateId: "face:duplicate" }
    expect(
      pressPullSourceIsCurrent(
        edit,
        modelBodyTopologyEvidenceSchema.parse({
          ...evidence,
          candidates: [...evidence.candidates, duplicate],
        }),
      ),
    ).toBe(false)
  })
})
