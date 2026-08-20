import { describe, expect, it, vi } from "vitest"
import {
  createFaceHighlightGeometry,
  createViewerGeometry,
  createViewerSketchGeometry,
  orthographicFrustum,
  type ViewerMesh,
  viewerFaceOrdinal,
} from "./three-viewport"
import { viewerBodyColor } from "./viewer-appearance"

const mesh: ViewerMesh = {
  featureId: "box",
  positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([7]),
}

describe("Three viewport geometry", () => {
  it("assigns stable display colors to independent terminal feature identities", () => {
    expect(viewerBodyColor("body-a")).toBe(viewerBodyColor("body-a"))
    expect(viewerBodyColor("body-a")).not.toBe(viewerBodyColor("body-b"))
    expect(viewerBodyColor("body-a")).toMatch(/^#[0-9a-f]{6}$/)
  })

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

  it("binds transferred sketch positions without copying", () => {
    const positions = new Float32Array([0, 0, 0, 12, 0, 0])
    const geometry = createViewerSketchGeometry(positions)

    expect(geometry.getAttribute("position").array).toBe(positions)
    expect(geometry.boundingBox?.min.toArray()).toEqual([0, 0, 0])
    expect(geometry.boundingBox?.max.toArray()).toEqual([12, 0, 0])

    geometry.dispose()
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

  it("extracts the exact selected face triangles and derives a friendly ordinal", () => {
    const selectableMesh: ViewerMesh = {
      featureId: "box",
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0, 2, 3, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
      triangleFaceIds: new Uint32Array([7, 9]),
    }

    expect(viewerFaceOrdinal(selectableMesh, 7)).toBe(1)
    expect(viewerFaceOrdinal(selectableMesh, 9)).toBe(2)
    expect(viewerFaceOrdinal(selectableMesh, 11)).toBeNull()

    const highlight = createFaceHighlightGeometry(selectableMesh, 9)
    expect(Array.from(highlight?.getAttribute("position").array ?? [])).toEqual([
      0, 3, 0, 2, 0, 0, 2, 3, 0,
    ])
    expect(createFaceHighlightGeometry(selectableMesh, 11)).toBeNull()
    highlight?.dispose()
  })
})
