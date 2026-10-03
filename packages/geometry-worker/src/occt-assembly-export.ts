import type { OpenCascadeInstance, TopoDS_Shape } from "replicad-opencascadejs"
import { type AssemblyPoseSource, copyOcctAssemblySource } from "./occt-assembly-pose"
import { exportOcctStep } from "./occt-exchange"

/** Preserves every placed body as an independent STEP solid, including disconnected or overlapping sources. */
export function exportOcctAssemblyStep(
  occt: OpenCascadeInstance,
  sources: readonly AssemblyPoseSource[],
): Uint8Array {
  if (!sources.length || sources.length > 4096)
    throw new Error("Assembly STEP export requires between one and 4096 exact sources.")
  const owned: TopoDS_Shape[] = []
  const own = <T extends TopoDS_Shape>(shape: T): T => {
    owned.push(shape)
    return shape
  }
  try {
    const copies = sources.map((source) => own(copyOcctAssemblySource(occt, source)))
    const first = copies[0]
    if (!first) throw new Error("No exact assembly source was placed.")
    let shape: TopoDS_Shape = first
    if (copies.length > 1) {
      const compound = own(new occt.TopoDS_Compound())
      const builder = new occt.TopoDS_Builder()
      try {
        builder.MakeCompound(compound)
        for (const copy of copies) builder.Add(compound, copy)
      } finally {
        builder.delete()
      }
      shape = compound
    }
    const file = exportOcctStep(occt, shape)
    if (!file.byteLength || file.byteLength > 64 * 1024 * 1024)
      throw new Error("The assembly STEP file exceeds its export byte budget.")
    return file
  } finally {
    for (const shape of owned.reverse()) shape.delete()
  }
}
