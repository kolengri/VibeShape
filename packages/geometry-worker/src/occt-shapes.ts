import type { Shape3D } from "replicad"
import type { OpenCascadeInstance, TopAbs_ShapeEnum, TopoDS_Edge } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"

type Vector3 = readonly [number, number, number]
export function createOcctShapeOperations(castShape: OcctShapeCaster) {
  function createBox(opencascade: OpenCascadeInstance, dimensions: Vector3): Shape3D {
    const [length, width, height] = dimensions
    const corner = new opencascade.gp_Pnt_3(-length / 2, -width / 2, 0)

    try {
      const maker = new opencascade.BRepPrimAPI_MakeBox_3(corner, length, width, height)

      try {
        return adoptOcctShape(maker.Solid(), castShape)
      } finally {
        maker.delete()
      }
    } finally {
      corner.delete()
    }
  }

  function createCylinder(
    opencascade: OpenCascadeInstance,
    radius: number,
    height: number,
    origin: Vector3,
  ): Shape3D {
    const point = new opencascade.gp_Pnt_3(...origin)
    const direction = new opencascade.gp_Dir_4(0, 0, 1)
    const axis = new opencascade.gp_Ax2_3(point, direction)

    try {
      const maker = new opencascade.BRepPrimAPI_MakeCylinder_3(axis, radius, height)

      try {
        return adoptOcctShape(maker.Solid(), castShape)
      } finally {
        maker.delete()
      }
    } finally {
      axis.delete()
      direction.delete()
      point.delete()
    }
  }

  function cutShapes(opencascade: OpenCascadeInstance, source: Shape3D, tool: Shape3D): Shape3D {
    const progress = new opencascade.Message_ProgressRange_1()
    const cutter = new opencascade.BRepAlgoAPI_Cut_3(source.wrapped, tool.wrapped, progress)

    try {
      cutter.Build(progress)
      cutter.SimplifyResult(true, true, 1e-3)
      return adoptOcctShape(cutter.Shape(), castShape)
    } finally {
      cutter.delete()
      progress.delete()
    }
  }

  function edgeLiesAtZ(
    opencascade: OpenCascadeInstance,
    edge: TopoDS_Edge,
    z: number,
    tolerance: number,
  ) {
    const vertexType = opencascade.TopAbs_ShapeEnum.TopAbs_VERTEX as TopAbs_ShapeEnum
    const shapeType = opencascade.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum
    const explorer = new opencascade.TopExp_Explorer_2(edge, vertexType, shapeType)
    let matches = true
    let vertexCount = 0

    try {
      while (explorer.More()) {
        const rawVertex = explorer.Current()
        const vertex = opencascade.TopoDS.Vertex_1(rawVertex)

        try {
          const point = opencascade.BRep_Tool.Pnt(vertex)

          try {
            matches &&= Math.abs(point.Z() - z) <= tolerance
            vertexCount += 1
          } finally {
            point.delete()
          }
        } finally {
          vertex.delete()
          rawVertex.delete()
        }

        explorer.Next()
      }
    } finally {
      explorer.delete()
    }

    return vertexCount > 0 && matches
  }

  function filletEdgesAtZ(
    opencascade: OpenCascadeInstance,
    source: Shape3D,
    radius: number,
    z: number,
  ): Shape3D {
    const filletShape = opencascade.ChFi3d_FilletShape.ChFi3d_Rational as never
    const builder = new opencascade.BRepFilletAPI_MakeFillet(source.wrapped, filletShape)
    const edgeType = opencascade.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum
    const shapeType = opencascade.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum
    const explorer = new opencascade.TopExp_Explorer_2(source.wrapped, edgeType, shapeType)
    const progress = new opencascade.Message_ProgressRange_1()
    let edgeCount = 0

    try {
      while (explorer.More()) {
        const rawEdge = explorer.Current()
        const edge = opencascade.TopoDS.Edge_1(rawEdge)

        try {
          if (edgeLiesAtZ(opencascade, edge, z, 1e-7)) {
            builder.Add_2(radius, edge)
            edgeCount += 1
          }
        } finally {
          edge.delete()
          rawEdge.delete()
        }

        explorer.Next()
      }

      if (edgeCount === 0) {
        throw new Error("Could not fillet because no edge lies in the target plane.")
      }

      builder.Build(progress)
      return adoptOcctShape(builder.Shape(), castShape)
    } finally {
      progress.delete()
      explorer.delete()
      builder.delete()
    }
  }

  return { createBox, createCylinder, cutShapes, filletEdgesAtZ }
}

export const {
  createBox: createOcctBox,
  createCylinder: createOcctCylinder,
  cutShapes: cutOcctShapes,
  filletEdgesAtZ: filletOcctEdgesAtZ,
} = createOcctShapeOperations(castOcctShape)
