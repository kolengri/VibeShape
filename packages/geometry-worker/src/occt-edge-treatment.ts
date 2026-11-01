import { filletFeatureContentParametersSchema } from "@vibeshape/protocol"
import type { Edge, Shape3D } from "replicad"
import type { ChFi3d_FilletShape, OpenCascadeInstance } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"

export class FilletBuildError extends Error {
  constructor(
    message: string,
    readonly suggestedRadius?: number,
  ) {
    super(message)
  }
}

class FilletKernelFailure extends Error {
  constructor(readonly noContours = false) {
    super("OCCT could not complete the requested fillet.")
  }
}

export function treatAllOcctEdges(
  opencascade: OpenCascadeInstance,
  source: Shape3D,
  operation: "fillet" | "chamfer",
  size: number,
): Shape3D {
  return treatOcctEdges(opencascade, source, operation, size)
}

function treatOcctEdges(
  opencascade: OpenCascadeInstance,
  source: Shape3D,
  operation: "fillet" | "chamfer",
  size: number,
  selectedEdgeKeys?: readonly number[],
): Shape3D {
  if (operation === "chamfer")
    return buildOcctEdgeTreatment(opencascade, source, operation, size, selectedEdgeKeys)
  const build = (radius: number) => {
    const result = buildOcctEdgeTreatment(opencascade, source, operation, radius, selectedEdgeKeys)
    try {
      const metrics = inspectOcctBody(opencascade, result)
      if (
        !metrics.valid ||
        metrics.solidCount !== 1 ||
        !Number.isFinite(metrics.volume) ||
        metrics.volume <= 0
      )
        throw new FilletKernelFailure()
      return result
    } catch (error) {
      result.delete()
      throw error
    }
  }
  try {
    return build(size)
  } catch (error) {
    if (!(error instanceof FilletKernelFailure)) throw error
    return diagnoseFilletFailure(error, size, build)
  }
}

function diagnoseFilletFailure(
  error: FilletKernelFailure,
  size: number,
  build: (radius: number) => Shape3D,
): never {
  if (error.noContours)
    throw new FilletBuildError(
      "Fillet has no eligible sharp edge contours. Select sharp edges between adjacent faces; seam, smooth, or degenerate edges may not support a fillet.",
    )
  const radius = findWorkingFilletRadius(size, build)
  if (radius !== undefined)
    throw new FilletBuildError(
      `Fillet could not be built at radius ${size} mm: the edge contours or their intersections could not be completed. Radius ${radius} mm built a valid single solid for the same edge scope. Try that radius explicitly, or select fewer edges. This tested radius is not a maximum.`,
      radius,
    )
  throw new FilletBuildError(
    `Fillet could not be built at radius ${size} mm: the edge contours or their intersections could not be completed. Bounded smaller-radius checks found no valid single solid. Inspect adjacent faces, choose fewer sharp edges, or try another radius.`,
  )
}

function findWorkingFilletRadius(size: number, build: (radius: number) => Shape3D) {
  // Disposable diagnostics never substitute geometry for the requested radius.
  // The worker's existing termination path can still interrupt a native build.
  for (const factor of [0.5, 0.25, 0.125, 0.0625]) {
    const radius = size * factor
    if (!filletFeatureContentParametersSchema.safeParse({ radius }).success) break
    let probe: Shape3D
    try {
      probe = build(radius)
    } catch (error) {
      if (!(error instanceof FilletKernelFailure)) break
      continue
    }
    probe.delete()
    return radius
  }
  return undefined
}

function buildOcctEdgeTreatment(
  opencascade: OpenCascadeInstance,
  source: Shape3D,
  operation: "fillet" | "chamfer",
  size: number,
  selectedEdgeKeys?: readonly number[],
): Shape3D {
  // OCCT builders and topology wrappers must not depend on JavaScript finalization.
  const target = source.clone()
  try {
    const builder = createBuilder(opencascade, target, operation)
    try {
      const edges = target.edges
      try {
        for (const edge of acquiredTreatmentEdges(edges, selectedEdgeKeys)) {
          builder.Add_2(size, edge.wrapped)
        }
      } finally {
        for (const edge of edges) edge.delete()
      }
      const progress = new opencascade.Message_ProgressRange_1()
      try {
        try {
          if (operation === "fillet" && builder.NbContours() === 0)
            throw new FilletKernelFailure(true)
          builder.Build(progress)
          if (!builder.IsDone())
            throw new Error("OCCT could not build the requested edge treatment.")
        } catch (error) {
          if (error instanceof FilletKernelFailure) throw error
          if (operation === "fillet") throw new FilletKernelFailure()
          throw error
        }
        return adoptOcctShape(builder.Shape(), castOcctShape)
      } finally {
        progress.delete()
      }
    } finally {
      builder.delete()
    }
  } finally {
    target.delete()
  }
}

function acquiredTreatmentEdges(
  edges: readonly Edge[],
  selectedEdgeKeys?: readonly number[],
): readonly Edge[] {
  if (edges.length === 0) throw new Error("Edge treatment requires at least one edge.")
  if (!selectedEdgeKeys) return edges
  const selected = new Set(selectedEdgeKeys)
  if (selected.size !== selectedEdgeKeys.length || selected.size === 0) {
    throw new Error("Selected edge treatment requires distinct edge selections.")
  }
  const edgesByKey = new Map(edges.map((edge) => [edge.hashCode, edge]))
  if (edgesByKey.size !== edges.length) {
    throw new Error("Selected edge treatment encountered duplicate native edge hashes.")
  }
  return selectedEdgeKeys.map((key) => {
    const edge = edgesByKey.get(key)
    if (!edge) throw new Error("Selected edge treatment references an unavailable edge.")
    return edge
  })
}

/** Apply an edge treatment to the exact transient edge hashes selected on the source shape. */
export function treatSelectedOcctEdges(
  opencascade: OpenCascadeInstance,
  source: Shape3D,
  operation: "fillet" | "chamfer",
  size: number,
  selectedEdgeKeys: readonly number[],
): Shape3D {
  return treatOcctEdges(opencascade, source, operation, size, selectedEdgeKeys)
}

function createBuilder(
  opencascade: OpenCascadeInstance,
  target: Shape3D,
  operation: "fillet" | "chamfer",
) {
  return operation === "fillet"
    ? new opencascade.BRepFilletAPI_MakeFillet(
        target.wrapped,
        opencascade.ChFi3d_FilletShape.ChFi3d_Rational as ChFi3d_FilletShape,
      )
    : new opencascade.BRepFilletAPI_MakeChamfer(target.wrapped)
}
