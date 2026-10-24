import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TextField } from "@vibeshape/ui/components/text-field"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import {
  PrimitiveParameterPanel,
  type PrimitiveParameterPanelCopy,
} from "./primitive-parameter-panel"

const copy: PrimitiveParameterPanelCopy = {
  title: "Create primitive",
  description: "Create a primitive solid.",
  parameters: "Primitive definition",
  dimensions: "Required dimensions",
  placement: "Placement origin",
  centered: "Center height about placement origin",
  cancel: "Cancel",
}

afterEach(cleanup)

describe("PrimitiveParameterPanel", () => {
  it("shows only real preview work and retains editable draft controls through failure and recovery", async () => {
    const panel = (previewStatus: "idle" | "loading" | "error" | "ready", message?: string) => (
      <PrimitiveParameterPanel
        actions={<button type="button">Cancel</button>}
        copy={copy}
        previewStatus={previewStatus}
        message={message}
        fields={<TextField label="Radius" defaultValue="10 mm" />}
        placementFields={<TextField label="Origin X" defaultValue="0 mm" />}
      />
    )
    const view = render(panel("loading"), {
      wrapper: ({ children }) => <I18nProvider i18n={i18n}>{children}</I18nProvider>,
    })
    const progress = screen.getByRole("progressbar", { name: "Feature preview progress" })
    expect(progress.hasAttribute("aria-valuenow")).toBe(false)
    expect(screen.getByRole("status").textContent).toBe("Building preview…")
    const radius = screen.getByRole<HTMLInputElement>("textbox", { name: "Radius" })
    const user = userEvent.setup()
    await user.clear(radius)
    await user.type(radius, "#radius")

    view.rerender(panel("error"))
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(screen.getByRole("alert").textContent).toBe(
      "The preview could not be built. Review the inputs and selections. Apply requires a successful preview.",
    )
    expect(radius.value).toBe("#radius")
    expect(radius.disabled).toBe(false)
    view.rerender(panel("error", "The selected source is unavailable."))
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByRole("alert").textContent).toBe("The selected source is unavailable.")

    view.rerender(panel("loading"))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("progressbar")).toBeTruthy()
    for (const status of ["idle", "ready"] as const) {
      view.rerender(panel(status))
      expect(screen.queryByRole("progressbar")).toBeNull()
      expect(screen.queryByRole("alert")).toBeNull()
      expect(screen.getByRole("textbox", { name: "Radius" })).toBe(radius)
      expect(radius.value).toBe("#radius")
    }
  })

  it("keeps parameter fields uncontrolled and exposes ordinary form controls", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <PrimitiveParameterPanel
        actions={
          <button type="button" onClick={onCancel}>
            {copy.cancel}
          </button>
        }
        copy={copy}
        fields={
          <>
            <TextField label="Radius" defaultValue="10 mm" />
            <TextField label="Height" defaultValue="20 mm" />
          </>
        }
        centeredField={
          <label>
            <input type="checkbox" defaultChecked />
            {copy.centered}
          </label>
        }
        placementFields={<TextField label="Origin X" defaultValue="0 mm" />}
      />,
      { wrapper: ({ children }) => <I18nProvider i18n={i18n}>{children}</I18nProvider> },
    )

    const radius = screen.getByRole("textbox", { name: "Radius" }) as HTMLInputElement
    await user.clear(radius)
    await user.type(radius, "#radius")
    expect(radius.value).toBe("#radius")
    expect(
      (screen.getByRole("checkbox", { name: copy.centered }) as HTMLInputElement).checked,
    ).toBe(true)

    await user.click(screen.getByRole("button", { name: copy.cancel }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
