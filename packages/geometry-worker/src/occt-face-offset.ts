import type { Face, Shape3D } from "replicad"
import type {
  BRepAlgoAPI_BuilderAlgo,
  OpenCascadeInstance,
  TopoDS_Shape,
} from "replicad-opencascadejs"
import { featureResultMetricsAreValid } from "./feature-result-validation"
import { inspectOcctBody } from "./occt-body-validation"
import { castOcctShape } from "./occt-cast"
import {
  combineShapes,
  copySourceWithFaces,
  forEachSubShape,
  formatMillimetres,
  type Own,
  ownership,
  patchEvidence,
  requireCurvatureClearance,
  requireSourceSolid,
  slabBuilders,
  ThickenError,
} from "./occt-offset-slab"

type Point = readonly [number, number, number]
/** A slab wall touches a boundary edge when it passes within this distance (millimetres). */
const CONTACT_TOLERANCE = 1e-5

/** One boundary edge of the moved face: a point on it and the body faces across it. */
type EdgeContact = Readonly<{ point: Point; neighbours: readonly TopoDS_Shape[] }>

function edgeMidpoint(occt: OpenCascadeInstance, edge: TopoDS_Shape, own: Own): Point {
  const curve = own(new occt.BRepAdaptor_Curve_2(own(occt.TopoDS.Edge_1(edge))))
  const point = own(curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2))
  return [point.X(), point.Y(), point.Z()]
}

function subShapes(
  occt: OpenCascadeInstance,
  shape: TopoDS_Shape,
  kind: "TopAbs_EDGE" | "TopAbs_FACE",
  own: Own,
  keep: (item: TopoDS_Shape) => boolean = () => true,
) {
  const items: TopoDS_Shape[] = []
  const convert = (current: TopoDS_Shape) =>
    kind === "TopAbs_EDGE" ? occt.TopoDS.Edge_1(current) : occt.TopoDS.Face_1(current)
  forEachSubShape(occt, shape, kind, convert, (item) => {
    if (keep(item)) items.push(own(convert(item)))
  })
  return items
}

/**
 * Every boundary edge of the selected face (seams and degenerate edges excluded) with a point on it
 * and the body faces across it, read from the body copy.
 */
function edgeContacts(
  occt: OpenCascadeInstance,
  copied: TopoDS_Shape,
  selected: TopoDS_Shape,
  own: Own,
): EdgeContact[] {
  const selectedFace = own(occt.TopoDS.Face_1(selected))
  const edges = subShapes(occt, selected, "TopAbs_EDGE", own, (edge) => {
    const typed = occt.TopoDS.Edge_1(edge)
    try {
      return !occt.BRep_Tool.Degenerated(typed) && !occt.BRep_Tool.IsClosed_2(typed, selectedFace)
    } finally {
      typed.delete()
    }
  })
  const faces = subShapes(occt, copied, "TopAbs_FACE", own, (face) => !face.IsSame(selected))
  return edges.map((edge) => ({
    point: edgeMidpoint(occt, edge, own),
    neighbours: faces.filter((face) =>
      subShapes(occt, face, "TopAbs_EDGE", own).some((candidate) => candidate.IsSame(edge)),
    ),
  }))
}

/** The result faces a source face became, or the source face itself when it is unchanged. */
function faceImages(builder: BRepAlgoAPI_BuilderAlgo, face: TopoDS_Shape, own: Own) {
  const list = own(builder.Modified(face))
  if (list.Size() === 0) return builder.IsDeleted(face) ? [] : [face]
  const images: TopoDS_Shape[] = []
  while (list.Size() > 0) {
    images.push(own(list.First_2()))
    list.RemoveFirst()
  }
  return images
}

function shapeDistance(
  occt: OpenCascadeInstance,
  left: TopoDS_Shape,
  right: TopoDS_Shape,
  own: Own,
) {
  const distance = own(new occt.BRepExtrema_DistShapeShape_1())
  distance.LoadS1(left)
  distance.LoadS2(right)
  distance.Perform(own(new occt.Message_ProgressRange_1()))
  return distance.IsDone() ? distance.Value() : Infinity
}

function pointToShapeDistance(
  occt: OpenCascadeInstance,
  point: Point,
  shape: TopoDS_Shape,
  own: Own,
) {
  const vertexMaker = own(new occt.BRepBuilderAPI_MakeVertex(own(new occt.gp_Pnt_3(...point))))
  return shapeDistance(occt, own(vertexMaker.Vertex()), shape, own)
}

/**
 * Boolean history proof that the neighbours stayed attached: no body face other than the moved one
 * is deleted, and across every boundary edge each slab face touching that edge is either internal
 * to the result (coincident with the body, hence deleted) or merges into the image of that edge's
 * own neighbour. A face-count check alone is not sufficient: a ledge can merge into an unrelated
 * coplanar face while the true neighbour (for example a chamfer) stays behind.
 */
function neighboursStayAttached(
  occt: OpenCascadeInstance,
  combination: Readonly<{ builder: BRepAlgoAPI_BuilderAlgo; slab: TopoDS_Shape }>,
  copied: TopoDS_Shape,
  selected: TopoDS_Shape,
  contacts: readonly EdgeContact[],
  own: Own,
) {
  const { builder, slab } = combination
  const sourceFaces = subShapes(occt, copied, "TopAbs_FACE", own, (face) => !face.IsSame(selected))
  if (sourceFaces.some((face) => builder.IsDeleted(face))) return false
  const slabFaces = subShapes(occt, slab, "TopAbs_FACE", own)
  return contacts.every(({ point, neighbours }) => {
    const targets = neighbours.flatMap((neighbour) => faceImages(builder, neighbour, own))
    return slabFaces
      .filter((face) => pointToShapeDistance(occt, point, face, own) <= CONTACT_TOLERANCE)
      .every((face) =>
        faceImages(builder, face, own).every((image) =>
          targets.some((target) => target.IsSame(image)),
        ),
      )
  })
}

function unifiedFaceCount(occt: OpenCascadeInstance, shape: TopoDS_Shape) {
  const { own, release } = ownership()
  try {
    const unify = own(new occt.ShapeUpgrade_UnifySameDomain_2(shape, true, true, false))
    unify.Build()
    let count = 0
    forEachSubShape(
      occt,
      own(unify.Shape()),
      "TopAbs_FACE",
      (current) => occt.TopoDS.Face_1(current),
      () => {
        count += 1
      },
    )
    return count
  } finally {
    release()
  }
}

function acceptedOffset(
  occt: OpenCascadeInstance,
  shape: TopoDS_Shape,
  sourceVolume: number,
  distance: number,
) {
  const result = castOcctShape(shape)
  const metrics = inspectOcctBody(occt, result)
  const change = (metrics.volume - sourceVolume) * Math.sign(distance)
  if (featureResultMetricsAreValid(metrics, 1) && change > Math.max(1e-9, sourceVolume * 1e-12))
    return result
  result.delete()
  return null
}

function moveDescription(distance: number) {
  return `the curved face ${formatMillimetres(Math.abs(distance))} ${distance > 0 ? "outward" : "inward"}`
}

function detachedFailure(distance: number) {
  return new ThickenError(
    `Press Pull cannot move ${moveDescription(distance)} while keeping its neighbouring faces ` +
      "attached. Planar neighbours that meet the face at right angles follow it. A slanted planar " +
      "neighbour extends only when the moved face and its neighbours make up the whole body, such " +
      "as an isolated cone frustum, and curved neighbours such as chamfers and fillets never " +
      "follow. Reduce the distance or use Thicken instead.",
  )
}

function reachFailure(distance: number) {
  return new ThickenError(
    `Press Pull cannot move ${moveDescription(distance)}: the move would reach another feature ` +
      "of the part, a face that does not border the moved face. Reduce the distance or change " +
      "that feature first.",
  )
}

/** Whether the slab touches a body face that neither is the moved face nor borders it. */
function reachesOtherFeature(
  occt: OpenCascadeInstance,
  slab: TopoDS_Shape,
  copied: TopoDS_Shape,
  selected: TopoDS_Shape,
  contacts: readonly EdgeContact[],
  own: Own,
) {
  const bordering = contacts.flatMap(({ neighbours }) => neighbours)
  return subShapes(
    occt,
    copied,
    "TopAbs_FACE",
    own,
    (face) => !face.IsSame(selected) && !bordering.some((neighbour) => neighbour.IsSame(face)),
  ).some((face) => shapeDistance(occt, slab, face, own) <= CONTACT_TOLERANCE)
}

/**
 * Moves one curved face along its normals by a signed distance: the swept region between the face
 * and its offset is added or removed. The result is accepted only when Boolean history proves that
 * every neighbouring face stayed attached; otherwise the offset fails closed.
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
  const evidence = patchEvidence(occt, [face])
  requireCurvatureClearance(evidence, [distance], "Press Pull")
  const { own, release } = ownership()
  try {
    const { copied, copiedFaces } = copySourceWithFaces(occt, source, [face], own)
    const [selected] = copiedFaces
    if (!selected) throw new ThickenError("The selected face is unavailable on the body copy.")
    const expectedFaces = unifiedFaceCount(occt, copied)
    const contacts = edgeContacts(occt, copied, selected, own)
    let reachesOther = false
    for (const build of slabBuilders(occt, source, [face], evidence, own)) {
      const slab = build(distance)
      if (!slab) continue
      reachesOther ||= reachesOtherFeature(occt, slab, copied, selected, contacts, own)
      const combined = combineShapes(occt, distance > 0 ? "fuse" : "cut", copied, slab, own)
      if (
        !combined ||
        unifiedFaceCount(occt, combined.shape) !== expectedFaces ||
        !neighboursStayAttached(
          occt,
          { builder: combined.builder, slab },
          copied,
          selected,
          contacts,
          own,
        )
      )
        continue
      const result = acceptedOffset(occt, combined.shape, sourceVolume, distance)
      if (result) return result
    }
    throw reachesOther ? reachFailure(distance) : detachedFailure(distance)
  } catch (error) {
    if (error instanceof ThickenError) throw error
    throw new ThickenError(
      "OCCT could not offset the curved face. Reduce the distance or use Thicken instead.",
    )
  } finally {
    release()
  }
}
