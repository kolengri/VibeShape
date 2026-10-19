import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import { SplitForm } from "./split-form"
import { parseSplitForm, type SplitFormMode, splitFeatureRecord } from "./split-form-model"
import type { SplitManipulator, SplitPlaneResolver } from "./split-manipulator"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7802")
const targetId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7801")
const mode: SplitFormMode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "split.positive" },
  createFeatureId: () => featureId,
  featureLabel: "Split 1",
}
const copy = { ...messages.app.split, submit: messages.app.split.create }
const save = () =>
  vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const }))
function setup(
  options: {
    mode?: SplitFormMode
    onSave?: ReturnType<typeof save>
    status?: "ready" | "loading" | "error"
    unavailable?: boolean
    onManipulatorChange?: (value: SplitManipulator | null) => void
    resolvePlane?: SplitPlaneResolver
  } = {},
) {
  const onSave = options.onSave ?? save(),
    onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <SplitForm
        baseRevision={7}
        copy={copy}
        mode={options.mode ?? mode}
        sourceBounds={options.unavailable ? null : { min: [-5, -10, 0], max: [5, 10, 20] }}
        variables={[]}
        onCancel={onCancel}
        onSave={onSave}
        onSaved={onSaved}
        onPreviewChange={onPreviewChange}
        previewStatus={options.status ?? "ready"}
        onManipulatorChange={options.onManipulatorChange}
        resolvePlane={options.resolvePlane}
      />
    </I18nProvider>,
  )
  return { ...view, onSave, onSaved, onCancel, onPreviewChange }
}
afterEach(cleanup)
describe("Split form", () => {
  it("drags a signed plane offset without committing and releases callbacks on Cancel", async () => {
    const changes = vi.fn((_value: SplitManipulator | null) => {})
    const f = setup({ onManipulatorChange: changes })
    const initial = changes.mock.calls.at(-1)?.[0]
    expect(initial?.axialGizmo.distanceRange).toEqual({ min: -100_000, max: 100_000 })
    expect(initial?.toolPlane.origin).toEqual([0, 0, 10])
    act(() => initial?.axialGizmo.onDistanceChange(-3))
    expect((screen.getByRole("combobox", { name: "Plane offset" }) as HTMLInputElement).value).toBe(
      "-3 mm",
    )
    expect(f.onSave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("radio", { name: "XZ" }))
    const changed = changes.mock.calls.at(-1)?.[0]
    expect(changed?.axialGizmo.direction).toEqual([0, 1, 0])
    expect(changed?.toolPlane.origin).toEqual([0, -3, 10])
    act(() => initial?.axialGizmo.onDistanceChange(99))
    expect((screen.getByRole("combobox", { name: "Plane offset" }) as HTMLInputElement).value).toBe(
      "-3 mm",
    )
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(changes.mock.calls.at(-1)?.[0]).toBeNull()
    act(() => changed?.axialGizmo.onDistanceChange(99))
    expect((screen.getByRole("combobox", { name: "Plane offset" }) as HTMLInputElement).value).toBe(
      "-3 mm",
    )
    expect(f.onSave).not.toHaveBeenCalled()
  })
  it("blocks unresolved support planes and hides both their guide and handle", async () => {
    const changes = vi.fn((_value: SplitManipulator | null) => {})
    const f = setup({ onManipulatorChange: changes, resolvePlane: () => null })
    expect(changes.mock.calls.at(-1)?.[0]).toBeNull()
    expect(
      (screen.getByRole("button", { name: "Apply split" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Apply split" }))
    expect(f.onSave).not.toHaveBeenCalled()
    expect(f.onPreviewChange).not.toHaveBeenCalledWith(expect.objectContaining({ id: featureId }))
  })
  it("previews the exact target at its midpoint, retains offset on plane changes and recenters only explicitly", async () => {
    const f = setup()
    const offset = screen.getByRole("combobox", { name: "Plane offset" }) as HTMLInputElement
    expect(offset.value).toBe("10 mm")
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: featureId,
          parameters: expect.objectContaining({
            targetBody: mode.targetBody,
            offset: expect.objectContaining({ value: 10 }),
          }),
        }),
      ),
    )
    await userEvent.clear(offset)
    await userEvent.type(offset, "3 mm")
    await userEvent.click(screen.getByRole("radio", { name: "YZ" }))
    expect(offset.value).toBe("3 mm")
    await userEvent.click(screen.getByRole("button", { name: "Use body midpoint" }))
    expect(offset.value).toBe("0 mm")
    await userEvent.click(screen.getByRole("button", { name: "Apply split" }))
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    expect(f.onSave).toHaveBeenCalledTimes(1)
    expect(f.onSave).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        id: featureId,
        dependencies: [targetId],
        parameters: expect.objectContaining({
          targetBody: mode.targetBody,
          plane: "YZ",
          offset: expect.objectContaining({ value: 0 }),
        }),
      }),
    )
  })
  it("reopens expressions and releases a pending submission after rejection for retry", async () => {
    const parsed = parseSplitForm(
      { plane: "XZ", offset: "1 cm" },
      [],
      { length: "mm", angle: "deg" },
      copy,
    )
    if (!parsed.ok) throw new Error("Valid edit fixture required.")
    const feature = splitFeatureRecord(mode, featureId, parsed)
    let reject: ((error: Error) => void) | undefined
    const onSave = save().mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        }),
    )
    const changes = vi.fn((_value: SplitManipulator | null) => {})
    const f = setup({ mode: { kind: "edit", feature }, onSave, onManipulatorChange: changes })
    const old = changes.mock.calls.at(-1)?.[0]
    expect((screen.getByRole("combobox", { name: "Plane offset" }) as HTMLInputElement).value).toBe(
      "1 cm",
    )
    const apply = screen.getByRole("button", { name: "Apply split" }) as HTMLButtonElement
    await userEvent.click(apply)
    await userEvent.click(apply)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(apply.disabled).toBe(true)
    expect(changes.mock.calls.at(-1)?.[0]).toBeNull()
    act(() => old?.axialGizmo.onDistanceChange(50))
    expect((screen.getByRole("combobox", { name: "Plane offset" }) as HTMLInputElement).value).toBe(
      "1 cm",
    )
    reject?.(new Error("Storage unavailable"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(copy.saveFailed))
    expect(changes.mock.calls.at(-1)?.[0]?.axialGizmo.distance).toBe(10)
    expect(apply.disabled).toBe(false)
    onSave.mockResolvedValue({ ok: true })
    await userEvent.click(apply)
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[1]?.[1]).toEqual(feature)
  })
  it.each([{ status: "error" as const }, { status: "loading" as const }, { unavailable: true }])(
    "blocks Apply without exact valid preview or source %j",
    (options) => {
      setup(options)
      expect(
        (screen.getByRole("button", { name: "Apply split" }) as HTMLButtonElement).disabled,
      ).toBe(true)
    },
  )
  it("cancels without saving and disposes the preview on unmount", async () => {
    const f = setup()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(f.onCancel).toHaveBeenCalledTimes(1)
    expect(f.onSave).not.toHaveBeenCalled()
    f.unmount()
    expect(f.onPreviewChange).toHaveBeenLastCalledWith(null)
  })
})
