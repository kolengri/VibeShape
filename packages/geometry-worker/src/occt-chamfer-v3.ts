import type { ChamferFeatureContentParametersV3 } from "@vibeshape/protocol"
import type { Edge, Face, Shape3D } from "replicad"
import type { BRepFilletAPI_MakeChamfer, OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape } from "./occt-cast"

export class ChamferV3Error extends Error {}
export type ResolvedChamferTarget =
  | { kind: "edge"; edgeKey: number; sideFaceKey?: number }
  | { kind: "face"; faceKey: number }
type ChamferGeometryParameters = Omit<
  ChamferFeatureContentParametersV3,
  "targets" | "directionOverrides"
>
type Seed = { edge: Edge; side?: Face }

function uniqueShapes<T extends Edge | Face>(shapes: readonly T[]): Map<number, T> {
  const byKey = new Map(shapes.map((shape) => [shape.hashCode, shape]))
  if (byKey.size !== shapes.length)
    throw new ChamferV3Error("Chamfer encountered ambiguous native topology hashes.")
  return byKey
}

function addSeedSelection(
  seeds: Map<number, Seed>,
  edge: Edge | undefined,
  side: Face | undefined,
) {
  if (!edge) throw new ChamferV3Error("Chamfer target edge is missing from the exact source.")
  const existing = seeds.get(edge.hashCode)
  if (existing && existing.side?.hashCode !== side?.hashCode)
    throw new ChamferV3Error("Chamfer overlapping targets have conflicting face-side intent.")
  seeds.set(edge.hashCode, { edge, ...(side ? { side } : {}) })
}

function requiredFace(faces: Map<number, Face>, key: number) {
  const face = faces.get(key)
  if (!face) throw new ChamferV3Error("Chamfer target or side face is missing.")
  return face
}

function addFaceSeeds(
  seeds: Map<number, Seed>,
  face: Face,
  edges: Map<number, Edge>,
  directional: boolean,
) {
  const side = directional ? face : undefined
  const boundary = face.edges
  try {
    for (const edge of boundary) addSeedSelection(seeds, edges.get(edge.hashCode), side)
  } finally {
    for (const edge of boundary) edge.delete()
  }
}

function acquireSeeds(
  targets: readonly ResolvedChamferTarget[],
  edges: Map<number, Edge>,
  faces: Map<number, Face>,
  directional: boolean,
) {
  const seeds = new Map<number, Seed>()
  for (const target of targets) {
    if (target.kind === "edge") {
      const face =
        target.sideFaceKey === undefined ? undefined : requiredFace(faces, target.sideFaceKey)
      addSeedSelection(seeds, edges.get(target.edgeKey), directional ? face : undefined)
    } else addFaceSeeds(seeds, requiredFace(faces, target.faceKey), edges, directional)
  }
  if (!seeds.size || seeds.size > 256)
    throw new ChamferV3Error("Chamfer requires 1 to 256 distinct boundary edges.")
  return seeds
}

function edgeSupports(edges: Map<number, Edge>, faces: readonly Face[]) {
  const supports = new Map<number, Face[]>()
  for (const face of faces) {
    const boundary = face.edges
    try {
      for (const key of new Set(boundary.map((edge) => edge.hashCode))) {
        if (!edges.has(key)) throw new ChamferV3Error("Chamfer face boundary is unavailable.")
        const adjacent = supports.get(key) ?? []
        adjacent.push(face)
        supports.set(key, adjacent)
      }
    } finally {
      for (const edge of boundary) edge.delete()
    }
  }
  return supports
}

function isCircularOffsetRim(
  edge: Edge,
  adjacent: readonly Face[],
  parameters: ChamferGeometryParameters,
) {
  // A closed circular intersection of an exact plane and cylinder is an orthogonal rim.
  return (
    parameters.mode === "equal-distance" &&
    parameters.measurement === "offset" &&
    edge.geomType === "CIRCLE" &&
    edge.isClosed &&
    adjacent.some((face) => face.geomType === "PLANE") &&
    adjacent.some((face) => face.geomType === "CYLINDRE")
  )
}

function measurementSupports(
  edge: Edge | undefined,
  supports: Map<number, Face[]>,
  parameters: ChamferGeometryParameters,
) {
  if (!edge) throw new ChamferV3Error("Chamfer contour edge is missing from the exact source.")
  const adjacent = supports.get(edge.hashCode) ?? []
  if (adjacent.length !== 2)
    throw new ChamferV3Error(
      "Chamfer requires two distinct adjacent faces; seam, degenerate, or non-manifold edges are unsupported.",
    )
  const planar = adjacent.every((face) => face.geomType === "PLANE")
  if (!planar && !isCircularOffsetRim(edge, adjacent, parameters))
    throw new ChamferV3Error(
      "Chamfer V3 measurement on non-planar adjacent faces is unsupported except equal-distance Offset on closed circular plane/cylinder rims.",
    )
  return adjacent
}

function effectiveSide(seed: Seed, adjacent: Face[], flip: boolean) {
  if (seed.side && !adjacent.includes(seed.side))
    throw new ChamferV3Error("Chamfer side face is not adjacent to its selected edge.")
  if (!seed.side) return undefined
  return flip ? adjacent.find((face) => face !== seed.side) : seed.side
}

function samePlanarSide(left: Face, right: Face) {
  const a = left.normalAt(),
    b = right.normalAt()
  try {
    return a.toTuple().every((value, axis) => Math.abs(value - (b.toTuple()[axis] ?? 0)) < 1e-7)
  } finally {
    a.delete()
    b.delete()
  }
}

function addSeed(
  builder: BRepFilletAPI_MakeChamfer,
  parameters: ChamferGeometryParameters,
  seed: Seed,
  side: Face | undefined,
) {
  if (parameters.mode === "equal-distance") builder.Add_2(parameters.distance, seed.edge.wrapped)
  else if (!side)
    throw new ChamferV3Error("Directional Chamfer requires an explicit adjacent face.")
  else if (parameters.mode === "two-distances")
    builder.Add_3(
      parameters.distance,
      parameters.secondDistance ?? 0,
      seed.edge.wrapped,
      side.wrapped,
    )
  else builder.AddDA(parameters.distance, parameters.angle ?? 0, seed.edge.wrapped, side.wrapped)
}

type ContourContext = {
  edges: Map<number, Edge>
  seeds: Map<number, Seed>
  supports: Map<number, Face[]>
  overrides: Set<number>
  parameters: ChamferGeometryParameters
  referenceSide: Face | undefined
  referenceFlip: boolean
  propagated: Set<number>
}

function validateContourDirection(key: number, adjacent: Face[], context: ContourContext) {
  const { seeds, overrides, parameters, referenceSide } = context
  const seed = seeds.get(key)
  const flip = parameters.flip !== overrides.has(key)
  const side = seed ? effectiveSide(seed, adjacent, flip) : undefined
  if (referenceSide && side && !samePlanarSide(referenceSide, side))
    throw new ChamferV3Error(
      "Chamfer direction overrides conflict within one native tangent contour.",
    )
  if (referenceSide && !seed && flip !== context.referenceFlip)
    throw new ChamferV3Error(
      "An individual propagated-edge direction override cannot split a native tangent contour.",
    )
}

function validateContour(
  builder: BRepFilletAPI_MakeChamfer,
  contour: number,
  context: ContourContext,
) {
  for (let index = 1; index <= builder.NbEdges(contour); index++) {
    const edge = builder.Edge(contour, index)
    try {
      const key = edge.HashCode(2_147_483_647)
      const adjacent = measurementSupports(
        context.edges.get(key),
        context.supports,
        context.parameters,
      )
      context.propagated.add(key)
      if (!context.parameters.tangentPropagation && !context.seeds.has(key))
        throw new ChamferV3Error(
          "Chamfer without tangent propagation cannot stop within this native tangent contour. Select the complete contour or enable propagation.",
        )
      validateContourDirection(key, adjacent, context)
    } finally {
      edge.delete()
    }
  }
}

/** Native topology keys are evaluation-local; only semantic references enter persisted intent. */
export function chamferOcctShapeV3(
  occt: OpenCascadeInstance,
  source: Shape3D,
  parameters: ChamferGeometryParameters,
  targets: readonly ResolvedChamferTarget[],
  overrideKeys: readonly number[],
): Shape3D {
  const clone = source.clone()
  try {
    const edges = clone.edges
    try {
      const faces = clone.faces
      try {
        const byEdge = uniqueShapes(edges),
          byFace = uniqueShapes(faces)
        const seeds = acquireSeeds(targets, byEdge, byFace, parameters.mode !== "equal-distance")
        const supports = edgeSupports(byEdge, faces)
        const overrides = new Set(overrideKeys)
        if (overrides.size !== overrideKeys.length)
          throw new ChamferV3Error("Chamfer overrides resolve to duplicate edges.")
        const builder = new occt.BRepFilletAPI_MakeChamfer(clone.wrapped)
        try {
          const propagated = new Set<number>()
          for (const [key, seed] of seeds) {
            const adjacent = measurementSupports(seed.edge, supports, parameters)
            const side = effectiveSide(seed, adjacent, parameters.flip !== overrides.has(key))
            if (builder.Contour(seed.edge.wrapped) > 0) continue
            addSeed(builder, parameters, seed, side)
            const contour = builder.Contour(seed.edge.wrapped)
            if (!contour)
              throw new ChamferV3Error(
                "OCCT rejected the selected Chamfer edge before construction.",
              )
            validateContour(builder, contour, {
              edges: byEdge,
              seeds,
              supports,
              overrides,
              parameters,
              referenceSide: side,
              referenceFlip: parameters.flip !== overrides.has(key),
              propagated,
            })
          }
          if ([...overrides].some((key) => !propagated.has(key)))
            throw new ChamferV3Error(
              "Chamfer direction override is outside the selected or propagated edges.",
            )
          const progress = new occt.Message_ProgressRange_1()
          try {
            builder.Build(progress)
            if (!builder.IsDone())
              throw new ChamferV3Error(
                "OCCT could not build the requested Chamfer; check dimensions and intersections.",
              )
            return adoptOcctShape(builder.Shape(), castOcctShape)
          } finally {
            progress.delete()
          }
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
    if (error instanceof ChamferV3Error) throw error
    throw new ChamferV3Error(
      "OCCT Chamfer construction failed; check dimensions and intersections.",
    )
  } finally {
    clone.delete()
  }
}
