import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FeatureRecord } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { PatternForm } from "./pattern-form"
import {
  type PatternFormMode,
  parsePatternForm,
  patternFeatureRecord,
  patternFormValues,
} from "./pattern-form-model"
import {
  copy,
  countVariable,
  featureId,
  lineId,
  mode,
  pathSketch,
  pathStartId,
  paths,
  snapshot,
  targetId,
  units,
} from "./pattern-test-fixtures"
import type { PatternPathPickingRequest } from "./use-pattern-path-picking"

const save = () =>
  vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const }))
function setup(
  options: {
    mode?: PatternFormMode
    onSave?: ReturnType<typeof save>
    status?: "ready" | "loading" | "error"
    unavailable?: boolean
    referenceOptions?: { planes: []; axes: [] }
    pickingRequest?: PatternPathPickingRequest | null
  } = {},
) {
  const onSave = options.onSave ?? save(),
    onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn(),
    onPickingContextChange = vi.fn()
  const form = (pickingRequest: PatternPathPickingRequest | null | undefined) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <PatternForm
        snapshot={snapshot}
        paths={paths}
        pickingRequest={pickingRequest}
        onPickingContextChange={onPickingContextChange}
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
    </I18nProvider>
  )
  const view = render(form(options.pickingRequest))
  return {
    ...view,
    onSave,
    onSaved,
    onCancel,
    onPreviewChange,
    onPickingContextChange,
    pick: (request: PatternPathPickingRequest) => view.rerender(form(request)),
  }
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
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    expect(f.onSave).toHaveBeenCalledTimes(1)
    expect(f.onSave).toHaveBeenCalledWith(
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
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
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
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(apply.disabled).toBe(true)
    reject?.(new Error("Storage unavailable"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(copy.saveFailed))
    expect(apply.disabled).toBe(false)
    onSave.mockResolvedValue({ ok: true })
    await userEvent.click(apply)
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
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
  it("authors a fixed-spacing path pattern with its sketch and orientation intent", async () => {
    const f = setup()
    await userEvent.click(screen.getByRole("radio", { name: "Path" }))
    const apply = screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    expect(screen.getByText(copy.invalidPath)).toBeTruthy()
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Path sketch" }),
      pathSketch.id,
    )
    await userEvent.click(screen.getByRole("checkbox", { name: "Line 3" }))
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Path start point" }),
      pathStartId,
    )
    await userEvent.click(screen.getByRole("radio", { name: "Fixed distance" }))
    const distance = screen.getByRole("combobox", { name: "Distance between instances" })
    await userEvent.clear(distance)
    await userEvent.type(distance, "25 mm")
    const offset = screen.getByRole("combobox", { name: "Start offset" })
    await userEvent.clear(offset)
    await userEvent.type(offset, "5 mm")
    await userEvent.click(screen.getByRole("radio", { name: "Follow path" }))
    await userEvent.click(screen.getByRole("checkbox", { name: "Reverse direction" }))
    expect(apply.disabled).toBe(false)
    await userEvent.click(apply)
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
    expect(f.onSave).toHaveBeenCalledTimes(1)
    expect(f.onSave.mock.calls[0]?.[1]).toMatchObject({
      type: { schemaVersion: 3 },
      dependencies: [targetId],
      parameters: {
        kind: "path",
        targetBody: mode.targetBody,
        path: { sketchId: pathSketch.id, entityIds: [lineId], startPointId: pathStartId },
        spacing: { mode: "fixed", distance: { value: 25 } },
        startOffset: { value: 5 },
        orientation: "follow",
        reverse: true,
      },
    })
  })
  it("toggles viewport-picked path curves through the same form state", async () => {
    const f = setup()
    await userEvent.click(screen.getByRole("radio", { name: "Path" }))
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Path sketch" }),
      pathSketch.id,
    )
    await waitFor(() =>
      expect(f.onPickingContextChange).toHaveBeenLastCalledWith({
        featureId,
        sketchId: pathSketch.id,
      }),
    )
    const request = { requestId: 1, featureId, sketchId: pathSketch.id, entityId: lineId }
    f.pick(request)
    await waitFor(() =>
      expect((screen.getByRole("checkbox", { name: "Line 3" }) as HTMLInputElement).checked).toBe(
        true,
      ),
    )
    // The same request is consumed once; a new request toggles the curve off again.
    f.pick(request)
    expect((screen.getByRole("checkbox", { name: "Line 3" }) as HTMLInputElement).checked).toBe(
      true,
    )
    f.pick({ ...request, requestId: 2 })
    await waitFor(() =>
      expect((screen.getByRole("checkbox", { name: "Line 3" }) as HTMLInputElement).checked).toBe(
        false,
      ),
    )
    await userEvent.click(screen.getByRole("radio", { name: "Linear" }))
    await waitFor(() => expect(f.onPickingContextChange).toHaveBeenLastCalledWith(null))
  })
  it("reconciles the start point and clears save errors when a viewport pick deselects a curve", async () => {
    const onSave = save().mockRejectedValueOnce(new Error("Storage unavailable"))
    const f = setup({ onSave })
    await userEvent.click(screen.getByRole("radio", { name: "Path" }))
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Path sketch" }),
      pathSketch.id,
    )
    await userEvent.click(screen.getByRole("checkbox", { name: "Line 3" }))
    const start = screen.getByRole("combobox", { name: "Path start point" }) as HTMLSelectElement
    await userEvent.selectOptions(start, pathStartId)
    await userEvent.click(screen.getByRole("button", { name: "Apply feature" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(copy.saveFailed))
    f.pick({ requestId: 1, featureId, sketchId: pathSketch.id, entityId: lineId })
    await waitFor(() =>
      expect((screen.getByRole("checkbox", { name: "Line 3" }) as HTMLInputElement).checked).toBe(
        false,
      ),
    )
    expect(start.value).toBe("")
    expect(screen.queryByText(copy.saveFailed)).toBeNull()
  })
  it("explains failed path previews with path-specific guidance", async () => {
    setup({ status: "error" })
    expect(screen.getByText(copy.previewFailed)).toBeTruthy()
    await userEvent.click(screen.getByRole("radio", { name: "Path" }))
    expect(screen.getByText(copy.pathPreviewFailed)).toBeTruthy()
    expect(screen.queryByText(copy.previewFailed)).toBeNull()
  })
  it("reopens a path pattern with its authored path values", () => {
    const parsed = parsePatternForm(
      {
        ...patternFormValues(mode, units),
        kind: "path",
        pathSketchId: pathSketch.id,
        entityIds: [lineId],
        startPointId: pathStartId,
        orientation: "follow",
      },
      [countVariable],
      units,
      copy,
    )
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    const feature = patternFeatureRecord(mode, featureId, parsed, undefined, snapshot)
    setup({ mode: { kind: "edit", feature } })
    expect((screen.getByRole("radio", { name: "Path" }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole("checkbox", { name: "Line 3" }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByRole("radio", { name: "Follow path" }) as HTMLInputElement).checked).toBe(
      true,
    )
  })
  it("cancels without committing and disposes its preview", async () => {
    const f = setup()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(f.onCancel).toHaveBeenCalledTimes(1)
    expect(f.onSave).not.toHaveBeenCalled()
    f.unmount()
    expect(f.onPreviewChange).toHaveBeenLastCalledWith(null)
  })
})
