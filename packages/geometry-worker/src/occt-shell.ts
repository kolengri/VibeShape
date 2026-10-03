import type { Shape3D } from "replicad"
import type { BRepOffset_Mode, GeomAbs_JoinType, OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"

type OwnedBinding = { delete(): unknown }
function selectOpeningFaces(source: Shape3D, keys: readonly number[]) {
  const faces = source.faces
  try {
    if (keys.length === 0 || keys.length > 64 || new Set(keys).size !== keys.length)
      throw new Error("Shell requires 1–64 distinct opening faces.")
    const selected = keys.map((key) => {
      const matches = faces.filter((face) => face.hashCode === key)
      const selected = matches[0]
      if (matches.length !== 1 || !selected)
        throw new Error("Shell opening face is missing or ambiguous.")
      return selected
    })
    return { faces, selected }
  } catch (error) {
    for (const face of faces) face.delete()
    throw error
  }
}

function validateShellOffset(thickness: number, direction: string) {
  if (direction !== "inward" && direction !== "outward")
    throw new Error("Shell direction is invalid.")
  if (!Number.isFinite(thickness) || thickness <= 0 || thickness > 100_000)
    throw new Error("Shell thickness is invalid.")
}

export function createOcctShellOperations(castShape: OcctShapeCaster) {
  return {
    shellShape(
      opencascade: OpenCascadeInstance,
      source: Shape3D,
      keys: readonly number[],
      thickness: number,
      direction: "inward" | "outward",
    ): Shape3D {
      validateShellOffset(thickness, direction)
      const { faces, selected } = selectOpeningFaces(source, keys)
      const owned: OwnedBinding[] = [...faces]
      const own = <T extends OwnedBinding>(binding: T): T => {
        owned.push(binding)
        return binding
      }
      try {
        const transform = own(new opencascade.gp_Trsf_1())
        // Deep-copy both solid and selected faces before the native offset builder touches them.
        const copier = own(
          new opencascade.BRepBuilderAPI_Transform_2(source.wrapped, transform, true),
        )
        if (!copier.IsDone()) throw new Error("Shell source copy did not complete.")
        const copied = own(copier.Shape())
        const openings = own(new opencascade.TopTools_ListOfShape_1())
        for (const face of selected) {
          const mapped = own(copier.ModifiedShape(face.wrapped))
          if (mapped.IsNull()) throw new Error("Shell opening is unavailable on the owned copy.")
          own(openings.Append_1(mapped))
        }
        const progress = own(new opencascade.Message_ProgressRange_1())
        const builder = own(new opencascade.BRepOffsetAPI_MakeThickSolid())
        // Generated enum members are opaque `{}` values, while the native method expects their enum types.
        builder.MakeThickSolidByJoin(
          copied,
          openings,
          direction === "inward" ? -thickness : thickness,
          1e-7,
          opencascade.BRepOffset_Mode.BRepOffset_Skin as BRepOffset_Mode,
          false,
          false,
          opencascade.GeomAbs_JoinType.GeomAbs_Intersection as GeomAbs_JoinType,
          false,
          progress,
        )
        if (!builder.IsDone()) throw new Error("OCCT shell did not complete.")
        return adoptOcctShape(builder.Shape(), castShape)
      } finally {
        for (const binding of owned.reverse()) binding.delete()
      }
    },
  }
}
export const { shellShape: shellOcctShape } = createOcctShellOperations(castOcctShape)
