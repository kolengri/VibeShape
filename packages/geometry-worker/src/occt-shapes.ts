import type { Shape3D } from "replicad"
import type { OpenCascadeInstance, TopAbs_ShapeEnum, TopoDS_Edge } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"
import {
  captureOcctBooleanHistory,
  captureOcctFaceLineage,
  captureOcctFilletHistory,
  type OcctBooleanHistory,
  type OcctFaceLineage,
  type OcctFilletHistory,
} from "./occt-history"

type Vector3 = readonly [number, number, number]

interface FilletEdgeCollector {
  Add_2(radius: number, edge: TopoDS_Edge): void
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

function readLinearEdgeKeys(source: Shape3D) {
  const edges = source.edges
  const keys = new Set<number>()
  try {
    for (const edge of edges) {
      if (edge.geomType === "LINE") keys.add(edge.hashCode)
    }
    return keys
  } finally {
    for (const edge of edges) edge.delete()
  }
}

function addLinearFilletEdgesAtZ(
  opencascade: OpenCascadeInstance,
  source: Shape3D,
  builder: FilletEdgeCollector,
  radius: number,
  z: number,
) {
  const linearEdgeKeys = readLinearEdgeKeys(source)
  const edgeType = opencascade.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum
  const shapeType = opencascade.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum
  const explorer = new opencascade.TopExp_Explorer_2(source.wrapped, edgeType, shapeType)
  let edgeCount = 0
  try {
    while (explorer.More()) {
      const rawEdge = explorer.Current()
      const edge = opencascade.TopoDS.Edge_1(rawEdge)
      try {
        // Transient hashes are safe for selection inside one evaluation and never leave the adapter.
        if (
          linearEdgeKeys.has(edge.HashCode(2_147_483_647)) &&
          edgeLiesAtZ(opencascade, edge, z, 1e-7)
        ) {
          builder.Add_2(radius, edge)
          edgeCount += 1
        }
      } finally {
        edge.delete()
        rawEdge.delete()
      }
      explorer.Next()
    }
    return edgeCount
  } finally {
    explorer.delete()
  }
}

export function createOcctShapeOperations(castShape: OcctShapeCaster) {
  function createBox(
    opencascade: OpenCascadeInstance,
    dimensions: Vector3,
    centeredZ = false,
    origin: Vector3 = [0, 0, 0],
  ): Shape3D {
    const [length, width, height] = dimensions
    const corner = new opencascade.gp_Pnt_3(
      origin[0] - length / 2,
      origin[1] - width / 2,
      origin[2] + (centeredZ ? -height / 2 : 0),
    )

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

  function performCut(
    opencascade: OpenCascadeInstance,
    source: Shape3D,
    tool: Shape3D,
    captureHistory: boolean,
    sourceLineage: ReadonlyMap<number, readonly string[]> | null = null,
  ): { history: OcctBooleanHistory | null; lineage: OcctFaceLineage | null; shape: Shape3D } {
    const progress = new opencascade.Message_ProgressRange_1()
    const cutter = new opencascade.BRepAlgoAPI_Cut_3(source.wrapped, tool.wrapped, progress)

    try {
      cutter.SetToFillHistory(captureHistory || sourceLineage !== null)
      cutter.Build(progress)
      cutter.SimplifyResult(true, true, 1e-3)
      const history = captureHistory
        ? captureOcctBooleanHistory(opencascade, cutter, [source.wrapped, tool.wrapped])
        : null
      const lineage = sourceLineage
        ? captureOcctFaceLineage(
            opencascade,
            cutter,
            [source.wrapped, tool.wrapped],
            sourceLineage,
            true,
          )
        : null
      return { history, lineage, shape: adoptOcctShape(cutter.Shape(), castShape) }
    } finally {
      cutter.delete()
      progress.delete()
    }
  }

  function performSimpleBoolean(
    opencascade: OpenCascadeInstance,
    source: Shape3D,
    tool: Shape3D,
    operation: "common" | "fuse",
  ): Shape3D {
    const progress = new opencascade.Message_ProgressRange_1()
    const Builder =
      operation === "fuse" ? opencascade.BRepAlgoAPI_Fuse_3 : opencascade.BRepAlgoAPI_Common_3
    const builder = new Builder(source.wrapped, tool.wrapped, progress)

    try {
      builder.SetToFillHistory(false)
      builder.Build(progress)
      builder.SimplifyResult(true, true, 1e-3)
      return adoptOcctShape(builder.Shape(), castShape)
    } finally {
      builder.delete()
      progress.delete()
    }
  }

  function fuseShapes(opencascade: OpenCascadeInstance, source: Shape3D, tool: Shape3D): Shape3D {
    return performSimpleBoolean(opencascade, source, tool, "fuse")
  }

  function intersectShapes(
    opencascade: OpenCascadeInstance,
    source: Shape3D,
    tool: Shape3D,
  ): Shape3D {
    return performSimpleBoolean(opencascade, source, tool, "common")
  }

  function cutShapes(opencascade: OpenCascadeInstance, source: Shape3D, tool: Shape3D): Shape3D {
    return performCut(opencascade, source, tool, false).shape
  }

  function cutShapesWithHistory(opencascade: OpenCascadeInstance, source: Shape3D, tool: Shape3D) {
    const result = performCut(opencascade, source, tool, true)

    if (!result.history) {
      throw new Error("OCCT boolean history was not captured.")
    }

    return { history: result.history, shape: result.shape }
  }

  function cutShapesWithLineage(
    opencascade: OpenCascadeInstance,
    source: Shape3D,
    tool: Shape3D,
    sourceLineage: ReadonlyMap<number, readonly string[]>,
  ) {
    const result = performCut(opencascade, source, tool, false, sourceLineage)
    if (!result.lineage) throw new Error("OCCT boolean lineage was not captured.")
    return { lineage: result.lineage, shape: result.shape }
  }

  function performFilletEdgesAtZ(
    opencascade: OpenCascadeInstance,
    source: Shape3D,
    radius: number,
    z: number,
    captureHistory: boolean,
    sourceLineage: ReadonlyMap<number, readonly string[]> | null = null,
  ): { history: OcctFilletHistory | null; lineage: OcctFaceLineage | null; shape: Shape3D } {
    const filletShape = opencascade.ChFi3d_FilletShape.ChFi3d_Rational as never
    const builder = new opencascade.BRepFilletAPI_MakeFillet(source.wrapped, filletShape)
    const progress = new opencascade.Message_ProgressRange_1()

    try {
      const edgeCount = addLinearFilletEdgesAtZ(opencascade, source, builder, radius, z)
      if (edgeCount === 0) {
        throw new Error("Could not fillet because no edge lies in the target plane.")
      }

      builder.Build(progress)
      const history = captureHistory
        ? captureOcctFilletHistory(opencascade, builder, source.wrapped)
        : null
      const lineage = sourceLineage
        ? captureOcctFaceLineage(opencascade, builder, [source.wrapped], sourceLineage, false)
        : null
      return { history, lineage, shape: adoptOcctShape(builder.Shape(), castShape) }
    } finally {
      progress.delete()
      builder.delete()
    }
  }

  function filletEdgesAtZ(
    opencascade: OpenCascadeInstance,
    source: Shape3D,
    radius: number,
    z: number,
  ): Shape3D {
    return performFilletEdgesAtZ(opencascade, source, radius, z, false).shape
  }

  function filletEdgesAtZWithHistory(
    opencascade: OpenCascadeInstance,
    source: Shape3D,
    radius: number,
    z: number,
  ) {
    const result = performFilletEdgesAtZ(opencascade, source, radius, z, true)

    if (!result.history) {
      throw new Error("OCCT fillet history was not captured.")
    }

    return { history: result.history, shape: result.shape }
  }

  function filletEdgesAtZWithLineage(
    opencascade: OpenCascadeInstance,
    source: Shape3D,
    radius: number,
    z: number,
    sourceLineage: ReadonlyMap<number, readonly string[]>,
  ) {
    const result = performFilletEdgesAtZ(opencascade, source, radius, z, false, sourceLineage)
    if (!result.lineage) throw new Error("OCCT fillet lineage was not captured.")
    return { lineage: result.lineage, shape: result.shape }
  }

  return {
    createBox,
    createCylinder,
    cutShapes,
    cutShapesWithHistory,
    cutShapesWithLineage,
    fuseShapes,
    intersectShapes,
    filletEdgesAtZ,
    filletEdgesAtZWithHistory,
    filletEdgesAtZWithLineage,
  }
}

export const {
  createBox: createOcctBox,
  createCylinder: createOcctCylinder,
  cutShapes: cutOcctShapes,
  cutShapesWithHistory: cutOcctShapesWithHistory,
  cutShapesWithLineage: cutOcctShapesWithLineage,
  fuseShapes: fuseOcctShapes,
  intersectShapes: intersectOcctShapes,
  filletEdgesAtZWithHistory: filletOcctEdgesAtZWithHistory,
  filletEdgesAtZWithLineage: filletOcctEdgesAtZWithLineage,
} = createOcctShapeOperations(castOcctShape)
