import {
  analyticalLoftHoleCorrespondenceSchema,
  type LoftFeatureContentParametersV2,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance, TopoDS_Shape } from "replicad-opencascadejs"
import type { AnalyticalProfile } from "./occt-loft"
import { cutOcctShapes } from "./occt-shapes"

export type LoftHoleCorrespondence = LoftFeatureContentParametersV2["holeCorrespondence"]
function matchedLoftHoleSections(
  sections: readonly AnalyticalProfile[],
  correspondence: LoftHoleCorrespondence,
) {
  const tracks = analyticalLoftHoleCorrespondenceSchema.parse(correspondence)
  const matched = tracks.map(({ sectionBoundaryEntityIds }) =>
    sections.map((section, index) => {
      const ids = sectionBoundaryEntityIds[index]
      const hole = section.holes.find(
        ({ sourceEntityIds }) => JSON.stringify(sourceEntityIds) === JSON.stringify(ids),
      )
      if (!hole || sectionBoundaryEntityIds.length !== sections.length)
        throw new Error("Loft hole correspondence must match every ordered section.")
      return { ...section, outer: hole, holes: [] }
    }),
  )
  for (const [index, section] of sections.entries()) {
    const keys = matched.map((track) => JSON.stringify(track[index]?.outer.sourceEntityIds))
    if (keys.length !== section.holes.length || new Set(keys).size !== keys.length)
      throw new Error("Every Loft hole requires exactly one explicit correspondence.")
  }
  return matched
}
function volume(occt: OpenCascadeInstance, shape: TopoDS_Shape) {
  const properties = new occt.GProp_GProps_1()
  try {
    occt.BRepGProp.VolumeProperties_1(shape, properties, false, false, false)
    return Math.abs(properties.Mass())
  } finally {
    properties.delete()
  }
}
function commonVolume(occt: OpenCascadeInstance, a: Shape3D, b: Shape3D) {
  const progress = new occt.Message_ProgressRange_1()
  try {
    const builder = new occt.BRepAlgoAPI_Common_3(a.wrapped, b.wrapped, progress)
    try {
      builder.Build(progress)
      if (!builder.IsDone()) throw new Error("OCCT Loft hole intersection did not complete.")
      const shape = builder.Shape()
      try {
        return volume(occt, shape)
      } finally {
        shape.delete()
      }
    } finally {
      builder.delete()
    }
  } finally {
    progress.delete()
  }
}
/** Each authored hole track owns a full inner solid, never an automatically paired boundary. */
export function createHoledLoft(
  occt: OpenCascadeInstance,
  sections: readonly AnalyticalProfile[],
  correspondence: LoftHoleCorrespondence,
  boundaryLoft: (sections: readonly AnalyticalProfile[]) => Shape3D,
  validate: (shape: Shape3D) => void,
) {
  const tracks = matchedLoftHoleSections(sections, correspondence)
  const holes: Shape3D[] = []
  let result: Shape3D | null = null
  try {
    result = boundaryLoft(sections.map((section) => ({ ...section, holes: [] })))
    for (const track of tracks) {
      const hole = boundaryLoft(track)
      holes.push(hole)
      const holeVolume = volume(occt, hole.wrapped),
        tolerance = Math.max(1e-6, holeVolume * 1e-8)
      if (Math.abs(commonVolume(occt, result, hole) - holeVolume) > tolerance)
        throw new Error("Loft hole must remain entirely inside the outer Loft.")
      for (const previous of holes.slice(0, -1))
        if (commonVolume(occt, previous, hole) > tolerance)
          throw new Error("Loft hole tracks must not overlap between sections.")
      const next = cutOcctShapes(occt, result, hole)
      result.delete()
      result = next
      validate(result)
    }
    const shape = result
    result = null
    return shape
  } finally {
    result?.delete()
    for (const hole of holes.reverse()) hole.delete()
  }
}
