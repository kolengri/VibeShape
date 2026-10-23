import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { coloredIcon } from "./colored-icon"
import * as icons from "./icons"
import { CancelIcon, CloseIcon, FolderOpen, LoadingIcon, X } from "./icons"

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

it("keeps gradients and masks local to each icon instance, including after a sibling unmounts", () => {
  const components = [...new Set(Object.values(icons))]
  const gallery = (copies: number) => (
    <>
      {components.map((Icon, index) => (
        <span key={index}>
          {Array.from({ length: copies }, (_, copy) => (
            <Icon key={copy} />
          ))}
        </span>
      ))}
    </>
  )
  const { container, rerender } = render(gallery(2))
  const verifyReferences = () => {
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg.querySelector("path, rect, circle, ellipse")).not.toBeNull()
      const localIds = new Set([...svg.querySelectorAll("[id]")].map((element) => element.id))
      for (const element of svg.querySelectorAll("*")) {
        for (const attribute of element.attributes) {
          for (const reference of attribute.value.matchAll(/url\(#([^)]+)\)/g)) {
            expect(localIds.has(reference[1] ?? "")).toBe(true)
          }
        }
      }
      for (const mask of svg.querySelectorAll("mask")) {
        expect(mask.style.maskType).toBe("luminance")
      }
    }
  }
  expect(container.querySelectorAll("svg")).toHaveLength(348)
  verifyReferences()
  const survivingIds = [...container.querySelectorAll("span")].map(
    (span) => span.querySelector("[id]")?.id,
  )
  rerender(gallery(1))
  expect(container.querySelectorAll("svg")).toHaveLength(174)
  expect(
    [...container.querySelectorAll("span")].map((span) => span.querySelector("[id]")?.id),
  ).toEqual(survivingIds)
  verifyReferences()
})

it("uses the neutral close glyph for generic dismissal while preserving explicit cancellation", () => {
  expect(X).toBe(CloseIcon)
  const { container } = render(
    <>
      <CloseIcon />
      <CancelIcon />
    </>,
  )
  expect([...container.querySelectorAll("svg")].map((svg) => svg.dataset.icon)).toEqual([
    "close",
    "cancel",
  ])
  expect(container.querySelector('[data-icon="close"] circle')).toBeNull()
  expect(container.querySelector('[data-icon="close"] defs')).toBeNull()
  expect(container.querySelector('[data-icon="cancel"] circle')).not.toBeNull()
})

it("retains instance artwork across host updates while forwarding changed props and children", () => {
  let drawings = 0
  const Icon = coloredIcon("retained-artwork", (id) => {
    drawings += 1
    return <path id={`${id}-path`} d="M0 0h20v20H0z" />
  })
  const ref = createRef<SVGSVGElement>()
  const { container, rerender } = render(<Icon ref={ref} size={20} className="first" />)
  const path = container.querySelector("path")
  const pathId = path?.id
  rerender(
    <Icon ref={ref} size={48} className="updated" aria-label="Updated">
      <title>Changed child</title>
    </Icon>,
  )
  expect(drawings).toBe(1)
  expect(container.querySelector("path")).toBe(path)
  expect(container.querySelector("path")?.id).toBe(pathId)
  expect(ref.current?.getAttribute("width")).toBe("48")
  expect(ref.current?.getAttribute("class")).toBe("updated")
  expect(ref.current?.getAttribute("aria-label")).toBe("Updated")
  expect(container.querySelector("title")?.textContent).toBe("Changed child")
})
