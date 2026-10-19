import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { ModelBrowserPlanes } from "./model-browser-planes"

afterEach(cleanup)

function renderOrigin(disabled = false) {
  const onSelect = vi.fn()
  const onVisibilityChange = vi.fn()
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <ModelBrowserPlanes
          disabled={disabled}
          onSelect={onSelect}
          onVisibilityChange={onVisibilityChange}
          selected="xz"
          visibility={{ xy: true, xz: true, yz: false }}
        />
      </TooltipProvider>
    </I18nProvider>,
  )
  return { onSelect, onVisibilityChange }
}

describe("model browser planes", () => {
  it("hides visible origin planes from the collapsed group without changing selection", async () => {
    const user = userEvent.setup()
    const { onSelect, onVisibilityChange } = renderOrigin(true)
    const disclosure = screen.getByRole("treeitem", { name: "Planes" })
    const visibility = screen.getByRole("button", { name: "Hide all origin planes" })
    expect(visibility.getAttribute("aria-pressed")).toBe("mixed")
    await user.click(visibility)
    expect(onVisibilityChange.mock.calls).toEqual([
      ["xy", false],
      ["xz", false],
    ])
    expect(disclosure.getAttribute("aria-expanded")).toBe("false")
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("keeps authored planes visible without exposing unavailable origin actions", () => {
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <TooltipProvider>
          <ModelBrowserPlanes
            authoredCount={1}
            disabled={false}
            selected={null}
            showOriginPlanes={false}
            visibility={{ xy: true, xz: true, yz: true }}
          >
            <button type="button" role="treeitem">
              Angled plane
            </button>
          </ModelBrowserPlanes>
        </TooltipProvider>
      </I18nProvider>,
    )
    expect(screen.getByRole("treeitem", { name: "Planes" }).getAttribute("aria-expanded")).toBe(
      "true",
    )
    expect(screen.getByRole("treeitem", { name: "Angled plane" })).toBeTruthy()
    expect(screen.queryByRole("treeitem", { name: "XY" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Hide all origin planes" })).toBeNull()
  })

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
