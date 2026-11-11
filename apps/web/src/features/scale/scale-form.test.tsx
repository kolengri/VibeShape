import "../../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { readScaleFeatureParameters } from "@vibeshape/domain/part-design-scale"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import { ScaleForm, type ScaleFormCopy } from "./scale-form"
import { parseScaleForm, type ScaleFormMode, scaleFeatureRecord } from "./scale-form-model"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7a01")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7a02")
const mode: ScaleFormMode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "split.positive" },
  createFeatureId: () => featureId,
  featureLabel: "Scale 1",
}
const scale = messages.app.scale
const copy: ScaleFormCopy = {
  ...scale,
  submit: scale.create,
  centerKinds: {
    "bounding-box-center": scale.boundingBoxCenter,
    origin: scale.origin,
    point: scale.point,
  },
}
const units = { length: "mm", angle: "deg" } as const

function setup(formMode: ScaleFormMode = mode, status: "ready" | "loading" = "ready") {
  const onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({
    ok: true as const,
  }))
  const onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <ScaleForm
        baseRevision={3}
        copy={copy}
        mode={formMode}
        variables={[]}
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
const apply = () => screen.getByRole("button", { name: scale.create }) as HTMLButtonElement
const savedParameters = (onSave: ReturnType<typeof setup>["onSave"]) => {
  const feature = onSave.mock.calls[0]?.[1]
  return feature ? readScaleFeatureParameters(feature) : null
}
afterEach(cleanup)

describe("Scale task form", () => {
  it("previews and applies the default factor about the named body's bounding-box center", async () => {
    const f = setup()
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ dependencies: [sourceId] }),
      ),
    )
    await userEvent.click(apply())
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    expect(f.onSave.mock.calls[0]?.[0]).toBe(3)
    expect(savedParameters(f.onSave)).toMatchObject({
      targetBody: { featureId: sourceId, outputRole: "split.positive" },
      factor: { value: 2 },
      center: { kind: "bounding-box-center" },
    })
  })

  it("authors an explicit fixed point with unit-aware coordinates", async () => {
    const f = setup()
    expect(screen.queryByRole("combobox", { name: scale.centerX })).toBeNull()
    await userEvent.click(screen.getByRole("radio", { name: scale.point }))
    const x = screen.getByRole("combobox", { name: scale.centerX }) as HTMLInputElement
    await userEvent.clear(x)
    await userEvent.type(x, "1 cm")
    const factor = screen.getByRole("combobox", { name: scale.factor }) as HTMLInputElement
    await userEvent.clear(factor)
    await userEvent.type(factor, "0.5")
    await userEvent.click(apply())
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    expect(savedParameters(f.onSave)).toMatchObject({
      factor: { value: 0.5, source: { expression: "0.5" } },
      center: { kind: "point", point: { x: { value: 10 }, y: { value: 0 }, z: { value: 0 } } },
    })
  })

  it.each([
    ["0", scale.invalidFactorRange],
    ["1001", scale.invalidFactorRange],
    ["5 mm", scale.invalidFactorDimension],
  ])("rejects the factor %s without saving", async (value, message) => {
    const f = setup()
    const factor = screen.getByRole("combobox", { name: scale.factor }) as HTMLInputElement
    await userEvent.clear(factor)
    await userEvent.type(factor, value)
    await userEvent.click(apply())
    await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0))
    expect(f.onSave).not.toHaveBeenCalled()
  })

  it("restores an edited Scale and blocks Apply during preview evaluation", async () => {
    const parsed = parseScaleForm(
      {
        factor: "3",
        center: "origin",
        centerX: "0 mm",
        centerY: "0 mm",
        centerZ: "0 mm",
      },
      [],
      units,
      copy,
    )
    if (!parsed.ok) throw new Error("Fixture Scale must be valid.")
    const feature = scaleFeatureRecord(mode, featureId, parsed)
    setup({ kind: "edit", feature }, "loading")
    expect((screen.getByRole("combobox", { name: scale.factor }) as HTMLInputElement).value).toBe(
      "3",
    )
    expect((screen.getByRole("radio", { name: scale.origin }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect(apply().disabled).toBe(true)
  })

  it("keeps values and releases the save lock after a rejected save", async () => {
    const f = setup()
    let rejectSave!: (error: Error) => void
    f.onSave.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject
        }),
    )
    await userEvent.click(apply())
    expect(apply().disabled).toBe(true)
    rejectSave(new Error("Storage failed"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(scale.saveFailed))
    expect(apply().disabled).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: scale.cancel }))
    expect(f.onCancel).toHaveBeenCalledTimes(1)
  })
})
