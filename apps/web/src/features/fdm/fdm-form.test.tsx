import "../../../../../tests/unit/support/dom"
import { afterEach, beforeAll, beforeEach, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  type FeatureRecord,
  featureIdSchema,
  type SketchRecord,
  sketchRecordSchema,
} from "@vibeshape/domain"
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
  sketches: readonly SketchRecord[] = [],
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
        sketches={sketches}
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

it("clears a saved sketch and its selected lines before choosing it again", async () => {
  const pointA = "0195b5ac-b220-7a2c-8c33-67a36a7f8102"
  const pointB = "0195b5ac-b220-7a2c-8c33-67a36a7f8103"
  const lineId = "0195b5ac-b220-7a2c-8c33-67a36a7f8104"
  const sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f8101",
    label: "Web profile",
    plane: "xy",
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 0, y: 0, construction: false },
      { schemaVersion: 0, id: pointB, type: "point", x: 10, y: 0, construction: false },
      {
        schemaVersion: 0,
        id: lineId,
        type: "line",
        startPointId: pointA,
        endPointId: pointB,
        construction: false,
      },
    ],
    constraints: [],
  })
  const user = userEvent.setup()
  const f = setup(undefined, "web", [sketch])
  const picker = screen.getByRole("combobox", { name: "Saved sketch" })
  await user.click(picker)
  await user.click(screen.getByRole("option", { name: "Web profile" }))
  const line = screen.getByRole("checkbox", { name: "Line 1" }) as HTMLInputElement
  await user.click(line)
  expect(line.checked).toBe(true)
  await user.click(picker)
  await user.click(screen.getByRole("option", { name: "Choose a saved sketch" }))
  expect(picker.textContent).toBe("Choose a saved sketch")
  expect(screen.queryByRole("checkbox", { name: "Line 1" })).toBeNull()
  expect(screen.queryByText(`Unavailable line: ${lineId}`)).toBeNull()
  await user.click(picker)
  expect(
    screen.getByRole("option", { name: "Choose a saved sketch" }).getAttribute("aria-current"),
  ).toBe("true")
  await user.click(screen.getByRole("option", { name: "Web profile" }))
  expect((screen.getByRole("checkbox", { name: "Line 1" }) as HTMLInputElement).checked).toBe(false)
  expect(f.onSave).not.toHaveBeenCalled()
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
