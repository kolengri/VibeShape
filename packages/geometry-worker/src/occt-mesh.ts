import type { Shape3D, ShapeMesh } from "replicad"
import type {
  gp_Trsf,
  Handle_Poly_Triangulation,
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
  TopoDS_Face,
} from "replicad-opencascadejs"

const hashCodeUpperBound = 2_147_483_647

interface OcctMeshOptions {
  tolerance: number
  angularTolerance: number
}

interface FaceMeshTarget {
  triangles: number[]
  vertices: number[]
  normals: number[]
}

function unlinkVirtualFile(opencascade: OpenCascadeInstance, path: string) {
  try {
    opencascade.FS.unlink(path)
  } catch {
    // The writer can fail before creating the virtual file.
  }
}

function appendFaceNodes(
  triangulation: ReturnType<Handle_Poly_Triangulation["get"]>,
  transformation: gp_Trsf,
  target: FaceMeshTarget,
) {
  const nodeOffset = target.vertices.length / 3

  for (let index = 1; index <= triangulation.NbNodes(); index += 1) {
    const node = triangulation.Node(index)

    try {
      const transformed = node.Transformed(transformation)

      try {
        target.vertices.push(transformed.X(), transformed.Y(), transformed.Z())
      } finally {
        transformed.delete()
      }
    } finally {
      node.delete()
    }
  }

  return nodeOffset
}

function appendFaceNormals(
  opencascade: OpenCascadeInstance,
  face: TopoDS_Face,
  triangulationHandle: Handle_Poly_Triangulation,
  transformation: gp_Trsf,
  target: FaceMeshTarget,
) {
  const triangulation = triangulationHandle.get()
  const normals = new opencascade.TColgp_Array1OfDir_2(1, triangulation.NbNodes())
  const connectivity = new opencascade.Poly_Connect_2(triangulationHandle)

  try {
    opencascade.StdPrs_ToolTriangulatedShape.Normal(face, connectivity, normals)

    for (let index = normals.Lower(); index <= normals.Upper(); index += 1) {
      const normal = normals.Value(index)

      try {
        const transformed = normal.Transformed(transformation)

        try {
          target.normals.push(transformed.X(), transformed.Y(), transformed.Z())
        } finally {
          transformed.delete()
        }
      } finally {
        normal.delete()
      }
    }
  } finally {
    connectivity.delete()
    normals.delete()
  }
}

function appendFaceTriangles(
  opencascade: OpenCascadeInstance,
  face: TopoDS_Face,
  triangulationHandle: Handle_Poly_Triangulation,
  nodeOffset: number,
  target: FaceMeshTarget,
) {
  const triangulation = triangulationHandle.get()
  const forward = opencascade.TopAbs_Orientation.TopAbs_FORWARD
  const reverseWinding = face.Orientation_1() !== forward

  for (let index = 1; index <= triangulation.NbTriangles(); index += 1) {
    const triangle = triangulation.Triangle(index)

    try {
      let first = triangle.Value(1)
      let second = triangle.Value(2)
      const third = triangle.Value(3)

      if (reverseWinding) {
        const previousFirst = first
        first = second
        second = previousFirst
      }

      target.triangles.push(first - 1 + nodeOffset, second - 1 + nodeOffset, third - 1 + nodeOffset)
    } finally {
      triangle.delete()
    }
  }
}

function appendFaceMesh(
  opencascade: OpenCascadeInstance,
  face: TopoDS_Face,
  target: FaceMeshTarget,
) {
  const location = new opencascade.TopLoc_Location_1()
  const triangulationHandle = opencascade.BRep_Tool.Triangulation(face, location, 0 as never)

  try {
    if (triangulationHandle.IsNull()) {
      return false
    }

    const transformation = location.Transformation()

    try {
      const nodeOffset = appendFaceNodes(triangulationHandle.get(), transformation, target)
      appendFaceNormals(opencascade, face, triangulationHandle, transformation, target)
      appendFaceTriangles(opencascade, face, triangulationHandle, nodeOffset, target)
      return true
    } finally {
      transformation.delete()
    }
  } finally {
    triangulationHandle.delete()
    location.delete()
  }
}

export function meshOcctShape(
  opencascade: OpenCascadeInstance,
  shape: Shape3D,
  options: OcctMeshOptions,
): ShapeMesh {
  const mesher = new opencascade.BRepMesh_IncrementalMesh_2(
    shape.wrapped,
    options.tolerance,
    false,
    options.angularTolerance,
    false,
  )
  const faceType = opencascade.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum
  const shapeType = opencascade.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum
  const explorer = new opencascade.TopExp_Explorer_2(shape.wrapped, faceType, shapeType)
  const mesh: ShapeMesh = { triangles: [], vertices: [], normals: [], faceGroups: [] }

  try {
    while (explorer.More()) {
      const rawFace = explorer.Current()
      const face = opencascade.TopoDS.Face_1(rawFace)
      const groupStart = mesh.triangles.length

      try {
        if (appendFaceMesh(opencascade, face, mesh)) {
          mesh.faceGroups.push({
            start: groupStart,
            count: mesh.triangles.length - groupStart,
            faceId: face.HashCode(hashCodeUpperBound),
          })
        }
      } finally {
        face.delete()
        rawFace.delete()
      }

      explorer.Next()
    }

    return mesh
  } finally {
    explorer.delete()
    mesher.delete()
  }
}

export function exportMeshedOcctStl(
  opencascade: OpenCascadeInstance,
  shape: Shape3D,
  binary: boolean,
) {
  const filename = "/vibeshape-export.stl"

  try {
    if (!opencascade.StlAPI.Write(shape.wrapped, filename, !binary)) {
      throw new Error("OCCT failed to write the STL file.")
    }

    const bytes = opencascade.FS.readFile(filename)
    const ownedBytes = new Uint8Array(bytes.byteLength)
    ownedBytes.set(bytes)
    return new Blob([ownedBytes.buffer], { type: "model/stl" })
  } finally {
    unlinkVirtualFile(opencascade, filename)
    opencascade.BRepTools.Clean(shape.wrapped, true)
  }
}
