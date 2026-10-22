import "../../../../../tests/unit/support/dom"
import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import type { PlacementAlignmentFaces } from "./placement-face-alignment"
import { PlacementForm } from "./placement-form"
import type { PlacementFormMode } from "./placement-form-model"
import type { PlacementManipulator } from "./placement-manipulator"

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
function setup(
  onSave = save(),
  onManipulatorChange?: (value: PlacementManipulator | null) => void,
  alignmentFaces?: PlacementAlignmentFaces,
) {
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <PlacementForm
        baseRevision={7}
        copy={copy}
        mode={mode}
        variables={[]}
        onCancel={onCancel}
        onSave={onSave}
        onSaved={onSaved}
        sourceBounds={{ min: [10, 20, 30], max: [30, 40, 50] }}
        onManipulatorChange={onManipulatorChange}
        alignmentFaces={alignmentFaces}
      />
    </I18nProvider>,
  )
  return { ...view, onSave, onSaved, onCancel }
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
  it("pauses the handle during face picking and resumes after an exact field edit", async () => {
    const changes = vi.fn((_value: PlacementManipulator | null) => {})
    setup(save(), changes, { source: [], targets: [] })
    const old = changes.mock.calls.at(-1)?.[0]?.translationGizmo
    await userEvent.click(
      screen.getByText(messages.app.placement.alignmentTitle, { selector: "summary span" }),
    )
    await userEvent.click(
      screen.getByRole("button", { name: messages.app.placement.alignmentPickFaces }),
    )
    expect(changes.mock.calls.at(-1)?.[0]).toBeNull()
    act(() => old?.onPositionChange([999, 999, 999]))
    const x = screen.getByRole("combobox", { name: "Translate X" })
    expect((x as HTMLInputElement).value).toBe("0 mm")
    await userEvent.clear(x)
    await userEvent.type(x, "5 mm")
    expect(changes.mock.calls.at(-1)?.[0]?.translationGizmo?.position).toEqual([25, 30, 40])
  })
  it("writes drag literals into the draft and expires old callbacks on invalidation, Cancel and unmount", async () => {
    const changes = vi.fn((_value: PlacementManipulator | null) => {})
    const f = setup(save(), changes)
    const initial = changes.mock.calls.at(-1)?.[0]?.translationGizmo
    expect(initial?.position).toEqual([20, 30, 40])
    act(() => initial?.onPositionChange([25, 28, 43]))
    expect((screen.getByRole("combobox", { name: "Translate X" }) as HTMLInputElement).value).toBe(
      "5 mm",
    )
    expect(f.onSave).not.toHaveBeenCalled()
    const stale = changes.mock.calls.at(-1)?.[0]?.translationGizmo
    const x = screen.getByRole("combobox", { name: "Translate X" })
    await userEvent.clear(x)
    await userEvent.type(x, "invalid")
    expect(changes.mock.calls.at(-1)?.[0]).toBeNull()
    act(() => stale?.onPositionChange([999, 999, 999]))
    expect((x as HTMLInputElement).value).toBe("invalid")
    await userEvent.clear(x)
    await userEvent.type(x, "7 mm")
    const cancelled = changes.mock.calls.at(-1)?.[0]?.translationGizmo
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(changes.mock.calls.at(-1)?.[0]).toBeNull()
    act(() => cancelled?.onPositionChange([999, 999, 999]))
    expect((x as HTMLInputElement).value).toBe("7 mm")
    f.unmount()
    expect(f.onSave).not.toHaveBeenCalled()
  })
  it("selects a signed Euler ring and submits its draft as one mutation", async () => {
    const changes = vi.fn((_value: PlacementManipulator | null) => {})
    const f = setup(save(), changes)
    await userEvent.click(screen.getByRole("button", { name: "Rotate Y" }))
    const ring = changes.mock.calls.at(-1)?.[0]?.angularGizmo
    expect(ring?.minAngle).toBe(-2 * Math.PI)
    act(() => ring?.onAngleChange(-Math.PI / 2))
    expect((screen.getByRole("combobox", { name: "Rotate Y" }) as HTMLInputElement).value).toBe(
      "-90 deg",
    )
    expect(f.onSave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Create placement" }))
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    expect(f.onSave).toHaveBeenCalledTimes(1)
    expect(changes.mock.calls.at(-1)?.[0]).toBeNull()
    act(() => ring?.onAngleChange(Math.PI))
    expect((screen.getByRole("combobox", { name: "Rotate Y" }) as HTMLInputElement).value).toBe(
      "-90 deg",
    )
  })
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
