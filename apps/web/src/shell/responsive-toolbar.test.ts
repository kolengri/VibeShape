import { describe, expect, it } from "bun:test"
import { fitToolbar } from "./responsive-toolbar"

const groups = [
  { id: "create", commands: ["datum", "loft", "sweep", "generative"] },
  { id: "modify", commands: ["fillet", "chamfer", "hole", "shell"] },
  { id: "primitives", commands: ["box", "cylinder", "sphere"] },
  { id: "inspect", commands: ["measure", "visibility"] },
]
const priority = [
  "fillet",
  "box",
  "measure",
  "datum",
  "chamfer",
  "cylinder",
  "loft",
  "hole",
  "sweep",
]
const sizes = {
  leading: 104,
  icon: 32,
  gap: 4,
  separator: 9,
  menus: new Map([
    ["create", 80],
    ["modify", 80],
    ["primitives", 96],
    ["inspect", 80],
  ]),
}

describe("measured toolbar fit", () => {
  it("accounts for real menu widths, icon gaps and separators at the exact fit boundary", () => {
    expect(fitToolbar(groups, priority, { ...sizes, available: 580 })).toEqual({
      compact: false,
      inline: ["fillet", "box"],
    })
    expect(fitToolbar(groups, priority, { ...sizes, available: 579 })).toEqual({
      compact: false,
      inline: ["fillet"],
    })
    expect(fitToolbar(groups, priority, { ...sizes, available: 507 })).toEqual({
      compact: true,
      inline: [],
    })
  })
  it("fills wide layouts with preferred commands while leaving every other command in a menu", () => {
    const fit = fitToolbar(groups, priority, { ...sizes, available: 1200 })
    expect(fit.compact).toBe(false)
    expect(fit.inline).toEqual(priority)
    expect(fit.inline).not.toContain("generative")
    expect(fit.inline).not.toContain("visibility")
  })
  it("replaces a single-command menu by its icon when that saves width", () => {
    expect(
      fitToolbar([{ id: "inspect", commands: ["measure"] }], ["measure"], {
        ...sizes,
        available: 153,
      }),
    ).toEqual({ compact: false, inline: ["measure"] })
  })
})
