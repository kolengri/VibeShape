import type { Edge, Shape3D } from "replicad"
import type { ChFi3d_FilletShape, OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape } from "./occt-cast"

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
        builder.Build(progress)
        if (!builder.IsDone()) throw new Error("OCCT could not build the requested edge treatment.")
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
