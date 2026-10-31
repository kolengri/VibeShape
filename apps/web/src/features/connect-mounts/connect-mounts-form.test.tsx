import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import { editPartDesignTool, modifyingSolidTargetFeatures } from "../part-design/part-design-tool"
import { ConnectMountsForm } from "./connect-mounts-form"
import type { ConnectMountsFormMode } from "./connect-mounts-form-model"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7812")
const mode: ConnectMountsFormMode = {
  kind: "create",
  createFeatureId: () => featureId,
  featureLabel: "Connect Mounts 1",
}
const copy = messages.app.connectMounts
const originalScrollIntoView = Element.prototype.scrollIntoView
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Element.prototype.scrollIntoView = originalScrollIntoView
})

function setup(
  status: "ready" | "loading" | "error" = "ready",
  formMode = mode,
  onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const })),
) {
  const onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <ConnectMountsForm
        baseRevision={7}
        mode={formMode}
        variables={[]}
        modelPoints={[{ id: "face-source", label: "Box 1 · Face 1 center", position: [12, -8, 4] }]}
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

describe("Connect Mounts parameter lifecycle", () => {
  it("copies a face center, previews model coordinates, and saves one ordinary feature mutation", async () => {
    const user = userEvent.setup(),
      view = setup()
    await user.click(screen.getByRole("combobox", { name: "Copy model center to point 1" }))
    await user.click(screen.getByRole("option", { name: "Box 1 · Face 1 center" }))
    expect(screen.getByRole("combobox", { name: "Point 1 X" }).getAttribute("value")).toBe("12 mm")
    await user.click(screen.getByRole("radio", { name: copy.complete }))
    await waitFor(() =>
      expect(view.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: {
            points: [
              [12, -8, 4],
              [20, 0, 0],
            ],
            nodeRadius: 3,
            strutRadius: 1.5,
            connectionMode: "complete",
          },
        }),
      ),
    )
    expect(view.onSave).not.toHaveBeenCalled()
    await user.dblClick(screen.getByRole("button", { name: copy.create }))
    await waitFor(() => expect(view.onSave).toHaveBeenCalledTimes(1))
    expect(view.onSave.mock.calls[0]?.[0]).toBe(7)
    const feature = view.onSave.mock.calls[0]?.[1]
    expect(feature).toMatchObject({ id: featureId, dependencies: [], references: [] })
    expect(view.onSaved).toHaveBeenCalledTimes(1)
    expect(screen.getByText(copy.coordinateSnapshot)).toBeTruthy()
  })

  it("shows invalid lengths and duplicate points, clears the preview, and blocks Apply", async () => {
    const user = userEvent.setup(),
      view = setup()
    const strut = screen.getByRole("combobox", { name: copy.strutRadius })
    await user.clear(strut)
    await user.type(strut, "4 mm")
    expect(strut.getAttribute("aria-invalid")).toBe("true")
    expect(screen.getByText(copy.invalidRange)).toBeTruthy()
    expect(screen.getByRole("button", { name: copy.create }).hasAttribute("disabled")).toBe(true)
    await user.clear(strut)
    await user.type(strut, "1 mm")
    const x = screen.getByRole("combobox", { name: "Point 2 X" })
    await user.clear(x)
    await user.type(x, "0 mm")
    expect(screen.getByText(copy.validationSummary)).toBeTruthy()
    await waitFor(() => expect(view.onPreviewChange).toHaveBeenLastCalledWith(null))
    expect(view.onSave).not.toHaveBeenCalled()
    await user.clear(x)
    await user.type(x, "45 deg")
    expect(x.getAttribute("aria-invalid")).toBe("true")
    expect(screen.getByText(copy.invalidDimension)).toBeTruthy()
  })

  it.each(["loading", "error"] as const)(
    "blocks saving while preview is %s and retains Cancel",
    async (status) => {
      const user = userEvent.setup(),
        view = setup(status)
      expect(screen.getByRole("button", { name: copy.create }).hasAttribute("disabled")).toBe(true)
      if (status === "loading") expect(screen.getByRole("progressbar")).toBeTruthy()
      await user.click(screen.getByRole("button", { name: copy.cancel }))
      expect(view.onCancel).toHaveBeenCalledTimes(1)
      view.unmount()
      expect(view.onPreviewChange).toHaveBeenLastCalledWith(null)
      expect(view.onSave).not.toHaveBeenCalled()
    },
  )

  it("edits the same saved feature and leaves Cancel without a mutation", async () => {
    const user = userEvent.setup(),
      created = setup()
    await user.click(screen.getByRole("button", { name: copy.create }))
    await waitFor(() => expect(created.onSave).toHaveBeenCalledTimes(1))
    const original = created.onSave.mock.calls[0]?.[1]
    if (!original) throw new Error("Fixture requires a saved connector.")
    expect(editPartDesignTool(original)).toEqual({ kind: "edit-connect-mounts", featureId })
    expect(modifyingSolidTargetFeatures([original])).toEqual([original])
    created.unmount()
    const edit = setup("ready", { kind: "edit", feature: original })
    const radius = screen.getByRole("combobox", { name: copy.nodeRadius })
    await user.clear(radius)
    await user.type(radius, "5 mm")
    await user.click(screen.getByRole("button", { name: copy.update }))
    await waitFor(() => expect(edit.onSave).toHaveBeenCalledTimes(1))
    expect(edit.onSave.mock.calls[0]?.[1]).toMatchObject({
      id: featureId,
      parameters: { nodeRadius: 5 },
    })
    edit.unmount()
    const cancelled = setup("ready", { kind: "edit", feature: original })
    await user.click(screen.getByRole("button", { name: copy.cancel }))
    expect(cancelled.onCancel).toHaveBeenCalledTimes(1)
    expect(cancelled.onSave).not.toHaveBeenCalled()
  })

  it("preserves parameters and releases the save lock after a rejected save", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(
      async (_revision: number, _feature: FeatureRecord): Promise<{ ok: true }> => {
        throw new Error("Persistence unavailable")
      },
    )
    const view = setup("ready", mode, onSave)
    await user.click(screen.getByRole("button", { name: copy.create }))
    await waitFor(() => expect(screen.getByText(copy.saveFailed)).toBeTruthy())
    expect(screen.getByRole("combobox", { name: "Point 2 X" }).getAttribute("value")).toBe("20 mm")
    expect(screen.getByRole("button", { name: copy.create }).hasAttribute("disabled")).toBe(false)
    expect(view.onSaved).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: copy.create }))
    expect(onSave).toHaveBeenCalledTimes(2)
  })
})
