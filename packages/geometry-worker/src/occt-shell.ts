import type { Shape3D } from "replicad"
import type {
  BRepOffset_Mode,
  BRepOffsetAPI_MakeThickSolid,
  GeomAbs_JoinType,
  Message_ProgressRange,
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
  TopoDS_Shape,
} from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"

type OwnedBinding = { delete(): unknown }
type OwnBinding = <T extends OwnedBinding>(binding: T) => T
function positiveSingleSolid(metrics: ReturnType<typeof inspectOcctBody>) {
  return (
    metrics.valid &&
    metrics.solidCount === 1 &&
    Number.isFinite(metrics.volume) &&
    metrics.volume > 0
  )
}
function closedCavityVolume(
  source: ReturnType<typeof inspectOcctBody>,
  offset: ReturnType<typeof inspectOcctBody>,
  direction: "inward" | "outward",
) {
  const volume =
    direction === "inward" ? source.volume - offset.volume : offset.volume - source.volume
  if (
    !positiveSingleSolid(source) ||
    !positiveSingleSolid(offset) ||
    !Number.isFinite(volume) ||
    volume <= 0
  )
    throw new Error("Shell thickness collapses or reverses the offset solid.")
  return volume
}
function selectOpeningFaces(source: Shape3D, keys: readonly number[]) {
  const faces = source.faces
  try {
    if (keys.length > 64 || new Set(keys).size !== keys.length)
      throw new Error("Shell supports at most 64 distinct opening faces.")
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

function requireClosedCavity(
  occt: OpenCascadeInstance,
  result: Shape3D,
  expectedVolume: number,
  inspectBody: typeof inspectOcctBody,
) {
  const metrics = inspectBody(occt, result)
  if (
    !positiveSingleSolid(metrics) ||
    Math.abs(metrics.volume - expectedVolume) > Math.max(1, expectedVolume) * 1e-7
  )
    throw new Error("Shell offset does not form a nested closed cavity.")
  const explorer = new occt.TopExp_Explorer_2(
    result.wrapped,
    occt.TopAbs_ShapeEnum.TopAbs_SHELL as TopAbs_ShapeEnum,
    occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
  )
  try {
    let shells = 0
    while (explorer.More()) {
      shells += 1
      explorer.Next()
    }
    if (shells < 2) throw new Error("Shell must retain an inner closed shell.")
  } finally {
    explorer.delete()
  }
}

function createClosedCavity(
  occt: OpenCascadeInstance,
  source: Shape3D,
  copied: TopoDS_Shape,
  builder: BRepOffsetAPI_MakeThickSolid,
  progress: Message_ProgressRange,
  direction: "inward" | "outward",
  castShape: OcctShapeCaster,
  inspectBody: typeof inspectOcctBody,
  own: OwnBinding,
) {
  const offset = own(adoptOcctShape(builder.Shape(), castShape))
  const expectedVolume = closedCavityVolume(
    inspectBody(occt, source),
    inspectBody(occt, offset),
    direction,
  )
  // Subtract the nested solid so a closed offset retains both its inner and outer boundary.
  const cutter = own(
    new occt.BRepAlgoAPI_Cut_3(
      direction === "inward" ? copied : offset.wrapped,
      direction === "inward" ? offset.wrapped : copied,
      progress,
    ),
  )
  cutter.Build(progress)
  if (!cutter.IsDone()) throw new Error("OCCT closed cavity did not complete.")
  const result = adoptOcctShape(cutter.Shape(), castShape)
  try {
    requireClosedCavity(occt, result, expectedVolume, inspectBody)
    return result
  } catch (error) {
    result.delete()
    throw error
  }
}

export function createOcctShellOperations(
  castShape: OcctShapeCaster,
  inspectBody = inspectOcctBody,
) {
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
        const offsetArguments = [
          direction === "inward" ? -thickness : thickness,
          1e-7,
          opencascade.BRepOffset_Mode.BRepOffset_Skin as BRepOffset_Mode,
          false,
          false,
          opencascade.GeomAbs_JoinType.GeomAbs_Intersection as GeomAbs_JoinType,
          false,
          progress,
        ] as const
        if (selected.length === 0) builder.PerformByJoin(copied, ...offsetArguments)
        else builder.MakeThickSolidByJoin(copied, openings, ...offsetArguments)
        if (!builder.IsDone()) throw new Error("OCCT shell did not complete.")
        if (selected.length === 0)
          return createClosedCavity(
            opencascade,
            source,
            copied,
            builder,
            progress,
            direction,
            castShape,
            inspectBody,
            own,
          )
        return adoptOcctShape(builder.Shape(), castShape)
      } finally {
        for (const binding of owned.reverse()) binding.delete()
      }
    },
  }
}
export const { shellShape: shellOcctShape } = createOcctShellOperations(castOcctShape)
