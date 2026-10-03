import { Box3, LineSegments, Mesh, Vector3 } from "three"
import { describe, expect, it, vi } from "vitest"
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
    const usable = decoration.bed.getObjectByName("print-usable-area")
    expect(usable).toBeDefined()
    if (!usable) throw new Error("Missing usable area.")
    const size = new Box3().setFromObject(usable).getSize(new Vector3())
    expect(size.x).toBe(190)
    expect(size.y).toBe(150)
    decoration.dispose()
  })

  it("releases replaced bed resources and hides each decoration independently", () => {
    const decoration = new PrintBedDecoration()
    decoration.setBed({ width: 200, depth: 200, height: 200, margin: 0 })
    const disposed = vi.fn()
    const surface = decoration.bed.getObjectByName("print-bed")
    if (!(surface instanceof Mesh)) throw new Error("Missing bed surface.")
    surface.geometry.addEventListener("dispose", disposed)
    decoration.setGround(true)
    decoration.setBed(null)
    expect(disposed).toHaveBeenCalledOnce()
    expect(decoration.bed.children).toHaveLength(0)
    expect(decoration.ground.children[0]).toBeInstanceOf(LineSegments)
    decoration.setGround(false)
    expect(decoration.ground.children).toHaveLength(0)
    decoration.dispose()
  })

  it("rejects invalid envelopes before allocating GPU geometry", () => {
    const decoration = new PrintBedDecoration()
    expect(() => decoration.setBed({ width: 0, depth: 10, height: 10, margin: 0 })).toThrow()
    expect(() => decoration.setBed({ width: 10, depth: 10, height: 10, margin: 5 })).toThrow()
    expect(decoration.bed.children).toHaveLength(0)
  })
})
