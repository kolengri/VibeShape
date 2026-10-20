import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { FolderOpen, LoadingIcon } from "./icons"

afterEach(cleanup)

it("keeps action artwork decorative so its enclosing control owns the accessible name", () => {
  const { container } = render(
    <button type="button" aria-label="Open projects">
      <FolderOpen />
    </button>,
  )
  expect(screen.getByRole("button", { name: "Open projects" })).not.toBeNull()
  const svg = container.querySelector("svg")
  expect(svg?.getAttribute("aria-hidden")).toBe("true")
  expect(svg?.getAttribute("focusable")).toBe("false")
  expect(svg?.hasAttribute("role")).toBe(false)
  expect(svg?.querySelector("title")).toBeNull()
})

it("preserves host dimensions, classes, refs and explicitly named status semantics", () => {
  const ref = createRef<SVGSVGElement>()
  render(
    <LoadingIcon
      ref={ref}
      role="status"
      aria-hidden={false}
      aria-label="Loading model"
      size={48}
      width={24}
      className="size-5"
    />,
  )
  const svg = screen.getByRole("status", { name: "Loading model" })
  expect(ref.current?.isSameNode(svg)).toBe(true)
  expect(svg.getAttribute("width")).toBe("24")
  expect(svg.getAttribute("height")).toBe("48")
  expect(svg.getAttribute("class")).toBe("size-5")
  expect(svg.getAttribute("viewBox")).toBe("0 0 256 256")
})
