import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { ModelBrowserPlanes } from "./model-browser-planes"

afterEach(cleanup)

function renderOrigin(disabled = false) {
  const onSelect = vi.fn()
  const onVisibilityChange = vi.fn()
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <ModelBrowserPlanes
        disabled={disabled}
        onSelect={onSelect}
        onVisibilityChange={onVisibilityChange}
        selected="xz"
        visibility={{ xy: true, xz: true, yz: false }}
      />
    </I18nProvider>,
  )
  return { onSelect, onVisibilityChange }
}

describe("model browser planes", () => {
  it("discloses origin planes without changing a selection and keeps visibility independent", async () => {
    const user = userEvent.setup()
    const { onSelect, onVisibilityChange } = renderOrigin()
    const origin = screen.getByRole("treeitem", { name: "Planes" })
    expect(screen.queryByRole("treeitem", { name: "XY" })).toBeNull()
    await user.click(origin)
    expect(origin.getAttribute("aria-expanded")).toBe("true")
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole("treeitem", { name: "XZ" }).getAttribute("aria-selected")).toBe("true")
    await user.click(screen.getByRole("button", { name: "Hide XY" }))
    expect(onVisibilityChange).toHaveBeenCalledWith("xy", false)
    expect(onSelect).not.toHaveBeenCalled()
    await user.click(screen.getByRole("treeitem", { name: "YZ" }))
    expect(onSelect).toHaveBeenCalledWith("yz")
  })

  it("keeps disclosure and display preferences usable while authoring selection is locked", async () => {
    const user = userEvent.setup()
    const { onSelect, onVisibilityChange } = renderOrigin(true)
    await user.click(screen.getByRole("treeitem", { name: "Planes" }))
    const plane = screen.getByRole("treeitem", { name: "XY" }) as HTMLButtonElement
    expect(plane.disabled).toBe(true)
    await user.click(plane)
    expect(onSelect).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Show YZ" }))
    expect(onVisibilityChange).toHaveBeenCalledWith("yz", true)
  })
})
