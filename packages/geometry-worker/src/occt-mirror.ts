import {
  type MirrorFeatureContentParameters,
  type MirrorFeatureContentParametersV2,
  mirrorFeatureContentParametersSchema,
  mirrorFeatureContentParametersV2Schema,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"

export function createOcctMirrorOperations(castShape: OcctShapeCaster) {
  return {
    mirrorShape(
      opencascade: OpenCascadeInstance,
      source: Shape3D,
      parameters: MirrorFeatureContentParameters | MirrorFeatureContentParametersV2,
    ): Shape3D {
      const { plane, offset } =
        "offset" in parameters
          ? mirrorFeatureContentParametersV2Schema.parse(parameters)
          : { ...mirrorFeatureContentParametersSchema.parse(parameters), offset: 0 }
      const normal: [number, number, number] =
        plane === "XY" ? [0, 0, 1] : plane === "XZ" ? [0, 1, 0] : [1, 0, 0]
      const origin = new opencascade.gp_Pnt_3(
        normal[0] === 0 ? 0 : offset,
        normal[1] === 0 ? 0 : offset,
        normal[2] === 0 ? 0 : offset,
      )
      try {
        const direction = new opencascade.gp_Dir_4(...normal)
        try {
          const axis = new opencascade.gp_Ax2_3(origin, direction)
          try {
            const transform = new opencascade.gp_Trsf_1()
            try {
              transform.SetMirror_3(axis)
              // Replicad mirror deletes its receiver. Copy the exact cached source through OCCT.
              const builder = new opencascade.BRepBuilderAPI_Transform_2(
                source.wrapped,
                transform,
                true,
              )
              try {
                if (!builder.IsDone()) throw new Error("OCCT mirror did not complete.")
                return adoptOcctShape(builder.Shape(), castShape)
              } finally {
                builder.delete()
              }
            } finally {
              transform.delete()
            }
          } finally {
            axis.delete()
          }
        } finally {
          direction.delete()
        }
      } finally {
        origin.delete()
      }
    },
  }
}
export const { mirrorShape: mirrorOcctShape } = createOcctMirrorOperations(castOcctShape)
