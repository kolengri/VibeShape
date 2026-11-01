import { expect, it } from "bun:test"
import { WorkerLicenseInventory } from "./worker-license-inventory"

it("retains every worker's dependencies instead of letting the last worker overwrite notices", () => {
  const inventory = new WorkerLicenseInventory()
  inventory.add("quickjs", "1", "QuickJS engine notice")
  inventory.add("sucrase", "1", "Sucrase notice")
  inventory.add("fzstd", "1", "F3D decompressor notice")
  inventory.add("zod", "1", "Common dependency")
  inventory.add("zod", "1", "Common dependency")
  expect(inventory.text()).toBe(
    "F3D decompressor notice\n\n---\n\nQuickJS engine notice\n\n---\n\nSucrase notice\n\n---\n\nCommon dependency",
  )
  inventory.add("zod", "2", "Second version")
  expect(inventory.text()).toContain("Second version")
})
it("refuses missing notices and resets for a subsequent build", () => {
  const inventory = new WorkerLicenseInventory()
  expect(() => inventory.text()).toThrow("empty")
  expect(() => inventory.add(null, "1", "Notice")).toThrow("incomplete")
  expect(() => inventory.add("quickjs", "1", " ")).toThrow("Empty")
  inventory.add("old", "1", "Old dependency")
  inventory.clear()
  inventory.add("new", "1", "New dependency")
  expect(inventory.text()).toBe("New dependency")
})
