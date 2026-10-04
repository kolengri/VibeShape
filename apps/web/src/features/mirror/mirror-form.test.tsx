// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createLengthQuantity,
  type FeatureRecord,
  featureIdSchema,
  mirrorFeatureTypeV2,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import { MirrorForm } from "./mirror-form"
import { type MirrorFormMode, mirrorFeatureRecord } from "./mirror-form-model"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7802")
const target = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7801")
const mode: MirrorFormMode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: target, outputRole: "body.primary" },
  createFeatureId: () => featureId,
  featureLabel: "Mirror 1",
}
const copy = { ...messages.app.mirror, submit: messages.app.mirror.create }
const save = () =>
  vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const }))
function setup(
  options: {
    mode?: MirrorFormMode
    onSave?: ReturnType<typeof save>
    disabled?: boolean
    status?: "ready" | "loading"
  } = {},
) {
  const onSave = options.onSave ?? save()
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  const onPreviewChange = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <MirrorForm
        baseRevision={7}
        copy={copy}
        mode={options.mode ?? mode}
        variables={[]}
        disabled={options.disabled ?? false}
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
describe("Mirror form", () => {
  it("previews a stable exact body and applies the selected plane through one revision-bound command", async () => {
    const f = setup()
    expect(screen.getByText(/result replaces the current part/)).toBeTruthy()
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: featureId,
          parameters: expect.objectContaining({
            targetBody: mode.kind === "create" ? mode.targetBody : null,
            plane: "XY",
            preserveSource: false,
            offset: expect.objectContaining({ value: 0 }),
          }),
        }),
      ),
    )
    await userEvent.click(screen.getByRole("radio", { name: "YZ" }))
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: featureId,
          parameters: expect.objectContaining({ plane: "YZ" }),
        }),
      ),
    )
    await userEvent.click(screen.getByRole("button", { name: "Create mirror" }))
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce())
    expect(f.onSave).toHaveBeenCalledExactlyOnceWith(
      7,
      expect.objectContaining({
        id: featureId,
        dependencies: [target],
        type: mirrorFeatureTypeV2.type,
        parameters: expect.objectContaining({
          targetBody: { schemaVersion: 0, featureId: target, outputRole: "body.primary" },
          plane: "YZ",
          preserveSource: false,
          offset: expect.objectContaining({ value: 0 }),
        }),
      }),
    )
  })
  it("keeps edit identity and target while preserving values after storage rejection", async () => {
    const onSave = save().mockRejectedValue(new Error("Storage unavailable"))
    const feature = mirrorFeatureRecord(mode, featureId, "XZ")
    const f = setup({ mode: { kind: "edit", feature }, onSave })
    expect((screen.getByRole("radio", { name: "XZ" }) as HTMLInputElement).checked).toBe(true)
    await userEvent.click(screen.getByRole("radio", { name: "XY" }))
    await userEvent.click(screen.getByRole("button", { name: "Create mirror" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(copy.saveFailed))
    expect(f.onSaved).not.toHaveBeenCalled()
    expect((screen.getByRole("radio", { name: "XY" }) as HTMLInputElement).checked).toBe(true)
    onSave.mockResolvedValue({ ok: true })
    await userEvent.click(screen.getByRole("button", { name: "Create mirror" }))
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[1]?.[1]).toMatchObject({
      id: featureId,
      type: feature.type,
      dependencies: [target],
      parameters: { targetBody: feature.parameters.targetBody, plane: "XY" },
    })
  })
  it("previews and saves a separate reflected part with a signed unit-aware offset", async () => {
    const f = setup()
    const offset = screen.getByRole("combobox", { name: "Plane offset" })
    await userEvent.clear(offset)
    await userEvent.type(offset, "-1 in")
    await userEvent.click(screen.getByRole("checkbox", { name: "Preserve source part" }))
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: mirrorFeatureTypeV2.type,
          parameters: expect.objectContaining({
            preserveSource: true,
            offset: expect.objectContaining({
              value: -25.4,
              source: expect.objectContaining({ expression: "-1 in" }),
            }),
          }),
        }),
      ),
    )
    await userEvent.click(screen.getByRole("button", { name: "Create mirror" }))
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce())
    expect(f.onSave.mock.calls[0]?.[1]).toMatchObject({
      id: featureId,
      type: mirrorFeatureTypeV2.type,
      dependencies: [target],
      parameters: {
        targetBody: mode.kind === "create" ? mode.targetBody : null,
        preserveSource: true,
        offset: { value: -25.4 },
      },
    })
  })
  it("preserves all v2 values and edit identity when changing only the plane", async () => {
    const base = mirrorFeatureRecord(mode, featureId, "XZ")
    const feature = {
      ...base,
      type: mirrorFeatureTypeV2.type,
      parameters: {
        ...base.parameters,
        offset: createLengthQuantity(-2, "cm"),
        preserveSource: true,
      },
    }
    const f = setup({ mode: { kind: "edit", feature } })
    expect(screen.getByRole("combobox", { name: "Plane offset" }).getAttribute("value")).toBe(
      "-2 cm",
    )
    expect(
      (screen.getByRole("checkbox", { name: "Preserve source part" }) as HTMLInputElement).checked,
    ).toBe(true)
    await userEvent.click(screen.getByRole("radio", { name: "YZ" }))
    await userEvent.click(screen.getByRole("button", { name: "Create mirror" }))
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce())
    expect(f.onSave.mock.calls[0]?.[1]).toMatchObject({
      id: featureId,
      type: mirrorFeatureTypeV2.type,
      parameters: {
        plane: "YZ",
        preserveSource: true,
        offset: { value: -20, source: { expression: "-2 cm" } },
      },
    })
  })
  it("invalidates preview and focuses invalid offset without saving", async () => {
    const f = setup()
    const offset = screen.getByRole("combobox", { name: "Plane offset" })
    await userEvent.clear(offset)
    await userEvent.type(offset, "100001 mm")
    await waitFor(() => expect(f.onPreviewChange).toHaveBeenLastCalledWith(null))
    await userEvent.click(screen.getByRole("button", { name: "Create mirror" }))
    await waitFor(() => expect(screen.getByText(copy.validationSummary)).toBeTruthy())
    expect(screen.getByText(copy.invalidRange).getAttribute("role")).toBe("alert")
    expect(document.activeElement).toBe(offset)
    expect(f.onSave).not.toHaveBeenCalled()
  })
  it("cancels without saving and disposes the preview on unmount", async () => {
    const f = setup()
    await userEvent.click(screen.getByRole("radio", { name: "YZ" }))
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(f.onCancel).toHaveBeenCalledOnce()
    expect(f.onSave).not.toHaveBeenCalled()
    f.unmount()
    expect(f.onPreviewChange).toHaveBeenLastCalledWith(null)
  })
  it.each([{ disabled: true }, { status: "loading" as const }])(
    "prevents Apply when the document or exact preview is unavailable %j",
    (options) => {
      setup(options)
      expect(
        (screen.getByRole("button", { name: "Create mirror" }) as HTMLButtonElement).disabled,
      ).toBe(true)
    },
  )
  it("prevents duplicate pending Apply and permits retry after rejection", async () => {
    let reject: ((error: Error) => void) | undefined
    const onSave = save().mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        }),
    )
    const f = setup({ onSave })
    const apply = screen.getByRole("button", { name: "Create mirror" })
    await userEvent.click(apply)
    await userEvent.click(apply)
    expect(onSave).toHaveBeenCalledOnce()
    expect((apply as HTMLButtonElement).disabled).toBe(true)
    reject?.(new Error("Unavailable"))
    await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false))
    expect(f.onSaved).not.toHaveBeenCalled()
  })
})
