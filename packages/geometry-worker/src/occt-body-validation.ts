import type { Shape3D } from "replicad"
import type { OpenCascadeInstance, TopAbs_ShapeEnum } from "replicad-opencascadejs"

export function inspectOcctBody(
  occt: OpenCascadeInstance,
  shape: Shape3D,
): Readonly<{ valid: boolean; solidCount: number; volume: number }> {
  const analyzer = new occt.BRepCheck_Analyzer(shape.wrapped, true, false)
  try {
    const properties = new occt.GProp_GProps_1()
    try {
      occt.BRepGProp.VolumeProperties_1(shape.wrapped, properties, false, false, false)
      const explorer = new occt.TopExp_Explorer_2(
        shape.wrapped,
        occt.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum,
        occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
      )
      try {
        let solidCount = 0
        while (explorer.More()) {
          solidCount += 1
          explorer.Next()
        }
        return { valid: analyzer.IsValid_2(), solidCount, volume: properties.Mass() }
      } finally {
        explorer.delete()
      }
    } finally {
      properties.delete()
    }
  } finally {
    analyzer.delete()
  }
}
