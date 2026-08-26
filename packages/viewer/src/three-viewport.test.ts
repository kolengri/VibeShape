import { describe, expect, it, vi } from "vitest"
import {
  createFaceHighlightGeometry,
  createViewerGeometry,
  createViewerSketchGeometry,
  isValidViewerFrame,
  orthographicFrustum,
  type ViewerMesh,
  viewerCameraPoseForFrame,
  viewerFaceOrdinal,
  viewerSketchProjectionTarget,
  viewerSketchProjectionViewHeight,
} from "./three-viewport"
import { viewerSketchReferenceCandidateKey } from "./sketch-reference-identity"
import { viewerBodyColor } from "./viewer-appearance"

const mesh: ViewerMesh = {
  featureId: "box",
  positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([7]),
}

describe("Three viewport geometry", () => {
  it("accepts orthonormal right-handed frames, including origin-plane orientations", () => {
    expect(
      isValidViewerFrame({
        origin: [3, -2, 8],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      }),
    ).toBe(true)
    expect(
      isValidViewerFrame({
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 0, 1],
        normal: [0, -1, 0],
      }),
    ).toBe(true)
  })

  it("rejects non-finite, non-orthonormal, and left-handed frames", () => {
    const frame = {
      origin: [0, 0, 0] as const,
      xAxis: [1, 0, 0] as const,
      yAxis: [0, 1, 0] as const,
      normal: [0, 0, 1] as const,
    }
    expect(isValidViewerFrame({ ...frame, normal: [0, 0, Number.NaN] })).toBe(false)
    expect(isValidViewerFrame({ ...frame, yAxis: [0, 1, 0.01] })).toBe(false)
    expect(isValidViewerFrame({ ...frame, normal: [0, 0, -1] })).toBe(false)
    expect(isValidViewerFrame(null as never)).toBe(false)
  })

  it("derives a pose at the retained camera distance", () => {
    const pose = viewerCameraPoseForFrame(
      { origin: [4, 5, 6], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
      37,
    )
    expect(pose).toEqual({
      position: [4, 5, 43],
      target: [4, 5, 6],
      up: [0, 1, 0],
    })
    expect(viewerCameraPoseForFrame({} as never, 37)).toBeNull()
  })

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

  it("shares one stable identity for sketch and model reference candidates", () => {
    const point = {
      label: "Point",
      position: [0, 0, 0] as const,
      sourcePointId: "point-1",
      sourceSketchId: "sketch-1",
    }
    expect(viewerSketchReferenceCandidateKey(point)).toBe("sketch-1:point-1")
    expect(viewerSketchReferenceCandidateKey({ ...point, kind: "point" })).toBe("sketch-1:point-1")
    expect(
      viewerSketchReferenceCandidateKey({
        candidateId: "edge-1",
        featureId: "box-1",
        kind: "model-line",
      }),
    ).toBe("model-line:box-1:edge-1")
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

  it("matches SVG meet scaling for sketch projection bounds", () => {
    const bounds = { minX: -10, minY: -5, width: 20, height: 10 }
    expect(viewerSketchProjectionViewHeight(bounds, 2)).toBe(10)
    expect(viewerSketchProjectionViewHeight(bounds, 1)).toBe(20)
    expect(viewerSketchProjectionViewHeight({ ...bounds, width: Number.NaN }, 2)).toBe(100)
  })

  it("maps a planar projection center through the sketch frame", () => {
    expect(
      viewerSketchProjectionTarget(
        {
          origin: [10, 20, 30],
          xAxis: [0, 1, 0],
          yAxis: [0, 0, 1],
          normal: [1, 0, 0],
        },
        { minX: 2, minY: 4, width: 6, height: 8 },
      ),
    ).toEqual([10, 25, 38])
    expect(
      viewerSketchProjectionTarget(
        {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
        },
        { minX: 0, minY: 0, width: 0, height: 10 },
      ),
    ).toBeNull()
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
