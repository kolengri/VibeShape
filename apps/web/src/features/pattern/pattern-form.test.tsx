// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FeatureRecord } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { PatternForm } from "./pattern-form"
import {
  type PatternFormMode,
  parsePatternForm,
  patternFeatureRecord,
  patternFormValues,
} from "./pattern-form-model"
import { copy, countVariable, featureId, mode, units } from "./pattern-test-fixtures"

const save = () =>
  vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const }))
function setup(
  options: {
    mode?: PatternFormMode
    onSave?: ReturnType<typeof save>
    status?: "ready" | "loading" | "error"
    unavailable?: boolean
    referenceOptions?: { planes: []; axes: [] }
  } = {},
) {
  const onSave = options.onSave ?? save(),
    onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <PatternForm
        referenceOptions={options.referenceOptions}
        baseRevision={7}
        copy={copy}
        mode={options.mode ?? mode}
        sourceAvailable={!options.unavailable}
        variables={[countVariable]}
        onCancel={onCancel}
        onSave={onSave}
        onSaved={onSaved}
        onPreviewChange={onPreviewChange}
        previewStatus={options.status ?? "ready"}
      />
    </I18nProvider>,
  )
  return { ...view, onSave, onSaved, onCancel, onPreviewChange }
}
afterEach(cleanup)
describe("Body Pattern form", () => {
  it("retains buffered kind-specific fields and submits the exact variable count once", async () => {
    const f = setup()
    const spacing = screen.getByRole("combobox", { name: "Spacing" }) as HTMLInputElement
    await userEvent.clear(spacing)
    await userEvent.type(spacing, "-12 mm")
    const count = screen.getByRole("combobox", { name: "Instance count" })
    await userEvent.clear(count)
    await userEvent.type(count, "#instances")
    await userEvent.click(screen.getByRole("radio", { name: "Circular" }))
    const angle = screen.getByRole("combobox", { name: "Total angle" }) as HTMLInputElement
    await userEvent.clear(angle)
    await userEvent.type(angle, "-180 deg")
    await userEvent.click(screen.getByRole("radio", { name: "Linear" }))
    expect((screen.getByRole("combobox", { name: "Spacing" }) as HTMLInputElement).value).toBe(
      "-12 mm",
    )
    await userEvent.click(screen.getByRole("radio", { name: "Circular" }))
    expect((screen.getByRole("combobox", { name: "Total angle" }) as HTMLInputElement).value).toBe(
      "-180 deg",
    )
    await userEvent.click(screen.getByRole("radio", { name: "Z" }))
    await userEvent.click(screen.getByRole("button", { name: "Apply feature" }))
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce())
    expect(f.onSave).toHaveBeenCalledExactlyOnceWith(
      7,
      expect.objectContaining({
        id: featureId,
        parameters: expect.objectContaining({
          kind: "circular",
          axis: "Z",
          targetBody: mode.targetBody,
          count: expect.objectContaining({
            value: 4,
            source: expect.objectContaining({ expression: "#instances" }),
          }),
        }),
      }),
    )
  })
  it("allows Apply after switching an invalid legacy center to an explicit axis", async () => {
    const f = setup({ referenceOptions: { planes: [], axes: [] } })
    await userEvent.click(screen.getByRole("radio", { name: "Circular" }))
    const center = screen.getByRole("combobox", { name: "Center X" })
    await userEvent.clear(center)
    await userEvent.type(center, "bad")
    const apply = screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Reference source" }),
      "explicit",
    )
    expect(screen.queryByRole("combobox", { name: "Center X" })).toBeNull()
    expect(apply.disabled).toBe(false)
    await userEvent.click(apply)
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce())
    expect(f.onSave.mock.calls[0]?.[1]).toMatchObject({
      type: { schemaVersion: 2 },
      parameters: {
        kind: "circular",
        axis: { kind: "explicit-axis", origin: [0, 0, 0], direction: [0, 0, 1] },
      },
    })
  })
  it("blocks invalid count and exposes its scalar/integer diagnostic before preview", async () => {
    const f = setup()
    const count = screen.getByRole("combobox", { name: "Instance count" })
    await userEvent.clear(count)
    await userEvent.type(count, "3 mm")
    expect(screen.getByText(copy.invalidCountDimension)).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await waitFor(() => expect(f.onPreviewChange).toHaveBeenLastCalledWith(null))
    expect(f.onSave).not.toHaveBeenCalled()
  })
  it("reopens count intent and releases a pending submission lock on rejection", async () => {
    const parsed = parsePatternForm(
      { ...patternFormValues(mode, units), count: "#instances" },
      [countVariable],
      units,
      copy,
    )
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    const feature = patternFeatureRecord(mode, featureId, parsed)
    let reject: ((error: Error) => void) | undefined
    const onSave = save().mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        }),
    )
    const f = setup({ mode: { kind: "edit", feature }, onSave })
    expect(
      (screen.getByRole("combobox", { name: "Instance count" }) as HTMLInputElement).value,
    ).toBe("#instances")
    const apply = screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement
    await userEvent.click(apply)
    await userEvent.click(apply)
    expect(onSave).toHaveBeenCalledOnce()
    expect(apply.disabled).toBe(true)
    reject?.(new Error("Storage unavailable"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(copy.saveFailed))
    expect(apply.disabled).toBe(false)
    onSave.mockResolvedValue({ ok: true })
    await userEvent.click(apply)
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[1]?.[1]).toEqual(feature)
  })
  it.each([{ status: "error" as const }, { status: "loading" as const }, { unavailable: true }])(
    "blocks Apply without exact ready geometry %j",
    (options) => {
      setup(options)
      expect(
        (screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement).disabled,
      ).toBe(true)
    },
  )
  it("cancels without committing and disposes its preview", async () => {
    const f = setup()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(f.onCancel).toHaveBeenCalledOnce()
    expect(f.onSave).not.toHaveBeenCalled()
    f.unmount()
    expect(f.onPreviewChange).toHaveBeenLastCalledWith(null)
  })
})
