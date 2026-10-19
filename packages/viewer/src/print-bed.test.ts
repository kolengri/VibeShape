import { describe, expect, it } from "bun:test"
import { Box3, LineSegments, Mesh, Vector3 } from "three"
import { vi } from "../../../tests/unit/support/bun-test"
import { PrintBedDecoration } from "./print-bed"

describe("print bed presentation", () => {
  it("uses a centered XY bed and a Z height envelope", () => {
    const decoration = new PrintBedDecoration()
    decoration.setBed({ width: 200, depth: 160, height: 250, margin: 5 })
    const envelope = decoration.bed.getObjectByName("print-volume")
    expect(envelope).toBeDefined()
    const bounds = new Box3().setFromObject(decoration.bed)
    expect(bounds.min.x).toBe(-100)
    expect(bounds.max.y).toBe(80)
    expect(bounds.max.z).toBe(250)
    expect(decoration.bed.getObjectByName("ground-grid")).toBeInstanceOf(LineSegments)
    const usable = decoration.bed.getObjectByName("print-usable-area")
    expect(usable).toBeDefined()
    if (!usable) throw new Error("Missing usable area.")
    const size = new Box3().setFromObject(usable).getSize(new Vector3())
    expect(size.x).toBe(190)
    expect(size.y).toBe(150)
    decoration.dispose()
  })

  it("releases removed print-bed resources", () => {
    const decoration = new PrintBedDecoration()
    decoration.setBed({ width: 200, depth: 200, height: 200, margin: 0 })
    const disposed = vi.fn()
    const surface = decoration.bed.getObjectByName("print-bed")
    if (!(surface instanceof Mesh)) throw new Error("Missing bed surface.")
    surface.geometry.addEventListener("dispose", disposed)
    decoration.setBed(null)
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(decoration.bed.children).toHaveLength(0)
    decoration.dispose()
  })

  it("rejects invalid envelopes before allocating GPU geometry", () => {
    const decoration = new PrintBedDecoration()
    expect(() => decoration.setBed({ width: 0, depth: 10, height: 10, margin: 0 })).toThrow()
    expect(() => decoration.setBed({ width: 10, depth: 10, height: 10, margin: 5 })).toThrow()
    expect(decoration.bed.children).toHaveLength(0)
  })
})
