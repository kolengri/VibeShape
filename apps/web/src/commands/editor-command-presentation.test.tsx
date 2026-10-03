// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
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
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24")
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
