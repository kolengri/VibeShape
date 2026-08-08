import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { describe, expect, it, vi } from "vitest"
import { exportMeshedOcctStl, meshOcctShape } from "./occt-mesh"

function createDeletable() {
  return { delete: vi.fn() }
}

function createConstructor<T>(value: T) {
  return vi.fn(function MockConstructor() {
    return value
  })
}

function createVector(x: number, y: number, z: number) {
  return {
    ...createDeletable(),
    X: vi.fn(() => x),
    Y: vi.fn(() => y),
    Z: vi.fn(() => z),
  }
}

describe("owned OCCT tessellation adapter", () => {
  it("preserves mesh groups and deletes every owned temporary binding", () => {
    const faceType = {}
    const shapeType = {}
    const forward = {}
    const rawFace = createDeletable()
    const transformedNodes = [createVector(0, 0, 0), createVector(1, 0, 0), createVector(0, 1, 0)]
    const nodes = transformedNodes.map((transformed) => ({
      ...createDeletable(),
      Transformed: vi.fn(() => transformed),
    }))
    const transformedNormals = Array.from({ length: 3 }, () => createVector(0, 0, 1))
    const normals = transformedNormals.map((transformed) => ({
      ...createDeletable(),
      Transformed: vi.fn(() => transformed),
    }))
    const triangle = {
      ...createDeletable(),
      Value: vi.fn((index: number) => index),
    }
    const triangulation = {
      NbNodes: vi.fn(() => 3),
      NbTriangles: vi.fn(() => 1),
      Node: vi.fn((index: number) => nodes[index - 1]),
      Triangle: vi.fn(() => triangle),
    }
    const triangulationHandle = {
      ...createDeletable(),
      IsNull: vi.fn(() => false),
      get: vi.fn(() => triangulation),
    }
    const transformation = createDeletable()
    const location = {
      ...createDeletable(),
      Transformation: vi.fn(() => transformation),
    }
    const normalsArray = {
      ...createDeletable(),
      Lower: vi.fn(() => 1),
      Upper: vi.fn(() => 3),
      Value: vi.fn((index: number) => normals[index - 1]),
    }
    const connectivity = createDeletable()
    const face = {
      ...createDeletable(),
      HashCode: vi.fn(() => 42),
      Orientation_1: vi.fn(() => forward),
    }
    const explorer = {
      ...createDeletable(),
      Current: vi.fn(() => rawFace),
      More: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
      Next: vi.fn(),
    }
    const mesher = createDeletable()
    const opencascade = {
      BRepMesh_IncrementalMesh_2: createConstructor(mesher),
      BRep_Tool: { Triangulation: vi.fn(() => triangulationHandle) },
      Poly_Connect_2: createConstructor(connectivity),
      StdPrs_ToolTriangulatedShape: { Normal: vi.fn() },
      TColgp_Array1OfDir_2: createConstructor(normalsArray),
      TopAbs_Orientation: { TopAbs_FORWARD: forward },
      TopAbs_ShapeEnum: { TopAbs_FACE: faceType, TopAbs_SHAPE: shapeType },
      TopExp_Explorer_2: createConstructor(explorer),
      TopLoc_Location_1: createConstructor(location),
      TopoDS: { Face_1: vi.fn(() => face) },
    } as unknown as OpenCascadeInstance
    const wrapped = createDeletable()

    const mesh = meshOcctShape(opencascade, { wrapped } as never, {
      tolerance: 0.1,
      angularTolerance: 0.2,
    })

    expect(mesh).toEqual({
      triangles: [0, 1, 2],
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      faceGroups: [{ start: 0, count: 3, faceId: 42 }],
    })
    expect(opencascade.BRepMesh_IncrementalMesh_2).toHaveBeenCalledWith(
      wrapped,
      0.1,
      false,
      0.2,
      false,
    )
    expect(mesher.delete).toHaveBeenCalledOnce()
    expect(explorer.delete).toHaveBeenCalledOnce()
    expect(rawFace.delete).toHaveBeenCalledOnce()
    expect(face.delete).toHaveBeenCalledOnce()
    expect(location.delete).toHaveBeenCalledOnce()
    expect(transformation.delete).toHaveBeenCalledOnce()
    expect(triangulationHandle.delete).toHaveBeenCalledOnce()
    expect(normalsArray.delete).toHaveBeenCalledOnce()
    expect(connectivity.delete).toHaveBeenCalledOnce()
    expect(triangle.delete).toHaveBeenCalledOnce()

    for (const binding of [...nodes, ...transformedNodes, ...normals, ...transformedNormals]) {
      expect(binding.delete).toHaveBeenCalledOnce()
    }
  })
})

describe("owned OCCT STL export adapter", () => {
  it("exports the attached mesh and clears its B-Rep triangulation cache", () => {
    const wrapped = createDeletable()
    const unlink = vi.fn()
    const clean = vi.fn()
    const write = vi.fn(() => true)
    const opencascade = {
      BRepTools: { Clean: clean },
      FS: { readFile: vi.fn(() => Uint8Array.from([1, 2, 3])), unlink },
      StlAPI: { Write: write },
    } as unknown as OpenCascadeInstance

    const blob = exportMeshedOcctStl(opencascade, { wrapped } as never, true)

    expect(blob.size).toBe(3)
    expect(blob.type).toBe("model/stl")
    expect(write).toHaveBeenCalledWith(wrapped, "/vibeshape-export.stl", false)
    expect(unlink).toHaveBeenCalledWith("/vibeshape-export.stl")
    expect(clean).toHaveBeenCalledWith(wrapped, true)
  })

  it("clears the triangulation cache when the STL writer fails", () => {
    const wrapped = createDeletable()
    const clean = vi.fn()
    const opencascade = {
      BRepTools: { Clean: clean },
      FS: { readFile: vi.fn(), unlink: vi.fn(() => undefined) },
      StlAPI: { Write: vi.fn(() => false) },
    } as unknown as OpenCascadeInstance

    expect(() => exportMeshedOcctStl(opencascade, { wrapped } as never, true)).toThrow(
      "OCCT failed to write the STL file.",
    )
    expect(clean).toHaveBeenCalledWith(wrapped, true)
  })
})
