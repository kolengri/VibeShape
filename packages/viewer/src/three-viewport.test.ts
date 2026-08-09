import { describe, expect, it, vi } from "vitest"
import { createViewerGeometry, orthographicFrustum, type ViewerMesh } from "./three-viewport"

const mesh: ViewerMesh = {
  featureId: "box",
  positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([7]),
}

describe("Three viewport geometry", () => {
  it("binds transferred typed arrays without copying and retains face ownership metadata", () => {
    const geometry = createViewerGeometry(mesh)

    expect(geometry.getAttribute("position").array).toBe(mesh.positions)
    expect(geometry.getAttribute("normal").array).toBe(mesh.normals)
    expect(geometry.index?.array).toBe(mesh.indices)
    expect(geometry.userData).toEqual({ featureId: "box", triangleFaceIds: mesh.triangleFaceIds })
    expect(geometry.boundingBox?.min.toArray()).toEqual([0, 0, 0])
    expect(geometry.boundingBox?.max.toArray()).toEqual([2, 3, 0])

    const disposed = vi.fn()
    geometry.addEventListener("dispose", disposed)
    geometry.dispose()
    expect(disposed).toHaveBeenCalledOnce()
  })

  it("keeps a valid orthographic projection for measured and zero-sized viewports", () => {
    expect(orthographicFrustum(40, 2)).toEqual({
      left: -40,
      right: 40,
      top: 20,
      bottom: -20,
    })
    expect(orthographicFrustum(0, 0)).toEqual({
      left: -50,
      right: 50,
      top: 50,
      bottom: -50,
    })
  })
})
