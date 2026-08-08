import { cast, type Shape3D } from "replicad"
import type { TopoDS_Shape } from "replicad-opencascadejs"

export type OcctShapeCaster = (shape: TopoDS_Shape) => Shape3D

export function adoptOcctShape(shape: TopoDS_Shape, castShape: OcctShapeCaster): Shape3D {
  try {
    return castShape(shape)
  } finally {
    shape.delete()
  }
}

export function castOcctShape(shape: TopoDS_Shape) {
  return cast(shape).asShape3D()
}
