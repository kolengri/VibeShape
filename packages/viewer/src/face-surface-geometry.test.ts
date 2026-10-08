import { describe, expect, it } from "bun:test"
import { viewerFaceSurfaceGeometry } from "./face-surface-geometry"
import type { ViewerMesh } from "./three-viewport"

const mesh: ViewerMesh = {
  featureId: "source",
  positions: new Float32Array([0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 2]),
  normals: new Float32Array(12),
  indices: new Uint32Array([0, 1, 2, 0, 3, 1]),
  triangleFaceIds: new Uint32Array([8, 17]),
}

describe("viewerFaceSurfaceGeometry", () => {
  it("uses selected triangle areas and winding for the face centroid and normal", () => {
    const result = viewerFaceSurfaceGeometry(mesh, [8])
    expect(result?.center[0]).toBeCloseTo(4 / 3, 12)
    expect(result?.center[1]).toBeCloseTo(2 / 3, 12)
    expect(result?.center[2]).toBe(0)
    expect(result?.normal).toEqual([0, 0, 1])
    expect(viewerFaceSurfaceGeometry(mesh, [17])?.normal).toEqual([0, 1, 0])
  })

  it("rejects absent, degenerate, incomplete, and non-finite selected triangles", () => {
    expect(viewerFaceSurfaceGeometry(mesh, [99])).toBeNull()
    expect(
      viewerFaceSurfaceGeometry(
        { ...mesh, indices: new Uint32Array([0, 0, 0]), triangleFaceIds: new Uint32Array([8]) },
        [8],
      ),
    ).toBeNull()
    expect(
      viewerFaceSurfaceGeometry(
        { ...mesh, indices: new Uint32Array([0, 1]), triangleFaceIds: new Uint32Array([8]) },
        [8],
      ),
    ).toBeNull()
    expect(
      viewerFaceSurfaceGeometry(
        {
          ...mesh,
          positions: new Float32Array([Number.NaN, ...Array.from(mesh.positions).slice(1)]),
        },
        [8],
      ),
    ).toBeNull()
    expect(
      viewerFaceSurfaceGeometry(
        { ...mesh, indices: new Uint32Array([0, 1, 99]), triangleFaceIds: new Uint32Array([8]) },
        [8],
      ),
    ).toBeNull()
  })

  it("preserves the centroid but leaves direction unspecified when opposing normals cancel", () => {
    const result = viewerFaceSurfaceGeometry(
      {
        ...mesh,
        indices: new Uint32Array([0, 1, 2, 0, 2, 1]),
        triangleFaceIds: new Uint32Array([8, 8]),
      },
      [8],
    )
    expect(result?.normal).toBeNull()
    expect(result?.center[0]).toBeCloseTo(4 / 3, 12)
    expect(result?.center[1]).toBeCloseTo(2 / 3, 12)
  })
})
