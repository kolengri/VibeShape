import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"

export function createOcctCompound(
  opencascade: OpenCascadeInstance,
  shapes: readonly Shape3D[],
  castShape: OcctShapeCaster = castOcctShape,
) {
  if (shapes.length < 2) {
    throw new RangeError("An OCCT compound requires at least two source shapes.")
  }

  const compound = new opencascade.TopoDS_Compound()
  const builder = new opencascade.TopoDS_Builder()

  try {
    builder.MakeCompound(compound)
    for (const shape of shapes) builder.Add(compound, shape.wrapped)
    return adoptOcctShape(compound, castShape)
  } finally {
    builder.delete()
  }
}
