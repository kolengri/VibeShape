import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render } from "@testing-library/react"
import { builtInEditorCommandDescriptors } from "./built-in-editor-commands"
import { EditorCommandIconView } from "./editor-command-presentation"

afterEach(cleanup)

it("gives different command concepts distinct decorative glyphs", () => {
  const identities = new Set(builtInEditorCommandDescriptors.map((command) => command.icon))
  const glyphs = new Map<string, string>()
  for (const icon of identities) {
    const { container, unmount } = render(<EditorCommandIconView icon={icon} />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("aria-hidden")).toBe("true")
    expect(svg?.getAttribute("viewBox")).toBe("0 0 256 256")
    const shape = svg?.innerHTML ?? ""
    expect(shape.length).toBeGreaterThan(0)
    expect(glyphs.get(shape), `${icon} duplicates ${glyphs.get(shape)}`).toBeUndefined()
    glyphs.set(shape, icon)
    unmount()
  }
})

it("keeps slot construction methods and measuring versus dimensioning distinct", () => {
  const icons = Object.fromEntries(
    builtInEditorCommandDescriptors.map((command) => [command.labelKey, command.icon]),
  )
  expect(
    new Set([icons.sketchSlot, icons.sketchCenteredSlot, icons.sketchSlotAroundLine]).size,
  ).toBe(3)
  expect(icons.measure).not.toBe(icons.sketchDimension)
})

it("uses dedicated artwork for operation contexts instead of borrowing nearby tools", () => {
  const expected = {
    generativeDesign: "generative-design",
    createFdm: "fdm-tools",
    sketchFillet: "sketch-fillet",
    sketchChamfer: "sketch-chamfer",
    sketchTransform: "sketch-transform",
    sketchNavigateView: "navigate-view",
    sketchUse: "use-external-geometry",
  } as const
  for (const [label, id] of Object.entries(expected)) {
    const command = builtInEditorCommandDescriptors.find((command) => command.labelKey === label)
    expect(command).toBeDefined()
    if (!command) throw new Error(`Missing command: ${label}`)
    const { container, unmount } = render(<EditorCommandIconView icon={command.icon} />)
    expect(container.querySelector("svg")?.getAttribute("data-icon")).toBe(id)
    unmount()
  }
})
