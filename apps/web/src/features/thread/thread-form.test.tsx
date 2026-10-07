// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FeatureRecord } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { ThreadForm } from "./thread-form"
import {
  parseThreadForm,
  type ThreadFormMode,
  threadFeatureRecord,
  threadFormValues,
} from "./thread-form-model"
import { copy, featureId, mode, pitchVariable, units } from "./thread-test-fixtures"

const save = () =>
  vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const }))
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
function setup(
  options: {
    mode?: ThreadFormMode
    onSave?: ReturnType<typeof save>
    status?: "ready" | "loading" | "error"
    unavailable?: boolean
    axisOptions?: boolean
  } = {},
) {
  const onSave = options.onSave ?? save(),
    onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <ThreadForm
        baseRevision={7}
        copy={copy}
        mode={options.mode ?? mode}
        sourceAvailable={!options.unavailable}
        axisOptions={
          options.axisOptions
            ? {
                planes: [],
                axes: [
                  {
                    key: "authored-axis",
                    label: "Authored axis",
                    support: {
                      kind: "explicit-axis",
                      origin: [0, 0, 0],
                      direction: [0, 0, 1],
                    },
                  },
                ],
              }
            : undefined
        }
        variables={[pitchVariable]}
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
describe("Modeled Thread form", () => {
  it("applies a metric diameter/pitch preset while preserving custom parameters and edits", async () => {
    const f = setup()
    const depth = screen.getByRole("combobox", { name: "Groove depth" })
    fireEvent.change(depth, { target: { value: "0.6 mm" } })
    fireEvent.keyDown(screen.getByRole("combobox", { name: copy.metricSize }), { key: "Enter" })
    await userEvent.click(screen.getByRole("option", { name: "M8 × 1.25" }))
    expect(
      (screen.getByRole("combobox", { name: copy.nominalDiameter }) as HTMLInputElement).value,
    ).toBe("8 mm")
    expect((screen.getByRole("combobox", { name: copy.pitch }) as HTMLInputElement).value).toBe(
      "1.25 mm",
    )
    expect((depth as HTMLInputElement).value).toBe("0.6 mm")
    fireEvent.change(screen.getByRole("combobox", { name: copy.pitch }), {
      target: { value: "#step" },
    })
    expect(screen.getByRole("combobox", { name: copy.metricSize }).textContent).toContain(
      copy.customSize,
    )
    await userEvent.click(screen.getByRole("button", { name: "Apply feature" }))
    await waitFor(() => expect(f.onSave).toHaveBeenCalledOnce())
    expect(f.onSave.mock.calls[0]?.[1].parameters).toMatchObject({
      nominalDiameter: { value: 8 },
      pitch: { value: 2, source: { expression: "#step" } },
      depth: { value: 0.6 },
    })
    expect(f.onSave.mock.calls[0]?.[1].parameters).not.toHaveProperty("metricSize")
  })
  it("ignores hidden origin errors for a reference axis and restores them on returning to legacy controls", async () => {
    const f = setup({ axisOptions: true })
    await userEvent.click(screen.getByText(copy.advanced))
    const origin = screen.getByRole("combobox", { name: "Origin X" })
    await userEvent.clear(origin)
    await userEvent.type(origin, "invalid")
    const apply = screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.change(screen.getByRole("combobox", { name: "Reference source" }), {
      target: { value: "authored-axis" },
    })
    expect(screen.queryByRole("combobox", { name: "Origin X" })).toBeNull()
    expect(apply.disabled).toBe(false)
    await userEvent.click(apply)
    await waitFor(() => expect(f.onSave).toHaveBeenCalledOnce())
    expect(f.onSave.mock.calls[0]?.[1]).toMatchObject({
      type: { schemaVersion: 2 },
      parameters: { axis: { kind: "explicit-axis", origin: [0, 0, 0], direction: [0, 0, 1] } },
    })
    await userEvent.click(screen.getByRole("radio", { name: /^X$/ }))
    expect((screen.getByRole("combobox", { name: "Origin X" }) as HTMLInputElement).value).toBe(
      "invalid",
    )
    expect(apply.disabled).toBe(true)
  })
  it("exposes radial allowance and advanced explicit frame/direction while retaining variable pitch", async () => {
    const f = setup()
    expect(screen.getByText(copy.clearanceDescription)).toBeTruthy()
    await userEvent.click(screen.getByText(copy.advanced))
    await userEvent.click(screen.getByRole("radio", { name: "X" }))
    await userEvent.click(screen.getByRole("radio", { name: "Left-hand" }))
    const origin = screen.getByRole("combobox", { name: "Origin X" })
    await userEvent.clear(origin)
    await userEvent.type(origin, "12 mm")
    const pitch = screen.getByRole("combobox", { name: "Pitch" })
    await userEvent.clear(pitch)
    await userEvent.type(pitch, "#step")
    await userEvent.click(screen.getByRole("button", { name: "Apply feature" }))
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce())
    expect(f.onSave).toHaveBeenCalledExactlyOnceWith(
      7,
      expect.objectContaining({
        parameters: expect.objectContaining({
          targetBody: mode.targetBody,
          axis: "X",
          handedness: "left",
          origin: expect.objectContaining({ x: expect.objectContaining({ value: 12 }) }),
          pitch: expect.objectContaining({
            value: 2,
            source: expect.objectContaining({ expression: "#step" }),
          }),
        }),
      }),
    )
  })
  it("opens advanced options for invalid starts and blocks preview/Apply with an actionable diagnostic", async () => {
    const f = setup()
    await userEvent.click(screen.getByText(copy.advanced))
    const starts = screen.getByRole("combobox", { name: "Starts" })
    await userEvent.clear(starts)
    await userEvent.type(starts, "2 mm")
    expect(screen.getByText(copy.invalidScalarDimension)).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await waitFor(() => expect(f.onPreviewChange).toHaveBeenLastCalledWith(null))
    expect(f.onSave).not.toHaveBeenCalled()
  })
  it("keeps explicitly opened advanced options visible after correcting invalid starts", async () => {
    setup()
    const details = screen.getByText(copy.advanced).closest("details")
    if (!details) throw new Error("Thread advanced disclosure is missing.")
    details.open = true
    fireEvent(details, new Event("toggle"))
    const starts = screen.getByRole("combobox", { name: "Starts" })
    await userEvent.clear(starts)
    await userEvent.type(starts, "2 mm")
    expect(screen.getByText(copy.invalidScalarDimension)).toBeTruthy()
    await userEvent.clear(starts)
    await userEvent.type(starts, "1")
    expect(details.open).toBe(true)
    expect(screen.getByRole("combobox", { name: "Run-in allowance" })).toBeTruthy()
  })
  it("reopens raw parameters, prevents duplicate submissions and releases a rejected save for retry", async () => {
    const parsed = parseThreadForm(
      { ...threadFormValues(mode, units), pitch: "#step" },
      mode,
      [pitchVariable],
      units,
      copy,
    )
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    const feature = threadFeatureRecord(mode, featureId, parsed)
    let reject: ((error: Error) => void) | undefined
    const onSave = save().mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        }),
    )
    const f = setup({ mode: { kind: "edit", feature }, onSave })
    expect((screen.getByRole("combobox", { name: "Pitch" }) as HTMLInputElement).value).toBe(
      "#step",
    )
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
  it.each([{ status: "loading" as const }, { status: "error" as const }, { unavailable: true }])(
    "blocks Apply when exact native geometry is unavailable %j",
    (options) => {
      setup(options)
      expect(
        (screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement).disabled,
      ).toBe(true)
    },
  )
  it("cancels without saving and disposes the preview", async () => {
    const f = setup()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(f.onCancel).toHaveBeenCalledOnce()
    expect(f.onSave).not.toHaveBeenCalled()
    f.unmount()
    expect(f.onPreviewChange).toHaveBeenLastCalledWith(null)
  })
})
