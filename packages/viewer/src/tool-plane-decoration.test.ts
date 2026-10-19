import { describe, expect, it } from "bun:test"
import { ToolPlaneDecoration, toolPlaneCorners } from "./tool-plane-decoration"

describe("Tool plane decoration", () => {
  it("draws a finite square in an arbitrary oriented plane without selection identity", () => {
    const normal = [0, Math.SQRT1_2, Math.SQRT1_2] as const
    const corners = toolPlaneCorners({ origin: [10, 20, 30], normal, size: 40 })
    expect(corners).toHaveLength(4)
    for (const point of corners ?? []) {
      expect((point.y - 20) * normal[1] + (point.z - 30) * normal[2]).toBeCloseTo(0)
      expect(Math.hypot(point.x - 10, point.y - 20, point.z - 30)).toBeCloseTo(Math.sqrt(800))
    }
    const decoration = new ToolPlaneDecoration()
    decoration.setPlane({ origin: [10, 20, 30], normal, size: 40 })
    expect(decoration.group.visible).toBe(true)
    expect(decoration.group.children).toHaveLength(2)
    decoration.setPlane(null)
    expect(decoration.group.visible).toBe(false)
    decoration.dispose()
    expect(decoration.group.children).toHaveLength(0)
  })
  it("hides invalid planes instead of rendering stale geometry", () => {
    const decoration = new ToolPlaneDecoration()
    decoration.setPlane({ origin: [0, 0, 0], normal: [0, 0, 1], size: 10 })
    decoration.setPlane({ origin: [0, 0, 0], normal: [0, 0, 0], size: 10 })
    expect(decoration.group.visible).toBe(false)
    expect(toolPlaneCorners({ origin: [0, 0, 0], normal: [0, 0, 1], size: Infinity })).toBeNull()
    decoration.dispose()
  })
})
