import type { Face, Shape3D } from "replicad"
import type {
  BRepBuilderAPI_MakeShape,
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
  TopoDS_Shape,
} from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import { createOcctBox, cutOcctShapes, intersectOcctShapes } from "./occt-shapes"

type Point = readonly [number, number, number]
type Owned = { delete(): unknown }
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/**
 * Swept tools whose caps are half-planes through an axis (Revolve) name each cap's overrun normal
 * and the in-plane side its profile occupies, so coplanar faces across the axis are not caps.
 */
export type SweptCapOptions = Readonly<{ endNormal?: Point; startSide?: Point; endSide?: Point }>
const SIDE_TOLERANCE = 1e-9

function surfaceArea(occt: OpenCascadeInstance, shape: TopoDS_Shape) {
  const properties = new occt.GProp_GProps_1()
  try {
    occt.BRepGProp.SurfaceProperties_1(shape, properties, false, false)
    return properties.Mass()
  } finally {
    properties.delete()
  }
}

/** The tight corners of a face's bounding box, without triangulation or tolerance gaps. */
function faceCorners(occt: OpenCascadeInstance, face: Face): Point[] {
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepBndLib.AddOptimal(face.wrapped, box, false, false)
    if (box.IsVoid()) return []
    const min = box.CornerMin()
    const max = box.CornerMax()
    try {
      const corners: Point[] = []
      for (const x of [min.X(), max.X()])
        for (const y of [min.Y(), max.Y()]) for (const z of [min.Z(), max.Z()]) corners.push([x, y, z])
      return corners
    } finally {
      min.delete()
      max.delete()
    }
  } finally {
    box.delete()
  }
}

/** Area of the part of a cap-plane face that lies in the half-plane on `side` of the axis. */
function halfPlaneArea(
  occt: OpenCascadeInstance,
  face: Face,
  origin: Point,
  normal: Point,
  side: Point,
) {
  const corners = faceCorners(occt, face)
  const offsets = corners.map((corner) =>
    dot([corner[0] - origin[0], corner[1] - origin[1], corner[2] - origin[2]], side),
  )
  if (offsets.length === 0 || Math.max(...offsets) <= SIDE_TOLERANCE) return 0
  if (Math.min(...offsets) >= -SIDE_TOLERANCE) return surfaceArea(occt, face.wrapped)
  // The face straddles the axis, as when OCCT merges a start cap with a coplanar contact across
  // the axis into one face. Clip it with a half-plane face that covers its whole extent.
  const reach =
    2 *
      Math.max(
        ...corners.map((corner) =>
          Math.hypot(corner[0] - origin[0], corner[1] - origin[1], corner[2] - origin[2]),
        ),
      ) +
    1
  const owned: Owned[] = []
  const own = <T extends Owned>(value: T) => {
    owned.push(value)
    return value
  }
  try {
    const axes = own(
      new occt.gp_Ax3_3(
        own(new occt.gp_Pnt_3(...origin)),
        own(new occt.gp_Dir_4(...normal)),
        own(new occt.gp_Dir_4(...side)),
      ),
    )
    const plane = own(new occt.gp_Pln_2(axes))
    const maker = own(new occt.BRepBuilderAPI_MakeFace_9(plane, 0, reach, -reach, reach))
    if (!maker.IsDone()) throw new Error("OCCT could not build the revolve cap half-plane.")
    const halfPlane = own(maker.Face())
    return intersectionArea(occt, face.wrapped, halfPlane, own(new occt.Message_ProgressRange_1()))
  } finally {
    for (const value of owned.reverse()) value.delete()
  }
}

function capArea(
  occt: OpenCascadeInstance,
  shape: Shape3D,
  origin: Point,
  normal: Point,
  side?: Point,
) {
  let area = 0
  const faces = shape.faces
  try {
    for (const face of faces) {
      if (face.geomType !== "PLANE") continue
      const center = face.center
      const direction = face.normalAt()
      try {
        const delta = center.toTuple().map((v, i) => v - (origin[i] ?? 0)) as [
          number,
          number,
          number,
        ]
        if (
          Math.abs(dot(delta, normal)) > 1e-5 ||
          Math.abs(dot(direction.toTuple(), normal)) < 1 - 1e-6
        )
          continue
        area +=
          side === undefined
            ? surfaceArea(occt, face.wrapped)
            : halfPlaneArea(occt, face, origin, normal, side)
      } finally {
        center.delete()
        direction.delete()
      }
    }
    return area
  } finally {
    for (const face of faces) face.delete()
  }
}
function solids(occt: OpenCascadeInstance, shape: Shape3D): Shape3D[] {
  const result: Shape3D[] = []
  const explorer = new occt.TopExp_Explorer_2(
    shape.wrapped,
    occt.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum,
    occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
  )
  try {
    while (explorer.More()) {
      result.push(adoptOcctShape(explorer.Current(), castOcctShape))
      explorer.Next()
    }
    return result
  } catch (error) {
    for (const body of result) body.delete()
    throw error
  } finally {
    explorer.delete()
  }
}
/** The unique bounded component must retain the complete start cap and lose the overrun cap. */
export function terminateExtrusionAtBody(
  occt: OpenCascadeInstance,
  tool: Shape3D,
  target: Shape3D,
  start: Point,
  end: Point,
  normal: Point,
  caps: SweptCapOptions = {},
) {
  const cut = cutOcctShapes(occt, tool, target)
  try {
    return takeBoundedExtrusionPart(occt, tool, cut, start, end, normal, caps)
  } finally {
    cut.delete()
  }
}
function takeBoundedExtrusionPart(
  occt: OpenCascadeInstance,
  tool: Shape3D,
  cut: Shape3D,
  start: Point,
  end: Point,
  normal: Point,
  caps: SweptCapOptions,
) {
  const expected = capArea(occt, tool, start, normal, caps.startSide)
  if (expected <= 0) throw new Error("Extrusion start cap is unavailable.")
  let parts: Shape3D[] = []
  try {
    parts = solids(occt, cut)
    const candidates = parts.filter((part) => {
      const metrics = inspectOcctBody(occt, part)
      return (
        metrics.valid &&
        metrics.solidCount === 1 &&
        metrics.volume > 0 &&
        Math.abs(capArea(occt, part, start, normal, caps.startSide) - expected) <=
          Math.max(1e-7, expected * 1e-7) &&
        capArea(occt, part, end, caps.endNormal ?? normal, caps.endSide) <= 1e-7
      )
    })
    if (candidates.length !== 1)
      throw new Error(
        "Extrusion endpoint must completely cover the profile and identify one reachable cap.",
      )
    const result = candidates[0]
    if (!result) throw new Error("Extrusion endpoint is unavailable.")
    parts = parts.filter((part) => part !== result)
    return result
  } finally {
    for (const part of parts) part.delete()
  }
}
/** Exact Boolean history distinguishes the borrowed prism boundary from newly created end faces. */
export function terminateExtrusionAtFace(
  occt: OpenCascadeInstance,
  tool: Shape3D,
  target: Shape3D,
  support: Face,
  start: Point,
  end: Point,
  normal: Point,
  caps: SweptCapOptions = {},
) {
  const resources: { delete(): void }[] = []
  const own = <T extends { delete(): void }>(value: T) => {
    resources.push(value)
    return value
  }
  try {
    const argumentsList = own(new occt.TopTools_ListOfShape_1())
    const tools = own(new occt.TopTools_ListOfShape_1())
    own(argumentsList.Append_1(tool.wrapped))
    own(tools.Append_1(target.wrapped))
    const progress = own(new occt.Message_ProgressRange_1())
    const cutter = own(new occt.BRepAlgoAPI_Cut_1())
    cutter.SetArguments(argumentsList)
    cutter.SetTools(tools)
    cutter.SetNonDestructive(true)
    cutter.SetToFillHistory(true)
    cutter.Build(progress)
    if (!cutter.IsDone()) throw new Error("OCCT could not build the extrusion face endpoint.")
    const cut = own(adoptOcctShape(cutter.Shape(), castOcctShape))
    const originalBoundary = prismBoundaryDescendants(cutter, tool, own)
    const result = takeBoundedExtrusionPart(occt, tool, cut, start, end, normal, caps)
    try {
      validateNewFaceCoverage(occt, result, support, originalBoundary, progress)
      return result
    } catch (error) {
      result.delete()
      throw error
    }
  } finally {
    for (const resource of resources.reverse()) resource.delete()
  }
}
function prismBoundaryDescendants(
  cutter: Pick<BRepBuilderAPI_MakeShape, "Modified">,
  tool: Shape3D,
  own: <T extends { delete(): void }>(value: T) => T,
) {
  const originals: TopoDS_Shape[] = []
  const faces = tool.faces.map(own)
  for (const face of faces) {
    originals.push(face.wrapped)
    const modified = own(cutter.Modified(face.wrapped))
    while (modified.Size() > 0) {
      originals.push(own(modified.First_2()))
      modified.RemoveFirst()
    }
  }
  return originals
}
function validateNewFaceCoverage(
  occt: OpenCascadeInstance,
  result: Shape3D,
  support: Face,
  originalBoundary: readonly TopoDS_Shape[],
  progress: InstanceType<OpenCascadeInstance["Message_ProgressRange_1"]>,
) {
  const faces = result.faces
  let total = 0,
    covered = 0
  try {
    for (const face of faces) {
      if (originalBoundary.some((original) => original.IsSame(face.wrapped))) continue
      const areas = faceIntersectionAreas(occt, face, support, progress)
      total += areas.original
      covered += areas.intersection
    }
    if (total <= 0 || Math.abs(total - covered) > Math.max(1e-7, total * 1e-7))
      throw new Error("The selected finite end face must cover every new extrusion cap.")
  } finally {
    for (const face of faces) face.delete()
  }
}
export function terminateExtrusionAtPlane(
  occt: OpenCascadeInstance,
  tool: Shape3D,
  origin: Point,
  normal: Point,
  start: Point,
  end: Point,
  extrusionNormal: Point,
  supportFace: Face | undefined,
) {
  // A finite half-space covers the exact tool bounds; no mesh or sampled rays decide the endpoint.
  const box = tool.boundingBox
  const center = box.center
  const bounds = box.bounds
  box.delete()
  const radius =
    Math.max(
      1,
      Math.hypot(...bounds[1].map((v, i) => v - (bounds[0][i] ?? 0))) +
        Math.hypot(...center.map((v, i) => v - (origin[i] ?? 0))),
    ) * 2
  const sign =
    dot(start.map((v, i) => v - (origin[i] ?? 0)) as [number, number, number], normal) <= 0 ? 1 : -1
  const directed = normal.map((v) => v * sign) as [number, number, number]
  let clip = createOcctBox(occt, [2 * radius, 2 * radius, 2 * radius], true, [0, 0, -radius])
  try {
    const cross: [number, number, number] = [-directed[1], directed[0], 0]
    const sine = Math.hypot(...cross)
    if (sine > 1e-10)
      clip = clip.rotate((Math.atan2(sine, directed[2]) * 180) / Math.PI, [0, 0, 0], cross)
    else if (directed[2] < 0) clip = clip.rotate(180, [0, 0, 0], [1, 0, 0])
    clip = clip.translate([...origin])
    const clipped = intersectOcctShapes(occt, tool, clip)
    try {
      const expected = capArea(occt, tool, start, extrusionNormal)
      const metrics = inspectOcctBody(occt, clipped)
      if (
        !metrics.valid ||
        metrics.solidCount !== 1 ||
        metrics.volume <= 0 ||
        Math.abs(capArea(occt, clipped, start, extrusionNormal) - expected) >
          Math.max(1e-7, expected * 1e-7) ||
        capArea(occt, clipped, end, extrusionNormal) > 1e-7
      )
        throw new Error(
          "Extrusion face endpoint is unreachable or does not cover the complete profile.",
        )
      if (!supportFace) throw new Error("Extrusion requires an exact resolved end face.")
      validateFaceCoverage(occt, clipped, supportFace, origin, normal)
      return clipped
    } catch (error) {
      clipped.delete()
      throw error
    }
  } finally {
    clip.delete()
  }
}

export function draftExtrusionTool(
  occt: OpenCascadeInstance,
  tool: Shape3D,
  origin: Point,
  normal: Point,
  angle: number,
) {
  const resources: { delete(): void }[] = []
  const own = <T extends { delete(): void }>(value: T) => {
    resources.push(value)
    return value
  }
  try {
    const direction = own(new occt.gp_Dir_4(...normal))
    const point = own(new occt.gp_Pnt_3(...origin))
    const plane = own(new occt.gp_Pln_3(point, direction))
    const builder = own(new occt.BRepOffsetAPI_DraftAngle_2(tool.wrapped))
    const faces = tool.faces.map((face) => own(face))
    const progress = own(new occt.Message_ProgressRange_1())
    let added = 0
    for (const face of faces) {
      const vector = face.normalAt()
      try {
        if (Math.abs(dot(vector.toTuple(), normal)) > 1 - 1e-6) continue
      } finally {
        vector.delete()
      }
      builder.Add(face.wrapped, direction, angle, plane, true)
      if (!builder.AddDone()) throw new Error("OCCT could not draft an extrusion side face.")
      added += 1
    }
    if (!added) throw new Error("Extrusion has no draftable side faces.")
    builder.Build(progress)
    if (!builder.IsDone()) throw new Error("OCCT could not build the drafted extrusion.")
    const result = adoptOcctShape(builder.Shape(), castOcctShape)
    try {
      const metrics = inspectOcctBody(occt, result)
      if (!metrics.valid || metrics.solidCount !== 1 || metrics.volume <= 0)
        throw new Error("Extrusion draft produced an invalid solid.")
      return result
    } catch (error) {
      result.delete()
      throw error
    }
  } finally {
    for (const resource of resources.reverse()) resource.delete()
  }
}

function validateFaceCoverage(
  occt: OpenCascadeInstance,
  clipped: Shape3D,
  support: Face,
  origin: Point,
  normal: Point,
) {
  const faces = clipped.faces
  const progress = new occt.Message_ProgressRange_1()
  let total = 0,
    covered = 0
  try {
    for (const face of faces) {
      if (face.geomType !== "PLANE") continue
      const center = face.center,
        direction = face.normalAt()
      try {
        if (
          Math.abs(
            dot(
              center.toTuple().map((v, i) => v - (origin[i] ?? 0)) as [number, number, number],
              normal,
            ),
          ) > 1e-5 ||
          Math.abs(dot(direction.toTuple(), normal)) < 1 - 1e-6
        )
          continue
      } finally {
        center.delete()
        direction.delete()
      }
      const areas = faceIntersectionAreas(occt, face, support, progress)
      total += areas.original
      covered += areas.intersection
    }
    if (total <= 0 || Math.abs(total - covered) > Math.max(1e-7, total * 1e-7))
      throw new Error("The selected end face must cover the complete extrusion profile.")
  } finally {
    for (const face of faces) face.delete()
    progress.delete()
  }
}

function faceIntersectionAreas(
  occt: OpenCascadeInstance,
  face: Face,
  support: Face,
  progress: InstanceType<OpenCascadeInstance["Message_ProgressRange_1"]>,
) {
  return {
    original: surfaceArea(occt, face.wrapped),
    intersection: intersectionArea(occt, face.wrapped, support.wrapped, progress),
  }
}

/** Area of the non-destructive Boolean common of two faces. */
function intersectionArea(
  occt: OpenCascadeInstance,
  face: TopoDS_Shape,
  other: TopoDS_Shape,
  progress: InstanceType<OpenCascadeInstance["Message_ProgressRange_1"]>,
) {
  const resources: { delete(): void }[] = []
  const own = <T extends { delete(): void }>(value: T) => {
    resources.push(value)
    return value
  }
  try {
    const argumentsList = own(new occt.TopTools_ListOfShape_1())
    const tools = own(new occt.TopTools_ListOfShape_1())
    own(argumentsList.Append_1(face))
    own(tools.Append_1(other))
    const common = own(new occt.BRepAlgoAPI_Common_1())
    common.SetArguments(argumentsList)
    common.SetTools(tools)
    common.SetNonDestructive(true)
    common.SetToFillHistory(false)
    common.Build(progress)
    if (!common.IsDone()) throw new Error("OCCT could not measure a face intersection.")
    return surfaceArea(occt, own(common.Shape()))
  } finally {
    for (const resource of resources.reverse()) resource.delete()
  }
}
