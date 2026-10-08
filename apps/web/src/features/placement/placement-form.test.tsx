import "../../../../../tests/unit/support/dom"
import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import { PlacementForm } from "./placement-form"
import type { PlacementFormMode } from "./placement-form-model"

const target = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4401")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4402")
const mode: PlacementFormMode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: target, outputRole: "result" },
  createFeatureId: () => featureId,
  featureLabel: "Placement 1",
}
const copy = {
  ...messages.app.placement,
  submit: messages.app.placement.create,
  invalidRange: messages.app.placement.invalidTranslationRange,
}
const save = () =>
  vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const }))
function setup(onSave = save()) {
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <PlacementForm
        baseRevision={7}
        copy={copy}
        mode={mode}
        variables={[]}
        onCancel={onCancel}
        onSave={onSave}
        onSaved={onSaved}
      />
    </I18nProvider>,
  )
  return { onSave, onSaved, onCancel }
}
beforeAll(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
)
afterEach(cleanup)

describe("Placement form", () => {
  it("submits all six parameters to one revision-bound feature mutation", async () => {
    const { onSave, onSaved } = setup()
    const x = screen.getByRole("combobox", { name: "Translate X" })
    await userEvent.clear(x)
    await userEvent.type(x, "50 mm")
    const z = screen.getByRole("combobox", { name: "Rotate Z" })
    await userEvent.clear(z)
    await userEvent.type(z, "90 deg")
    await userEvent.click(screen.getByRole("button", { name: "Create placement" }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]?.[0]).toBe(7)
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({
      id: featureId,
      dependencies: [target],
      parameters: {
        targetBody: mode.targetBody,
        translation: { x: { value: 50 } },
        rotation: { z: { value: Math.PI / 2 } },
      },
    })
  })
  it("focuses invalid expressions and retains values after a rejected save", async () => {
    const onSave = save().mockRejectedValue(new Error("Storage unavailable"))
    const { onSaved } = setup(onSave)
    const x = screen.getByRole("combobox", { name: "Translate X" })
    await userEvent.clear(x)
    await userEvent.type(x, "90 deg")
    await userEvent.click(screen.getByRole("button", { name: "Create placement" }))
    expect(onSave).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(x)
    await userEvent.clear(x)
    await userEvent.type(x, "40 mm")
    await userEvent.click(screen.getByRole("button", { name: "Create placement" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(copy.saveFailed))
    expect((x as HTMLInputElement).value).toBe("40 mm")
    expect(onSaved).not.toHaveBeenCalled()
  })
  it("keeps cancellation separate from committing a placement", async () => {
    const { onSave, onCancel } = setup()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
