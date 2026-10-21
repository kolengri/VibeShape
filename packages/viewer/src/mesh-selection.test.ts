import { describe, expect, it } from "bun:test"
import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three"
import { createViewerGeometry, viewerBodyKey } from "./mesh-geometry"
import {
  createFaceHighlightGeometry,
  firstViewerSelectionHit,
  viewerFaceOrdinal,
  viewerSelectionFromSource,
} from "./mesh-selection"
import { sectionClipPlanes } from "./section-view"
import { orderedEligibleViewerSelections, type ViewerMesh } from "./three-viewport"

function source(ids: Uint32Array): ViewerMesh {
  return {
    featureId: "body",
    outputRole: "sibling",
    positions: new Float32Array(),
    normals: new Float32Array(),
    indices: new Uint32Array(),
    triangleFaceIds: ids,
  }
}

describe("current display face metadata", () => {
  it("extracts noncontiguous face triangles in source order with exact normals and independent buffers", () => {
    const mesh: ViewerMesh = {
      ...source(new Uint32Array([0, 8, 0])),
      positions: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      normals: new Float32Array([0, 1, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0]),
      indices: new Uint32Array([0, 1, 2, 1, 2, 3, 3, 2, 0]),
    }
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const geometry = createFaceHighlightGeometry(mesh, 0)
      if (!geometry) throw new Error("Expected face zero.")
      expect(Array.from(geometry.getAttribute("position").array)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 7, 8, 9, 1, 2, 3,
      ])
      expect(Array.from(geometry.getAttribute("normal").array)).toEqual([
        0, 1, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, 0, 1, 0,
      ])
      geometry.getAttribute("position").setX(0, 99)
      expect(mesh.positions[0]).toBe(1)
      geometry.dispose()
    }
    const replaced = { ...mesh, triangleFaceIds: new Uint32Array([8, 0, 8]) }
    const replacement = createFaceHighlightGeometry(replaced, 0)
    expect(Array.from(replacement?.getAttribute("position").array ?? [])).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
    replacement?.dispose()
    // Sharing immutable face metadata never caches the geometry or its vertex buffers.
    const moved = createFaceHighlightGeometry(
      { ...mesh, positions: mesh.positions.map((x) => x + 1) },
      0,
    )
    expect(moved?.getAttribute("position").getX(0)).toBe(2)
    moved?.dispose()
  })

  it("omits highlights for missing IDs, missing indices, positions, or normals after indexing", () => {
    const mesh: ViewerMesh = {
      ...source(new Uint32Array([7])),
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array(9),
      indices: new Uint32Array([0, 1, 2]),
    }
    createFaceHighlightGeometry(mesh, 7)?.dispose()
    for (const broken of [
      { ...mesh, indices: new Uint32Array([0, 1]) },
      { ...mesh, indices: new Uint32Array([0, 1, 3]) },
      { ...mesh, positions: new Float32Array(8) },
      { ...mesh, normals: new Float32Array(8) },
    ])
      expect(createFaceHighlightGeometry(broken, 7)).toBeNull()
    expect(createFaceHighlightGeometry(mesh, 99)).toBeNull()
    expect(createFaceHighlightGeometry(source(new Uint32Array()), 7)).toBeNull()
  })

  it("indexes first-occurrence ordinals once and preserves zero and missing IDs", () => {
    const ids = new Uint32Array([42, 42, 7, 42, 0, 7, 99])
    const values = ids[Symbol.iterator].bind(ids)
    let visits = 0
    ids[Symbol.iterator] = function* () {
      for (const value of values()) {
        visits += 1
        yield value
      }
      return undefined
    }
    const mesh = source(ids)
    for (let index = 0; index < 32; index += 1) {
      expect(viewerFaceOrdinal(mesh, 42)).toBe(1)
      expect(viewerFaceOrdinal(mesh, 7)).toBe(2)
      expect(viewerFaceOrdinal(mesh, 0)).toBe(3)
      expect(viewerFaceOrdinal(mesh, 99)).toBe(4)
      expect(viewerFaceOrdinal(mesh, 88)).toBeNull()
    }
    expect(visits).toBe(7)
    expect(viewerSelectionFromSource(mesh, 4)).toEqual({
      featureId: "body",
      outputRole: "sibling",
      faceId: 0,
      faceOrdinal: 3,
    })
    for (const triangle of [undefined, null, -1, 7, 0.5])
      expect(viewerSelectionFromSource(mesh, triangle)).toBeNull()
  })

  it("refreshes ordinals for replacement metadata even with identical geometry buffers", () => {
    const previous = source(new Uint32Array([42, 7]))
    expect(viewerFaceOrdinal(previous, 42)).toBe(1)
    const next = { ...previous, triangleFaceIds: new Uint32Array([7, 42, 99]) }
    expect(viewerFaceOrdinal(next, 42)).toBe(2)
    expect(viewerFaceOrdinal(next, 99)).toBe(3)
    expect(viewerFaceOrdinal(previous, 99)).toBeNull()
    expect(viewerFaceOrdinal(previous, 42)).toBe(1)
  })

  it("stops ordinary picking at the first visible valid hit without support eligibility", () => {
    const mesh = source(new Uint32Array([42, 0, 99]))
    const object = new Mesh()
    object.name = "body\u0000sibling"
    const missing = new Mesh()
    const hit = (faceIndex: number | undefined, distance: number, z = 5) => ({
      object,
      faceIndex,
      distance,
      point: new Vector3(0, 0, z),
    })
    const picked = firstViewerSelectionHit(
      [
        hit(2, 1, 15),
        { ...hit(2, 2), object: missing },
        hit(undefined, 3),
        hit(8, 4),
        hit(0, 5),
        hit(1, 6, 10),
        hit(2, 7),
      ],
      new Map([[object.name, mesh]]),
      sectionClipPlanes({ axis: "z", offset: 10, flipped: false }),
    )
    expect(picked).toEqual({
      distance: 5,
      selection: { featureId: "body", outputRole: "sibling", faceId: 42, faceOrdinal: 1 },
    })
    if (!picked) throw new Error("Expected an ordinary body hit.")
    expect(orderedEligibleViewerSelections([picked], () => false)).toEqual([])
  })

  it("picks separated siblings with face ID zero even when neither is an eligible sketch support", () => {
    const material = new MeshBasicMaterial()
    const sources = new Map<string, ViewerMesh>()
    const surfaces = [-12, 12].map((x, index) => {
      const box = new BoxGeometry(10, 10, 10).translate(x, 0, 5)
      const indices = box.getIndex()
      if (!indices) throw new Error("Expected an indexed box.")
      const mesh: ViewerMesh = {
        featureId: "siblings",
        outputRole: `pattern.instance.${index}`,
        positions: new Float32Array(box.getAttribute("position").array),
        normals: new Float32Array(box.getAttribute("normal").array),
        indices: new Uint32Array(indices.array),
        triangleFaceIds: new Uint32Array(indices.count / 3),
      }
      box.dispose()
      sources.set(viewerBodyKey(mesh), mesh)
      const surface = new Mesh(createViewerGeometry(mesh), material)
      surface.name = viewerBodyKey(mesh)
      surface.updateMatrixWorld(true)
      return surface
    })
    try {
      for (const [index, x] of [-12, 12].entries()) {
        const hits = new Raycaster(new Vector3(x, 0, 100), new Vector3(0, 0, -1)).intersectObjects(
          surfaces,
          false,
        )
        const picked = firstViewerSelectionHit(hits, sources, null)
        expect(picked?.selection).toEqual({
          featureId: "siblings",
          outputRole: `pattern.instance.${index}`,
          faceId: 0,
          faceOrdinal: 1,
        })
        if (!picked) throw new Error("Expected the clicked sibling.")
        expect(orderedEligibleViewerSelections([picked], () => false)).toEqual([])
      }
    } finally {
      for (const surface of surfaces) surface.geometry.dispose()
      material.dispose()
    }
  })

  it("keeps a complete support stack until eligibility filtering and deterministic capping", () => {
    const mesh = source(Uint32Array.from({ length: 24 }, (_, index) => 100 - index))
    const hits = Array.from({ length: 24 }, (_, index) => {
      const selection = viewerSelectionFromSource(mesh, index)
      if (!selection) throw new Error("Expected every fixture triangle to map to a face.")
      return { distance: index, selection }
    })
    const result = orderedEligibleViewerSelections(hits, ({ faceId }) => faceId <= 90)
    expect(result.map(({ faceId }) => faceId)).toEqual([90, 89, 88, 87, 86, 85, 84, 83])
    expect(result.map(({ faceOrdinal }) => faceOrdinal)).toEqual([11, 12, 13, 14, 15, 16, 17, 18])
  })
})
