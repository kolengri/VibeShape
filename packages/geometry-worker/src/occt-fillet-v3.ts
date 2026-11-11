import type { FilletFeatureContentParametersV3 } from "@vibeshape/protocol"
import type { Edge, Face, Shape3D } from "replicad"
import type {
  BRepFilletAPI_MakeFillet,
  ChFi3d_FilletShape,
  OpenCascadeInstance,
  TopoDS_Vertex,
} from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"

export class FilletV3Error extends Error {}
type VariableRadius = NonNullable<
  Extract<FilletFeatureContentParametersV3["targets"][number], { kind: "edge" }>["variableRadius"]
>
export type ResolvedFilletTarget =
  | { kind: "edge"; edgeKey: number; variableRadius?: VariableRadius }
  | { kind: "face"; faceKey: number }
type Seed = { edge: Edge; variableRadius?: VariableRadius; explicit: boolean }

/**
 * Coordinates closer than 1 µm compare equal. This is persisted meaning: it must stay above the
 * numeric noise of imported and Boolean geometry so a rebuild cannot flip the endpoint order.
 */
const FILLET_ENDPOINT_TOLERANCE_MM = 1e-3

function uniqueShapes<T extends Edge | Face>(shapes: readonly T[]): Map<number, T> {
  const byKey = new Map(shapes.map((shape) => [shape.hashCode, shape]))
  if (byKey.size !== shapes.length)
    throw new FilletV3Error("Fillet encountered ambiguous native topology hashes.")
  return byKey
}

function addSeed(seeds: Map<number, Seed>, seed: Seed) {
  const key = seed.edge.hashCode
  const existing = seeds.get(key)
  if (existing && (existing.variableRadius || seed.variableRadius))
    throw new FilletV3Error(
      "A variable-radius Fillet edge is also selected through another target. Remove the duplicate edge or face target.",
    )
  if (!existing || seed.explicit) seeds.set(key, seed)
}

function addEdgeTarget(
  seeds: Map<number, Seed>,
  target: Extract<ResolvedFilletTarget, { kind: "edge" }>,
  edges: Map<number, Edge>,
) {
  const edge = edges.get(target.edgeKey)
  if (!edge) throw new FilletV3Error("Fillet target edge is missing from the exact source.")
  addSeed(seeds, {
    edge,
    explicit: true,
    ...(target.variableRadius ? { variableRadius: target.variableRadius } : {}),
  })
}

/** A face target seeds each current boundary edge with the constant radius. */
function addFaceTarget(
  seeds: Map<number, Seed>,
  target: Extract<ResolvedFilletTarget, { kind: "face" }>,
  edges: Map<number, Edge>,
  faces: Map<number, Face>,
) {
  const face = faces.get(target.faceKey)
  if (!face) throw new FilletV3Error("Fillet target face is missing from the exact source.")
  const boundary = face.edges
  try {
    for (const value of boundary) {
      const edge = edges.get(value.hashCode)
      if (!edge) throw new FilletV3Error("Fillet face boundary is unavailable.")
      addSeed(seeds, { edge, explicit: false })
    }
  } finally {
    for (const edge of boundary) edge.delete()
  }
}

function acquireSeeds(
  targets: readonly ResolvedFilletTarget[],
  edges: Map<number, Edge>,
  faces: Map<number, Face>,
) {
  const seeds = new Map<number, Seed>()
  for (const target of targets) {
    if (target.kind === "edge") addEdgeTarget(seeds, target, edges)
    else addFaceTarget(seeds, target, edges, faces)
  }
  if (!seeds.size || seeds.size > 256)
    throw new FilletV3Error("Fillet requires 1 to 256 distinct boundary edges.")
  return seeds
}

function vertexPoint(occt: OpenCascadeInstance, vertex: TopoDS_Vertex) {
  try {
    const point = occt.BRep_Tool.Pnt(vertex)
    try {
      return [point.X(), point.Y(), point.Z()] as const
    } finally {
      point.delete()
    }
  } finally {
    vertex.delete()
  }
}

/** Negative when `left` is the canonical start: x, then y, then z, each within 1e-3 mm. */
export function compareFilletEndpoints(left: readonly number[], right: readonly number[]) {
  for (let axis = 0; axis < 3; axis++) {
    const delta = (left[axis] ?? 0) - (right[axis] ?? 0)
    if (Math.abs(delta) > FILLET_ENDPOINT_TOLERANCE_MM) return delta
  }
  return 0
}

/**
 * OCCT applies the first radius at the contour's first vertex. The persisted law instead names the
 * canonical start endpoint, so the native order is read back before the radii are assigned.
 */
function applyVariableRadius(
  occt: OpenCascadeInstance,
  builder: BRepFilletAPI_MakeFillet,
  contour: number,
  law: VariableRadius,
) {
  if (builder.NbEdges(contour) !== 1 || builder.Closed(contour))
    throw new FilletV3Error(
      "Variable-radius Fillet needs an open edge whose native tangent contour is that edge alone. Use a constant radius for tangent chains and closed edges.",
    )
  const first = vertexPoint(occt, builder.FirstVertex(contour))
  const last = vertexPoint(occt, builder.LastVertex(contour))
  const order = compareFilletEndpoints(first, last)
  if (order === 0)
    throw new FilletV3Error("Variable-radius Fillet edge endpoints are not distinct.")
  const firstIsStart = order < 0 !== law.reverse
  const [atFirst, atLast] = firstIsStart
    ? [law.startRadius, law.endRadius]
    : [law.endRadius, law.startRadius]
  builder.SetRadius_2(atFirst, atLast, contour, 1)
}

type ContourContext = Readonly<{
  occt: OpenCascadeInstance
  builder: BRepFilletAPI_MakeFillet
  radius: number
  variableContours: Set<number>
}>

/** Adds one seed's native contour unless an earlier seed's contour already covers it. */
function addSeedContour(seed: Seed, { occt, builder, radius, variableContours }: ContourContext) {
  const existing = builder.Contour(seed.edge.wrapped)
  if (existing > 0) {
    if (seed.variableRadius || variableContours.has(existing))
      throw new FilletV3Error(
        "A variable-radius Fillet edge shares a native tangent contour with another target. Use one constant radius for the whole contour.",
      )
    return
  }
  if (seed.variableRadius) builder.Add_1(seed.edge.wrapped)
  else builder.Add_2(radius, seed.edge.wrapped)
  const contour = builder.Contour(seed.edge.wrapped)
  // Face boundaries may include seam or smooth edges that have no fillet contour.
  if (!contour && !seed.explicit) return
  if (!contour)
    throw new FilletV3Error(
      "OCCT rejected the selected Fillet edge. Select a sharp edge between two faces; seam, smooth, or degenerate edges cannot be filleted.",
    )
  if (!seed.variableRadius) return
  applyVariableRadius(occt, builder, contour, seed.variableRadius)
  variableContours.add(contour)
}

function addContours(
  occt: OpenCascadeInstance,
  builder: BRepFilletAPI_MakeFillet,
  seeds: Map<number, Seed>,
  radius: number,
) {
  const context = { occt, builder, radius, variableContours: new Set<number>() }
  for (const seed of seeds.values()) addSeedContour(seed, context)
  if (builder.NbContours() === 0)
    throw new FilletV3Error(
      "Fillet has no eligible sharp edge contours. Select sharp edges between adjacent faces.",
    )
}

function buildFillet(occt: OpenCascadeInstance, builder: BRepFilletAPI_MakeFillet) {
  const progress = new occt.Message_ProgressRange_1()
  try {
    builder.Build(progress)
    if (!builder.IsDone())
      throw new FilletV3Error(
        "OCCT could not build the requested Fillet. Reduce the radius or select fewer edges.",
      )
  } finally {
    progress.delete()
  }
  const result = adoptOcctShape(builder.Shape(), castOcctShape)
  try {
    const metrics = inspectOcctBody(occt, result)
    if (!metrics.valid || metrics.solidCount !== 1 || !(metrics.volume > 0))
      throw new FilletV3Error(
        "Fillet did not produce one valid solid. Reduce the radius or select fewer edges.",
      )
    return result
  } catch (error) {
    result.delete()
    throw error
  }
}

/**
 * Every seed follows its native tangent contour. Native topology keys are evaluation-local; only
 * semantic references enter persisted intent.
 */
export function filletOcctShapeV3(
  occt: OpenCascadeInstance,
  source: Shape3D,
  radius: number,
  targets: readonly ResolvedFilletTarget[],
): Shape3D {
  const clone = source.clone()
  try {
    const edges = clone.edges
    try {
      const faces = clone.faces
      try {
        const seeds = acquireSeeds(targets, uniqueShapes(edges), uniqueShapes(faces))
        const builder = new occt.BRepFilletAPI_MakeFillet(
          clone.wrapped,
          occt.ChFi3d_FilletShape.ChFi3d_Rational as ChFi3d_FilletShape,
        )
        try {
          addContours(occt, builder, seeds, radius)
          return buildFillet(occt, builder)
        } finally {
          builder.delete()
        }
      } finally {
        for (const face of faces) face.delete()
      }
    } finally {
      for (const edge of edges) edge.delete()
    }
  } catch (error) {
    if (error instanceof FilletV3Error) throw error
    throw new FilletV3Error(
      "OCCT Fillet construction failed. Reduce the radius or select fewer edges.",
    )
  } finally {
    clone.delete()
  }
}
