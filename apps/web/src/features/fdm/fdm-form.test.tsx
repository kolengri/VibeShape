import "../../../../../tests/unit/support/dom"
import { afterEach, beforeAll, beforeEach, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import { FdmForm } from "./fdm-form"
import type { FdmToolKind } from "./fdm-form-fields"
import { fdmFormFeature, fdmFormValues, parseFdmForm } from "./fdm-form-model"

const id = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f8100")
const mode = { kind: "create" as const, createFeatureId: () => id, featureLabel: "Coupon" }
const units = { length: "mm", angle: "deg" } as const
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function setup(
  onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const })),
  kind: FdmToolKind = "calibration-coupon",
) {
  const onSaved = vi.fn(),
    onPreviewChange = vi.fn(),
    onKindChange = vi.fn()
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <FdmForm
        kind={kind}
        onKindChange={onKindChange}
        mode={mode}
        baseRevision={3}
        variables={[]}
        options={[]}
        sketches={[]}
        frameOptions={{ planes: [], axes: [] }}
        onCancel={vi.fn()}
        onSave={onSave}
        onSaved={onSaved}
        onPreviewChange={onPreviewChange}
        previewStatus="ready"
      />
    </I18nProvider>,
  )
  return { onSave, onSaved, onPreviewChange, onKindChange }
}
it("previews and saves editable coupon parameters with a stable feature identity", async () => {
  const f = setup()
  fireEvent.change(screen.getByRole("combobox", { name: "First hole diameter" }), {
    target: { value: "4 mm" },
  })
  await waitFor(() =>
    expect(f.onPreviewChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        parameters: expect.objectContaining({
          diameterStart: expect.objectContaining({ value: 4 }),
        }),
      }),
    ),
  )
  await userEvent.click(screen.getByRole("button", { name: "Create" }))
  await waitFor(() => expect(f.onSave).toHaveBeenCalledTimes(1))
  const parameters = f.onSave.mock.calls[0]?.[1]
  expect(parameters?.id).toBe(id)
  expect(parameters?.parameters).toMatchObject({
    kind: "calibration-coupon",
    holeCount: 5,
    diameterStart: { value: 4 },
  })
  expect(f.onSaved).toHaveBeenCalledTimes(1)
})
it("prevents overlapping holes and recovers after a rejected save", async () => {
  const onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => {
    throw new Error("offline")
  })
  const f = setup(onSave)
  fireEvent.change(screen.getByRole("combobox", { name: "Center spacing" }), {
    target: { value: "1 mm" },
  })
  expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByRole("combobox", { name: "Center spacing" }), {
    target: { value: "8 mm" },
  })
  await userEvent.click(screen.getByRole("button", { name: "Create" }))
  await waitFor(() => expect(screen.getByText(messages.app.fdm.saveFailed)).toBeTruthy())
  expect(f.onSaved).not.toHaveBeenCalled()
  expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false)
})
it("restores the coupon feature with its authored dimensions", () => {
  const parsed = parseFdmForm(
    "calibration-coupon",
    fdmFormValues("calibration-coupon", mode),
    [],
    [],
    [],
    units,
    messages.app.fdm,
  )
  if (!parsed.ok) throw new Error("Invalid fixture")
  const feature = fdmFormFeature(mode, id, parsed)
  expect(fdmFormValues("calibration-coupon", { kind: "edit", feature }).fields).toMatchObject({
    diameterStart: "3 mm",
    diameterStep: "0.1 mm",
    holeCount: "5",
  })
})

it("limits wall extension to Web and clears the incompatible setting when choosing Rib", async () => {
  setup(undefined, "web")
  await userEvent.click(screen.getByRole("checkbox", { name: "Extend lines to cavity walls" }))
  await userEvent.click(screen.getByRole("radio", { name: "Rib / gusset" }))
  expect(screen.queryByRole("checkbox", { name: "Extend lines to cavity walls" })).toBeNull()
  await userEvent.click(screen.getByRole("radio", { name: /^Web$/ }))
  expect(
    (screen.getByRole("checkbox", { name: "Extend lines to cavity walls" }) as HTMLInputElement)
      .checked,
  ).toBe(false)
})

it("pairs all twelve FDM tool choices with distinct decorative artwork", async () => {
  setup()
  await userEvent.click(screen.getByRole("combobox", { name: messages.app.fdm.kind }))
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(12))
  const options = screen.getAllByRole("option")
  const ids = options.map((option) =>
    option.querySelector("svg[data-icon]")?.getAttribute("data-icon"),
  )
  expect(new Set(ids).size).toBe(12)
  expect(ids).toContain("fdm-insert-pocket")
  expect(ids).toContain("fdm-membrane")
  for (const option of options)
    expect(option.querySelector("svg[data-icon]")?.getAttribute("aria-hidden")).toBe("true")
})
