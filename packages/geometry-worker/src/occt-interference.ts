import type { AssemblyInspection } from "@vibeshape/protocol"
import type { OpenCascadeInstance, TopAbs_ShapeEnum, TopoDS_Shape } from "replicad-opencascadejs"
import { type AssemblyPoseSource, copyOcctAssemblySource } from "./occt-assembly-pose"

export type NativeInterferenceSource = AssemblyPoseSource
type Deletable = { delete(): void }

function booleanResult(
  occt: OpenCascadeInstance,
  argumentsShapes: readonly TopoDS_Shape[],
  tools: readonly TopoDS_Shape[],
  kind: "fuse" | "common",
) {
  const owned: Deletable[] = []
  const own = <T extends Deletable>(value: T): T => {
    owned.push(value)
    return value
  }
  try {
    const args = own(new occt.TopTools_ListOfShape_1())
    const toolList = own(new occt.TopTools_ListOfShape_1())
    for (const shape of argumentsShapes) own(args.Append_1(shape))
    for (const shape of tools) own(toolList.Append_1(shape))
    const builder = own(
      kind === "fuse" ? new occt.BRepAlgoAPI_Fuse_1() : new occt.BRepAlgoAPI_Common_1(),
    )
    builder.SetArguments(args)
    builder.SetTools(toolList)
    builder.SetNonDestructive(true)
    builder.SetToFillHistory(false)
    builder.Build(own(new occt.Message_ProgressRange_1()))
    if (!builder.IsDone() || builder.HasErrors())
      throw new Error("Exact assembly Boolean did not complete.")
    return builder.Shape()
  } finally {
    for (const value of owned.reverse()) value.delete()
  }
}
function materialMetrics(occt: OpenCascadeInstance, shape: TopoDS_Shape) {
  const owned: Deletable[] = []
  const own = <T extends Deletable>(value: T): T => {
    owned.push(value)
    return value
  }
  try {
    const check = own(new occt.BRepCheck_Analyzer(shape, true, false))
    const properties = own(new occt.GProp_GProps_1())
    const explorer = own(
      new occt.TopExp_Explorer_2(
        shape,
        occt.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum,
        occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
      ),
    )
    if (!check.IsValid_2())
      throw new Error("Exact assembly interference produced invalid geometry.")
    occt.BRepGProp.VolumeProperties_1(shape, properties, false, false, false)
    let solidCount = 0
    while (explorer.More()) {
      solidCount++
      explorer.Next()
    }
    const volume = properties.Mass()
    if (!Number.isFinite(volume) || volume < 0 || (solidCount > 0 && volume <= 0))
      throw new Error("Exact assembly interference produced invalid material volume.")
    return { volume, solidCount }
  } finally {
    for (const value of owned.reverse()) value.delete()
  }
}

function nearestDistance(occt: OpenCascadeInstance, left: TopoDS_Shape, right: TopoDS_Shape) {
  const distance = new occt.BRepExtrema_DistShapeShape_1()
  const progress = new occt.Message_ProgressRange_1()
  try {
    distance.SetDeflection(1e-9)
    distance.LoadS1(left)
    distance.LoadS2(right)
    distance.Perform(progress)
    if (!distance.IsDone() || !Number.isFinite(distance.Value()) || distance.Value() < 0)
      throw new Error("Exact assembly distance did not complete.")
    return distance.Value()
  } finally {
    progress.delete()
    distance.delete()
  }
}

/** Unions each occurrence before Common, avoiding duplicate material counts for overlapping pins. */
export function measureOcctInterference(
  occt: OpenCascadeInstance,
  left: readonly NativeInterferenceSource[],
  right: readonly NativeInterferenceSource[],
  measureDistance = false,
): Pick<AssemblyInspection["interference"][number], "volume" | "solidCount" | "distance"> {
  if (!left.length || !right.length || left.length > 16 || right.length > 16)
    throw new Error(
      "Exact interference supports between one and sixteen source solids per instance.",
    )
  const owned: TopoDS_Shape[] = []
  const own = (value: TopoDS_Shape) => {
    owned.push(value)
    return value
  }
  const occurrence = (sources: readonly NativeInterferenceSource[]) => {
    const shapes = sources.map((source) => own(copyOcctAssemblySource(occt, source)))
    const first = shapes[0]
    if (!first) throw new Error("An assembly instance has no native sources.")
    const result =
      shapes.length === 1 ? first : own(booleanResult(occt, [first], shapes.slice(1), "fuse"))
    materialMetrics(occt, result)
    return result
  }
  try {
    const leftShape = occurrence(left)
    const rightShape = occurrence(right)
    const metrics = materialMetrics(
      occt,
      own(booleanResult(occt, [leftShape], [rightShape], "common")),
    )
    return measureDistance
      ? { ...metrics, distance: nearestDistance(occt, leftShape, rightShape) }
      : metrics
  } finally {
    for (const shape of owned.reverse()) shape.delete()
  }
}
