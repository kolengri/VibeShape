import type { Face, Shape3D } from "replicad"
import type {
  BRepAlgoAPI_BuilderAlgo,
  BRepOffset_Mode,
  GeomAbs_JoinType,
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
  TopoDS_Shape,
} from "replicad-opencascadejs"
import { featureResultMetricsAreValid } from "./feature-result-validation"
import { inspectOcctBody } from "./occt-body-validation"

/** A user-actionable Thicken or face-offset failure; the message is safe to show verbatim. */
export class ThickenError extends Error {}

type OwnedBinding = { delete(): unknown }
export type Own = <T extends OwnedBinding>(binding: T) => T

/** Simple offsets may only grow tolerances this far before the slab is treated as gapped. */
const SIMPLE_OFFSET_TOLERANCE_LIMIT = 2e-3
const CURVATURE_SAMPLES = 9

/** Collects native bindings and releases them in reverse creation order. */
export function ownership() {
  const owned: OwnedBinding[] = []
  const own: Own = (binding) => {
    owned.push(binding)
    return binding
  }
  const release = () => {
    for (const binding of owned.reverse()) binding.delete()
    owned.length = 0
  }
  return { own, release }
}

export function formatMillimetres(value: number) {
  return `${Number(value.toPrecision(6))} mm`
}

export function requireSourceSolid(occt: OpenCascadeInstance, source: Shape3D, label: string) {
  const metrics = inspectOcctBody(occt, source)
  if (!featureResultMetricsAreValid(metrics, 1) || !Number.isFinite(metrics.volume))
    throw new ThickenError(`${label} requires one valid exact solid body.`)
  return metrics.volume
}

/**
 * Visits each sub-shape of one kind. Both the explorer's returned handle and the converted handle
 * are released after the visit, so long walks do not accumulate native wrappers.
 */
export function forEachSubShape<T extends OwnedBinding>(
  occt: OpenCascadeInstance,
  shape: TopoDS_Shape,
  kind: "TopAbs_EDGE" | "TopAbs_FACE" | "TopAbs_SOLID",
  convert: (current: TopoDS_Shape) => T,
  visit: (item: T) => void,
) {
  const explorer = new occt.TopExp_Explorer_2(
    shape,
    occt.TopAbs_ShapeEnum[kind] as TopAbs_ShapeEnum,
    occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
  )
  try {
    for (; explorer.More(); explorer.Next()) {
      const current = explorer.Current()
      try {
        const item = convert(current)
        try {
          visit(item)
        } finally {
          item.delete()
        }
      } finally {
        current.delete()
      }
    }
  } finally {
    explorer.delete()
  }
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

/** Signed principal curvatures sampled on a parameter grid; planar faces return none. */
function sampledCurvatures(occt: OpenCascadeInstance, face: Face): readonly number[] {
  const { own, release } = ownership()
  try {
    const adaptor = own(new occt.BRepAdaptor_Surface_2(face.wrapped, true))
    if (adaptor.GetType() === occt.GeomAbs_SurfaceType.GeomAbs_Plane) return []
    const [u0, u1, v0, v1] = [
      adaptor.FirstUParameter(),
      adaptor.LastUParameter(),
      adaptor.FirstVParameter(),
      adaptor.LastVParameter(),
    ]
    if (![u0, u1, v0, v1].every(Number.isFinite)) return []
    const reversed = face.wrapped.Orientation_1() === occt.TopAbs_Orientation.TopAbs_REVERSED
    const point = own(new occt.gp_Pnt_1())
    const vector = () => own(new occt.gp_Vec_1())
    const derivatives = { u: vector(), v: vector(), uu: vector(), vv: vector(), uv: vector() }
    const step = 1 / (CURVATURE_SAMPLES - 1)
    const curvatures: number[] = []
    for (let index = 0; index < CURVATURE_SAMPLES ** 2; index += 1) {
      const s = Math.floor(index / CURVATURE_SAMPLES) * step,
        t = (index % CURVATURE_SAMPLES) * step
      const { u, v, uu, vv, uv } = derivatives
      adaptor.D2(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t, point, u, v, uu, vv, uv)
      curvatures.push(...(principalCurvatures(derivatives, reversed) ?? []))
    }
    return curvatures
  } finally {
    release()
  }
}

function faceArea(occt: OpenCascadeInstance, face: Face) {
  const properties = new occt.GProp_GProps_1()
  try {
    occt.BRepGProp.SurfaceProperties_1(face.wrapped, properties, false, false)
    return properties.Mass()
  } finally {
    properties.delete()
  }
}

/** Curvature and area evidence of the selected faces, sampled once per evaluation. */
export type PatchEvidence = Readonly<{
  /** Total area of the selected faces in square millimetres. */
  area: number
  /** Largest sampled absolute principal curvature, or 0 for planar faces. */
  maximumCurvature: number
  /** Signed curvatures per selected face, in selection order. */
  curvatures: readonly (readonly number[])[]
}>

export function patchEvidence(occt: OpenCascadeInstance, faces: readonly Face[]): PatchEvidence {
  const curvatures = faces.map((face) => sampledCurvatures(occt, face))
  return {
    area: faces.reduce((sum, face) => sum + faceArea(occt, face), 0),
    maximumCurvature: Math.max(0, ...curvatures.flat().map(Math.abs)),
    curvatures,
  }
}

/** Rejects offsets that would collapse a selected face's concave side before OCCT runs. */
export function requireCurvatureClearance(
  evidence: PatchEvidence,
  offsets: readonly number[],
  label: string,
) {
  evidence.curvatures.forEach((curvatures, index) => {
    for (const offset of offsets) {
      const collapsing = curvatures.filter((curvature) => curvature * offset > 0)
      const radius = Math.min(Infinity, ...collapsing.map((curvature) => 1 / Math.abs(curvature)))
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

/**
 * Steiner bounds for a slab with walls along the face normals: every volume element lies between
 * (1 - |s|k)^2 and (1 + |s|k)^2 times area times |s|. Sampling slack covers missed curvature peaks.
 */
function withinSteinerBounds(evidence: PatchEvidence, offset: number, volume: number) {
  const spread = Math.abs(offset) * evidence.maximumCurvature * 1.25
  const nominal = evidence.area * Math.abs(offset)
  const lower = nominal * Math.max(0, 1 - spread) ** 2 * (1 - 2e-3)
  const upper = nominal * (1 + spread) ** 2 * (1 + 2e-3)
  return volume >= lower && volume <= upper
}

/** Deep-copies the body so native offset and Boolean builders never share source topology. */
export function copySourceWithFaces(
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
  let tolerance = 0
  forEachSubShape(
    occt,
    shape,
    "TopAbs_EDGE",
    (current) => occt.TopoDS.Edge_1(current),
    (edge) => {
      tolerance = Math.max(tolerance, occt.BRep_Tool.Tolerance_2(edge))
    },
  )
  return tolerance
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
  const solid = own(occt.TopoDS.Solid_1(own(explorer.Current())))
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
  acceptVolume: (volume: number) => boolean = () => true,
) {
  const solid = singleOrientedSolid(occt, shape, own)
  if (!solid) return null
  const analyzer = own(new occt.BRepCheck_Analyzer(solid, true, false))
  const volume = solidVolume(occt, solid)
  return analyzer.IsValid_2() &&
    Number.isFinite(volume) &&
    volume > 0 &&
    acceptVolume(volume) &&
    maximumEdgeTolerance(occt, solid) <= toleranceLimit
    ? solid
    : null
}

/** Offsets the selected faces with walls along their boundary normals (no intersections). */
function simpleSlab(
  occt: OpenCascadeInstance,
  faces: readonly TopoDS_Shape[],
  offset: number,
  evidence: PatchEvidence,
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
  const progress = own(new occt.Message_ProgressRange_1())
  try {
    maker.MakeThickSolidBySimple(input, offset)
    maker.Build(progress)
  } catch {
    // A native offset failure falls through to the joined construction.
    return null
  }
  if (!maker.IsDone()) return null
  const tolerance = Math.max(SIMPLE_OFFSET_TOLERANCE_LIMIT, Math.abs(offset) * 1e-4)
  return acceptedSlab(occt, own(maker.Shape()), tolerance, own, (volume) =>
    withinSteinerBounds(evidence, offset, volume),
  )
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
  forEachSubShape(
    occt,
    copied,
    "TopAbs_FACE",
    (current) => occt.TopoDS.Face_1(current),
    (face) => {
      if (!selected.some((candidate) => candidate.IsSame(face))) own(closing.Append_1(face))
    },
  )
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
export function slabBuilders(
  occt: OpenCascadeInstance,
  source: Shape3D,
  selected: readonly Face[],
  evidence: PatchEvidence,
  own: Own,
): readonly SlabBuilder[] {
  return [
    (offset) =>
      simpleSlab(
        occt,
        copySourceWithFaces(occt, source, selected, own).copiedFaces,
        offset,
        evidence,
        own,
      ),
    (offset) => {
      const { copied, copiedFaces } = copySourceWithFaces(occt, source, selected, own)
      return joinedSlab(occt, copied, copiedFaces, offset, own)
    },
  ]
}

/** Runs one Boolean and unifies same-domain faces; the builder keeps the merged history. */
export function combineShapes(
  occt: OpenCascadeInstance,
  kind: "fuse" | "cut",
  left: TopoDS_Shape,
  right: TopoDS_Shape,
  own: Own,
): { shape: TopoDS_Shape; builder: BRepAlgoAPI_BuilderAlgo } | null {
  const progress = own(new occt.Message_ProgressRange_1())
  const Builder = kind === "fuse" ? occt.BRepAlgoAPI_Fuse_3 : occt.BRepAlgoAPI_Cut_3
  const builder = own(new Builder(left, right, progress))
  builder.Build(progress)
  if (!builder.IsDone()) return null
  builder.SimplifyResult(true, true, 1e-7)
  return { shape: own(builder.Shape()), builder }
}
