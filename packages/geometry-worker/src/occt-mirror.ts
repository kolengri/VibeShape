import {
  type MirrorFeatureContentParameters,
  type MirrorFeatureContentParametersV2,
  type MirrorFeatureContentParametersV3,
  mirrorFeatureContentParametersSchema,
  mirrorFeatureContentParametersV2Schema,
  mirrorFeatureContentParametersV3Schema,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"

function reflectionPlane(
  parameters:
    | MirrorFeatureContentParameters
    | MirrorFeatureContentParametersV2
    | MirrorFeatureContentParametersV3,
): Readonly<{
  origin: readonly [number, number, number]
  normal: readonly [number, number, number]
}> {
  if ("planeOrigin" in parameters) {
    const { planeOrigin, planeNormal, offset } =
      mirrorFeatureContentParametersV3Schema.parse(parameters)
    return {
      origin: planeOrigin.map((value, index) => value + offset * (planeNormal[index] ?? 0)) as [
        number,
        number,
        number,
      ],
      normal: planeNormal,
    }
  }
  const { plane, offset } =
    "offset" in parameters
      ? mirrorFeatureContentParametersV2Schema.parse(parameters)
      : { ...mirrorFeatureContentParametersSchema.parse(parameters), offset: 0 }
  const normals = { XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] } as const
  const normal = normals[plane]
  return {
    origin: normal.map((value) => (value === 0 ? 0 : offset)) as [number, number, number],
    normal,
  }
}
export function createOcctMirrorOperations(castShape: OcctShapeCaster) {
  return {
    mirrorShape(
      opencascade: OpenCascadeInstance,
      source: Shape3D,
      parameters:
        | MirrorFeatureContentParameters
        | MirrorFeatureContentParametersV2
        | MirrorFeatureContentParametersV3,
    ): Shape3D {
      const plane = reflectionPlane(parameters)
      const origin = new opencascade.gp_Pnt_3(...plane.origin)
      try {
        const direction = new opencascade.gp_Dir_4(...plane.normal)
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
