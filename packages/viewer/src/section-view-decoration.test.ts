import { describe, expect, it } from "bun:test"
import { OrthographicCamera, Vector3 } from "three"
import { sectionDragDirection } from "./section-view-decoration"

describe("section normal drag projection", () => {
  it.each(["x", "y", "z"] as const)(
    "moves one world unit for one projected %s-axis unit",
    (axis) => {
      const camera = new OrthographicCamera(-50, 50, 50, -50, 0.01, 10000)
      camera.up.set(0, 0, 1)
      camera.position.set(80, -80, 65)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      const direction = sectionDragDirection(axis, camera, 1000, 1000)
      const start = new Vector3().project(camera)
      const end = new Vector3().setComponent({ x: 0, y: 1, z: 2 }[axis], 1).project(camera)
      const delta = direction.x * (end.x - start.x) * 500 - direction.y * (end.y - start.y) * 500
      expect(delta).toBeCloseTo(1, 6)
    },
  )
  it("uses bounded vertical motion when looking along the section normal", () => {
    const camera = new OrthographicCamera(-50, 50, 50, -50, 0.01, 10000)
    camera.position.set(0, 0, 100)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const direction = sectionDragDirection("z", camera, 1000, 1000)
    expect(direction.x).toBe(0)
    expect(direction.y).toBeCloseTo(-0.1)
    expect(Number.isFinite(sectionDragDirection("z", camera, 0, 0).y)).toBe(true)
  })
})
