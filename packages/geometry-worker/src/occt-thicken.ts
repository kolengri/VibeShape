import { THICKEN_MAX_THICKNESS, THICKEN_MIN_THICKNESS } from "@vibeshape/protocol"
import type { Face, Shape3D } from "replicad"
import type {
  BRepOffset_Mode,
  GeomAbs_JoinType,
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
  TopoDS_Shape,
} from "replicad-opencascadejs"
import { featureResultMetricsAreValid } from "./feature-result-validation"
import { inspectOcctBody } from "./occt-body-validation"
import { castOcctShape } from "./occt-cast"

/** A user-actionable Thicken or face-offset failure; the message is safe to show verbatim. */
export class ThickenError extends Error {}

export type ThickenSide = "outward" | "inward" | "symmetric"
export type ThickenOperation = "new" | "add" | "remove"
export type ThickenGeometryParameters = Readonly<{
  /** Total thickness in millimetres; symmetric mode splits it evenly across both sides. */
  thickness: number
  side: ThickenSide
  operation: ThickenOperation
}>

type OwnedBinding = { delete(): unknown }
type Own = <T extends OwnedBinding>(binding: T) => T

/** Simple offsets may only grow tolerances this far before the slab is treated as gapped. */
const SIMPLE_OFFSET_TOLERANCE_LIMIT = 2e-3
const CURVATURE_SAMPLES = 9

function ownership() {
  const owned: OwnedBinding[] = []
  const own: Own = (binding) => {
    owned.push(binding)
    return binding
  }
  const release = () => {
    for (const binding of owned.reverse()) binding.delete()
  }
  return { own, release }
}

function formatMillimetres(value: number) {
  return `${Number(value.toPrecision(6))} mm`
}

/** Signed offsets along the outward face normals for one Thicken side mode. */
function signedOffsets(thickness: number, side: ThickenSide): readonly number[] {
  if (side === "outward") return [thickness]
  if (side === "inward") return [-thickness]
  return [thickness / 2, -thickness / 2]
}

function requireSourceSolid(occt: OpenCascadeInstance, source: Shape3D, label: string) {
  const metrics = inspectOcctBody(occt, source)
  if (!featureResultMetricsAreValid(metrics, 1) || !Number.isFinite(metrics.volume))
    throw new ThickenError(`${label} requires one valid exact solid body.`)
  return metrics.volume
}

type SurfaceDerivatives = Readonly<
  Record<"u" | "v" | "uu" | "vv" | "uv", InstanceType<OpenCascadeInstance["gp_Vec_1"]>>
>

/**
 * Principal curvatures relative to the outward face normal. A negative curvature is convex: an
 * offset `s` along the outward normal collapses where `s * curvature` reaches 1.
 */
function principalCurvatures(
  derivatives: SurfaceDerivatives,
  reversed: boolean,
): readonly [number, number] | null {
  const { u, v, uu, vv, uv } = derivatives
  const normal = u.Crossed(v)
  try {
    const length = normal.Magnitude() * (reversed ? -1 : 1)
    const e = u.Dot(u),
      f = u.Dot(v),
      g = v.Dot(v)
    const determinant = e * g - f * f
    if (!(Math.abs(length) > 1e-12) || !(determinant > 1e-12 * e * g)) return null
    const l = uu.Dot(normal) / length,
      m = uv.Dot(normal) / length,
      n = vv.Dot(normal) / length
    const mean = (e * n - 2 * f * m + g * l) / (2 * determinant)
    const gaussian = (l * n - m * m) / determinant
    const spread = Math.sqrt(Math.max(mean * mean - gaussian, 0))
    return [mean + spread, mean - spread]
  } finally {
    normal.delete()
  }
}

/**
 * The smallest curvature radius that an offset of `offset` millimetres would collapse, sampled
 * over the face parameter range. Planar faces and the convex side of a curved face return Infinity.
 */
function collapsingCurvatureRadius(occt: OpenCascadeInstance, face: Face, offset: number) {
  const { own, release } = ownership()
  try {
    const adaptor = own(new occt.BRepAdaptor_Surface_2(face.wrapped, true))
    if (adaptor.GetType() === occt.GeomAbs_SurfaceType.GeomAbs_Plane) return Infinity
    const [u0, u1, v0, v1] = [
      adaptor.FirstUParameter(),
      adaptor.LastUParameter(),
      adaptor.FirstVParameter(),
      adaptor.LastVParameter(),
    ]
    if (![u0, u1, v0, v1].every(Number.isFinite)) return Infinity
    const reversed = face.wrapped.Orientation_1() === occt.TopAbs_Orientation.TopAbs_REVERSED
    const point = own(new occt.gp_Pnt_1())
    const vector = () => own(new occt.gp_Vec_1())
    const derivatives = { u: vector(), v: vector(), uu: vector(), vv: vector(), uv: vector() }
    const step = 1 / (CURVATURE_SAMPLES - 1)
    let radius = Infinity
    for (let index = 0; index < CURVATURE_SAMPLES ** 2; index += 1) {
      const s = Math.floor(index / CURVATURE_SAMPLES) * step,
        t = (index % CURVATURE_SAMPLES) * step
      const { u, v, uu, vv, uv } = derivatives
      adaptor.D2(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t, point, u, v, uu, vv, uv)
      for (const curvature of principalCurvatures(derivatives, reversed) ?? [])
        if (curvature * offset > 0) radius = Math.min(radius, 1 / Math.abs(curvature))
    }
    return radius
  } finally {
    release()
  }
}

/** Rejects offsets that would collapse a selected face's concave side before OCCT runs. */
function requireCurvatureClearance(
  occt: OpenCascadeInstance,
  faces: readonly Face[],
  offsets: readonly number[],
  label: string,
) {
  faces.forEach((face, index) => {
    for (const offset of offsets) {
      const radius = collapsingCurvatureRadius(occt, face, offset)
      if (Math.abs(offset) < radius * (1 - 1e-9)) continue
      const side = offset > 0 ? "outward" : "inward"
      throw new ThickenError(
        `${label} offset ${formatMillimetres(Math.abs(offset))} ${side} reaches the ` +
          `${formatMillimetres(radius)} curvature radius of selected face ${index + 1} on its ` +
          `concave side. Use an offset below ${formatMillimetres(radius)} or offset toward the ` +
          "other side.",
      )
    }
  })
}

function selectFaces(faces: readonly Face[], faceKeys: readonly number[]) {
  const byKey = new Map(faces.map((face) => [face.hashCode, face]))
  if (byKey.size !== faces.length)
    throw new ThickenError("Thicken encountered ambiguous native face topology.")
  if (new Set(faceKeys).size !== faceKeys.length)
    throw new ThickenError("Thicken faces must be distinct.")
  return faceKeys.map((key, index) => {
    const face = byKey.get(key)
    if (!face) throw new ThickenError(`Thicken face ${index + 1} is missing from the exact body.`)
    return face
  })
}

/** Selected faces must form one edge-connected patch; returns nothing or throws. */
function requireConnectedFaces(faces: readonly Face[]) {
  const edgeSets = faces.map((face) => {
    const edges = face.edges
    try {
      return new Set(edges.map((edge) => edge.hashCode))
    } finally {
      for (const edge of edges) edge.delete()
    }
  })
  const reached = new Set([0])
  const queue = [0]
  while (queue.length > 0) {
    const current = edgeSets[queue.shift() ?? 0] ?? new Set<number>()
    edgeSets.forEach((edges, index) => {
      if (reached.has(index) || ![...edges].some((edge) => current.has(edge))) return
      reached.add(index)
      queue.push(index)
    })
  }
  const detached = faces.findIndex((_face, index) => !reached.has(index))
  if (detached >= 0)
    throw new ThickenError(
      `Selected face ${detached + 1} does not share an edge with selected face 1. Thicken ` +
        "needs one connected patch of faces; create a separate Thicken for each patch.",
    )
}

/** Deep-copies the body so native offset and Boolean builders never share source topology. */
function copySourceWithFaces(
  occt: OpenCascadeInstance,
  source: Shape3D,
  faces: readonly Face[],
  own: Own,
) {
  const transform = own(new occt.gp_Trsf_1())
  const copier = own(new occt.BRepBuilderAPI_Transform_2(source.wrapped, transform, true))
  if (!copier.IsDone()) throw new ThickenError("The source body copy did not complete.")
  const copied = own(copier.Shape())
  const copiedFaces = faces.map((face) => {
    const mapped = own(copier.ModifiedShape(face.wrapped))
    if (mapped.IsNull()) throw new ThickenError("A selected face is unavailable on the body copy.")
    // The copy map returns the face TShape as FORWARD; restore the body orientation so offsets
    // follow the outward normal (hole walls, for example, are REVERSED in their solid).
    return own(mapped.Oriented(face.wrapped.Orientation_1()))
  })
  return { copied, copiedFaces }
}

function solidVolume(occt: OpenCascadeInstance, shape: TopoDS_Shape) {
  const properties = new occt.GProp_GProps_1()
  try {
    occt.BRepGProp.VolumeProperties_1(shape, properties, false, false, false)
    return properties.Mass()
  } finally {
    properties.delete()
  }
}

function maximumEdgeTolerance(occt: OpenCascadeInstance, shape: TopoDS_Shape) {
  const explorer = new occt.TopExp_Explorer_2(
    shape,
    occt.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum,
    occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
  )
  try {
    let tolerance = 0
    for (; explorer.More(); explorer.Next()) {
      const edge = occt.TopoDS.Edge_1(explorer.Current())
      try {
        tolerance = Math.max(tolerance, occt.BRep_Tool.Tolerance_2(edge))
      } finally {
        edge.delete()
      }
    }
    return tolerance
  } finally {
    explorer.delete()
  }
}

/** The single solid of an offset result, outward-oriented, or null when it is not one solid. */
function singleOrientedSolid(occt: OpenCascadeInstance, shape: TopoDS_Shape, own: Own) {
  const explorer = own(
    new occt.TopExp_Explorer_2(
      shape,
      occt.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum,
      occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
    ),
  )
  if (!explorer.More()) return null
  const solid = own(occt.TopoDS.Solid_1(explorer.Current()))
  explorer.Next()
  if (explorer.More()) return null
  occt.BRepLib.OrientClosedSolid(solid)
  return solid
}

function acceptedSlab(
  occt: OpenCascadeInstance,
  shape: TopoDS_Shape,
  toleranceLimit: number,
  own: Own,
) {
  const solid = singleOrientedSolid(occt, shape, own)
  if (!solid) return null
  const analyzer = own(new occt.BRepCheck_Analyzer(solid, true, false))
  const volume = solidVolume(occt, solid)
  return analyzer.IsValid_2() &&
    Number.isFinite(volume) &&
    volume > 0 &&
    maximumEdgeTolerance(occt, solid) <= toleranceLimit
    ? solid
    : null
}

/** Offsets the selected faces with walls along their boundary normals (no intersections). */
function simpleSlab(
  occt: OpenCascadeInstance,
  faces: readonly TopoDS_Shape[],
  offset: number,
  own: Own,
) {
  let input: TopoDS_Shape | undefined = faces[0]
  if (faces.length > 1) {
    const builder = own(new occt.TopoDS_Builder())
    const shell = own(new occt.TopoDS_Shell())
    builder.MakeShell(shell)
    for (const face of faces) builder.Add(shell, face)
    input = shell
  }
  if (!input) return null
  const maker = own(new occt.BRepOffsetAPI_MakeThickSolid())
  maker.MakeThickSolidBySimple(input, offset)
  const progress = own(new occt.Message_ProgressRange_1())
  maker.Build(progress)
  if (!maker.IsDone()) return null
  const tolerance = Math.max(SIMPLE_OFFSET_TOLERANCE_LIMIT, Math.abs(offset) * 1e-4)
  return acceptedSlab(occt, own(maker.Shape()), tolerance, own)
}

/** Offsets the selected faces of the body; the other faces close the slab like Shell openings. */
function joinedSlab(
  occt: OpenCascadeInstance,
  copied: TopoDS_Shape,
  selected: readonly TopoDS_Shape[],
  offset: number,
  own: Own,
) {
  const closing = own(new occt.TopTools_ListOfShape_1())
  const explorer = own(
    new occt.TopExp_Explorer_2(
      copied,
      occt.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum,
      occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
    ),
  )
  for (; explorer.More(); explorer.Next()) {
    const face = own(explorer.Current())
    if (!selected.some((candidate) => candidate.IsSame(face))) closing.Append_1(face)
  }
  const progress = own(new occt.Message_ProgressRange_1())
  const maker = own(new occt.BRepOffsetAPI_MakeThickSolid())
  try {
    maker.MakeThickSolidByJoin(
      copied,
      closing,
      offset,
      1e-7,
      occt.BRepOffset_Mode.BRepOffset_Skin as BRepOffset_Mode,
      false,
      false,
      occt.GeomAbs_JoinType.GeomAbs_Intersection as GeomAbs_JoinType,
      false,
      progress,
    )
  } catch {
    return null
  }
  if (!maker.IsDone()) return null
  return acceptedSlab(occt, own(maker.Shape()), 1e-3 + Math.abs(offset) * 1e-4, own)
}

type SlabBuilder = (offset: number) => TopoDS_Shape | null

/**
 * Offset strategies in preference order. Each slab starts from its own deep copy: a slab that
 * shares the selected face with the body (or with the other half of a symmetric slab) breaks the
 * Boolean that combines them.
 */
function slabBuilders(
  occt: OpenCascadeInstance,
  source: Shape3D,
  selected: readonly Face[],
  own: Own,
): readonly SlabBuilder[] {
  return [
    (offset) =>
      simpleSlab(occt, copySourceWithFaces(occt, source, selected, own).copiedFaces, offset, own),
    (offset) => {
      const { copied, copiedFaces } = copySourceWithFaces(occt, source, selected, own)
      return joinedSlab(occt, copied, copiedFaces, offset, own)
    },
  ]
}

function combineShapes(
  occt: OpenCascadeInstance,
  kind: "fuse" | "cut",
  left: TopoDS_Shape,
  right: TopoDS_Shape,
  own: Own,
) {
  const progress = own(new occt.Message_ProgressRange_1())
  const Builder = kind === "fuse" ? occt.BRepAlgoAPI_Fuse_3 : occt.BRepAlgoAPI_Cut_3
  const builder = own(new Builder(left, right, progress))
  builder.Build(progress)
  if (!builder.IsDone()) return null
  builder.SimplifyResult(true, true, 1e-7)
  return own(builder.Shape())
}

function unifiedFaceCount(occt: OpenCascadeInstance, shape: TopoDS_Shape) {
  const { own, release } = ownership()
  try {
    const unify = own(new occt.ShapeUpgrade_UnifySameDomain_2(shape, true, true, false))
    unify.Build()
    const explorer = own(
      new occt.TopExp_Explorer_2(
        own(unify.Shape()),
        occt.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum,
        occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
      ),
    )
    let count = 0
    for (; explorer.More(); explorer.Next()) count += 1
    return count
  } finally {
    release()
  }
}

/** Casts a native result into an owned replicad shape and verifies one valid exact solid. */
function verifiedResult(
  occt: OpenCascadeInstance,
  shape: TopoDS_Shape,
  accept: (volume: number) => string | null,
) {
  const result = castOcctShape(shape)
  try {
    const metrics = inspectOcctBody(occt, result)
    if (!featureResultMetricsAreValid(metrics, 1) || !Number.isFinite(metrics.volume))
      throw new ThickenError(
        "The result is not one valid solid. Reduce the thickness or select fewer faces.",
      )
    const rejection = accept(metrics.volume)
    if (rejection) throw new ThickenError(rejection)
    return result
  } catch (error) {
    result.delete()
    throw error
  }
}

function requireThickenParameters(parameters: ThickenGeometryParameters, faceCount: number) {
  if (
    !(
      parameters.thickness >= THICKEN_MIN_THICKNESS && parameters.thickness <= THICKEN_MAX_THICKNESS
    )
  )
    throw new ThickenError("Thicken thickness must be between 0.001 and 10000 mm.")
  if (faceCount < 1 || faceCount > 256) throw new ThickenError("Thicken requires 1 to 256 faces.")
}

function operationRejection(operation: ThickenOperation, sourceVolume: number, volume: number) {
  const change = volume - sourceVolume
  const minimum = Math.max(1e-9, Math.abs(sourceVolume) * 1e-9)
  if (operation === "add" && !(change > minimum))
    return "Thicken Add did not enlarge the body because the thickened region lies inside it. Use Remove or New, or thicken outward."
  if (operation === "remove" && !(change < -minimum))
    return "Thicken Remove did not cut the body because the thickened region lies outside it. Use Add or New, or thicken inward."
  return null
}

/**
 * Thickens one connected patch of faces of an exact solid into a new solid, then optionally adds
 * it to or removes it from the source. Every selected face must be thickened; nothing is skipped.
 */
export function thickenOcctShape(
  occt: OpenCascadeInstance,
  source: Shape3D,
  faceKeys: readonly number[],
  parameters: ThickenGeometryParameters,
): Shape3D {
  requireThickenParameters(parameters, faceKeys.length)
  const sourceVolume = requireSourceSolid(occt, source, "Thicken")
  const { own, release } = ownership()
  const faces = source.faces
  try {
    const selected = selectFaces(faces, faceKeys)
    requireConnectedFaces(selected)
    const offsets = signedOffsets(parameters.thickness, parameters.side)
    requireCurvatureClearance(occt, selected, offsets, "Thicken")
    const { copied } = copySourceWithFaces(occt, source, selected, own)
    const builders = slabBuilders(occt, source, selected, own)
    const slabs = offsets.map((offset) => {
      for (const build of builders) {
        const slab = build(offset)
        if (slab) return slab
      }
      throw new ThickenError(
        `OCCT could not offset the selected faces by ${formatMillimetres(Math.abs(offset))}. ` +
          "Reduce the thickness, or thicken faces that meet at sharp edges separately.",
      )
    })
    const [first, second] = slabs
    const thick = first && second ? combineShapes(occt, "fuse", first, second, own) : first
    const combined =
      !thick || parameters.operation === "new"
        ? thick
        : combineShapes(occt, parameters.operation === "add" ? "fuse" : "cut", copied, thick, own)
    if (!combined)
      throw new ThickenError("Thicken could not combine the thickened faces with the body.")
    return verifiedResult(occt, combined, (volume) =>
      parameters.operation === "new"
        ? null
        : operationRejection(parameters.operation, sourceVolume, volume),
    )
  } finally {
    for (const face of faces) face.delete()
    release()
  }
}

/**
 * Moves one curved face along its normals by a signed distance: the swept region between the face
 * and its offset is added or removed. The result is accepted only when every neighbouring face
 * stays attached, i.e. the unified face count is unchanged; otherwise the offset fails closed.
 */
export function offsetOcctFace(
  occt: OpenCascadeInstance,
  source: Shape3D,
  face: Face,
  distance: number,
): Shape3D {
  if (!Number.isFinite(distance) || Math.abs(distance) < 0.001 || Math.abs(distance) > 100_000)
    throw new ThickenError("Press Pull distance must have a magnitude between 0.001 and 100000 mm.")
  const sourceVolume = requireSourceSolid(occt, source, "Press Pull")
  requireCurvatureClearance(occt, [face], [distance], "Press Pull")
  const { own, release } = ownership()
  try {
    const { copied } = copySourceWithFaces(occt, source, [face], own)
    const expectedFaces = unifiedFaceCount(occt, copied)
    for (const build of slabBuilders(occt, source, [face], own)) {
      const slab = build(distance)
      const combined = slab && combineShapes(occt, distance > 0 ? "fuse" : "cut", copied, slab, own)
      if (!combined || unifiedFaceCount(occt, combined) !== expectedFaces) continue
      const result = castOcctShape(combined)
      const metrics = inspectOcctBody(occt, result)
      const change = (metrics.volume - sourceVolume) * Math.sign(distance)
      if (featureResultMetricsAreValid(metrics, 1) && change > Math.max(1e-9, sourceVolume * 1e-12))
        return result
      result.delete()
    }
    throw new ThickenError(
      `Press Pull cannot move the curved face ${formatMillimetres(Math.abs(distance))} ` +
        `${distance > 0 ? "outward" : "inward"} while keeping its neighbouring faces attached. ` +
        "Neighbouring faces must meet it at right angles or extend along their own surfaces; " +
        "reduce the distance or use Thicken instead.",
    )
  } finally {
    release()
  }
}
