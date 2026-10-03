import {
  type PlacementFeatureContentParameters,
  placementFeatureContentParametersSchema,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"

export function createOcctPlacementOperations(castShape: OcctShapeCaster) {
  return {
    placeShape(
      opencascade: OpenCascadeInstance,
      source: Shape3D,
      parameters: PlacementFeatureContentParameters,
    ): Shape3D {
      const {
        translation: [tx, ty, tz],
        rotation: [rx, ry, rz],
      } = placementFeatureContentParametersSchema.parse(parameters)
      const [sx, sy, sz] = [Math.sin(rx), Math.sin(ry), Math.sin(rz)]
      const [cx, cy, cz] = [Math.cos(rx), Math.cos(ry), Math.cos(rz)]
      const transform = new opencascade.gp_Trsf_1()
      try {
        // Fixed right-handed world rotations Rz * Ry * Rx, followed by world translation.
        transform.SetValues(
          cz * cy,
          cz * sy * sx - sz * cx,
          cz * sy * cx + sz * sx,
          tx,
          sz * cy,
          sz * sy * sx + cz * cx,
          sz * sy * cx - cz * sx,
          ty,
          -sy,
          cy * sx,
          cy * cx,
          tz,
        )
        // The pinned generated binding has three arguments. Copy=true preserves source ownership.
        const builder = new opencascade.BRepBuilderAPI_Transform_2(source.wrapped, transform, true)
        try {
          if (!builder.IsDone()) throw new Error("OCCT placement did not complete.")
          return adoptOcctShape(builder.Shape(), castShape)
        } finally {
          builder.delete()
        }
      } finally {
        transform.delete()
      }
    },
  }
}

export const { placeShape: placeOcctShape } = createOcctPlacementOperations(castOcctShape)
