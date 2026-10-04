import {
  type ExtrusionMultiProfileContentParameters,
  extrusionFrameSchema,
  extrusionProfileLoopSchema,
  validateAnalyticalSweepGeometry,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"
import {
  type AnalyticalProfile,
  createAnalyticalFace,
  createAnalyticalWire,
  parseAnalyticalProfile,
  validateOcctProfileSolid,
} from "./occt-loft"

type ProfileSegment = AnalyticalProfile["outer"]["segments"][number]
type PathSegment = Exclude<ProfileSegment, { type: "circle" | "ellipse" }>
export type AnalyticalSweepPath = Readonly<{
  frame: ExtrusionMultiProfileContentParameters["frame"]
  sourceEntityIds: readonly string[]
  segments: readonly PathSegment[]
}>
function parseSweepPath(path: AnalyticalSweepPath) {
  const frame = extrusionFrameSchema.parse(path.frame)
  const loop = extrusionProfileLoopSchema.parse({
    sourceEntityIds: path.sourceEntityIds,
    segments: path.segments,
  })
  const segments: PathSegment[] = []
  for (const segment of loop.segments) {
    if (segment.type === "circle" || segment.type === "ellipse")
      throw new Error("Sweep paths require open analytical curves.")
    segments.push(segment)
  }
  return { frame, sourceEntityIds: loop.sourceEntityIds, segments }
}

export function createOcctSweepOperations(
  castShape: OcctShapeCaster,
  makeWire = createAnalyticalWire,
  makeFace = createAnalyticalFace,
  validateSolid = validateOcctProfileSolid,
) {
  return {
    sweepShape(
      opencascade: OpenCascadeInstance,
      parameters: Readonly<{ profile: AnalyticalProfile; path: AnalyticalSweepPath }>,
    ): Shape3D {
      const profile = parseAnalyticalProfile(parameters.profile)
      const path = parseSweepPath(parameters.path)
      validateAnalyticalSweepGeometry(profile, path)
      const spine = makeWire(opencascade, path.frame, path.segments)
      try {
        const face = makeFace(opencascade, profile)
        try {
          const builder = new opencascade.BRepOffsetAPI_MakePipe_1(spine.wrapped, face.wrapped)
          try {
            const progress = new opencascade.Message_ProgressRange_1()
            try {
              builder.Build(progress)
              if (!builder.IsDone()) throw new Error("OCCT Sweep did not complete.")
              const shape = adoptOcctShape(builder.Shape(), castShape)
              try {
                validateSolid(opencascade, shape)
                return shape
              } catch (error) {
                shape.delete()
                throw error
              }
            } finally {
              progress.delete()
            }
          } finally {
            builder.delete()
          }
        } finally {
          face.delete()
        }
      } finally {
        spine.delete()
      }
    },
  }
}

export const { sweepShape: createOcctSweep } = createOcctSweepOperations(castOcctShape)
