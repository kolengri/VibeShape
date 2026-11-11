import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import { coilFeatureType } from "@vibeshape/domain/part-design-coil"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import type { ExactBodyOption } from "../part-design/exact-body-options"
import type { ReferenceFrameOptions } from "../reference-geometry/reference-frame-options"
import { CoilForm, type CoilFormCopy } from "./coil-form"
import { type CoilFormMode, coilFeatureRecord } from "./coil-form-model"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f9101")
const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f9102")
const target = bodyReferenceSchema.parse({
  schemaVersion: 0,
  featureId: sourceId,
  outputRole: "result",
})
const targets: readonly ExactBodyOption[] = [
  { id: JSON.stringify([sourceId, "result"]), label: "Box 1", body: target },
]
const axisOptions: ReferenceFrameOptions = { planes: [], axes: [] }
const mode: CoilFormMode = {
  kind: "create",
  createFeatureId: () => featureId,
  featureLabel: "Coil 1",
}
const source = messages.app.coil
const copy: CoilFormCopy = {
  ...messages.app.helix,
  ...source,
  submit: source.create,
  selfIntersection: (minimumPitch) =>
    source.selfIntersection.replace("{minimumPitch}", minimumPitch),
}
const originalScrollIntoView = Element.prototype.scrollIntoView
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Element.prototype.scrollIntoView = originalScrollIntoView
})

function setup(
  formMode: CoilFormMode = mode,
  onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const })),
) {
  const onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <CoilForm
        baseRevision={3}
        copy={copy}
        mode={formMode}
        targets={targets}
        axisOptions={axisOptions}
        variables={[]}
        onSave={onSave}
        onSaved={onSaved}
        onCancel={onCancel}
        onPreviewChange={onPreviewChange}
        previewStatus="ready"
      />
    </I18nProvider>,
  )
  return { ...view, onSave, onSaved, onCancel, onPreviewChange }
}

describe("Coil task panel", () => {
  it("previews a new right-handed coil and applies one ordinary mutation once", async () => {
    const user = userEvent.setup()
    let release: (value: { ok: true }) => void = () => undefined
    const onSave = vi.fn(
      (_revision: number, _feature: FeatureRecord) =>
        new Promise<{ ok: true }>((resolve) => {
          release = resolve
        }),
    )
    const view = setup(mode, onSave)
    await waitFor(() =>
      expect(view.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: coilFeatureType.type,
          dependencies: [],
          parameters: expect.objectContaining({
            axis: { kind: "origin-axis", axis: "Z" },
            handedness: "right",
            operation: "new",
            targetBody: null,
          }),
        }),
      ),
    )
    const apply = screen.getByRole("button", { name: source.create })
    await user.dblClick(apply)
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: source.create }).getAttribute("aria-busy")).toBe(
        "true",
      ),
    )
    release({ ok: true })
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]?.[0]).toBe(3)
  })

  it("rejects a self-intersecting pitch with the minimum pitch and blocks Apply", async () => {
    const user = userEvent.setup(),
      view = setup()
    const pitch = screen.getByRole("combobox", { name: messages.app.helix.pitch })
    await user.clear(pitch)
    await user.type(pitch, "1.5 mm")
    expect(screen.getByText(copy.selfIntersection("2.002"))).toBeTruthy()
    expect(pitch.getAttribute("aria-invalid")).toBe("true")
    expect(screen.getByRole("button", { name: source.create }).hasAttribute("disabled")).toBe(true)
    await waitFor(() => expect(view.onPreviewChange).toHaveBeenLastCalledWith(null))
    expect(view.onSave).not.toHaveBeenCalled()
  })

  it("switches to height, left hand and a rectangular Remove against the exact target", async () => {
    const user = userEvent.setup(),
      view = setup()
    await user.click(screen.getByRole("radio", { name: source.operationRemove }))
    await user.click(screen.getByRole("radio", { name: messages.app.helix.left }))
    await user.click(screen.getByRole("radio", { name: messages.app.helix.extentHeight }))
    await user.click(screen.getByRole("radio", { name: source.rectangular }))
    const height = screen.getByRole("combobox", { name: messages.app.helix.height })
    await user.clear(height)
    await user.type(height, "12 mm")
    await waitFor(() =>
      expect(view.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          dependencies: [sourceId],
          parameters: expect.objectContaining({
            handedness: "left",
            operation: "remove",
            targetBody: target,
            extent: expect.objectContaining({ kind: "height" }),
            section: expect.objectContaining({ kind: "rectangular" }),
          }),
        }),
      ),
    )
  })

  it("keeps feature identity and authored expressions when editing", async () => {
    const preview = setup().onPreviewChange
    await waitFor(() => expect(preview.mock.calls.some(([feature]) => feature !== null)).toBe(true))
    const created = preview.mock.calls
      .map(([feature]) => feature)
      .findLast(Boolean) as FeatureRecord
    cleanup()
    const user = userEvent.setup()
    const view = setup({ kind: "edit", feature: created })
    const radius = screen.getByRole("combobox", { name: messages.app.helix.radius })
    await user.clear(radius)
    await user.type(radius, "12 mm")
    await user.click(screen.getByRole("button", { name: source.create }))
    await waitFor(() => expect(view.onSave).toHaveBeenCalledTimes(1))
    const saved = view.onSave.mock.calls[0]?.[1]
    expect(saved?.id).toBe(featureId)
    expect(saved?.parameters).toMatchObject({
      radius: { value: 12, source: { expression: "12 mm" } },
    })
    expect(
      coilFeatureRecord({ kind: "edit", feature: created }, featureId, created.parameters as never)
        .id,
    ).toBe(featureId)
  })
})
