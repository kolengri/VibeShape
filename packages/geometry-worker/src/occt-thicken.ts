import { THICKEN_MAX_THICKNESS, THICKEN_MIN_THICKNESS } from "@vibeshape/protocol"
import type { Face, Shape3D } from "replicad"
import type { OpenCascadeInstance, TopoDS_Shape } from "replicad-opencascadejs"
import { featureResultMetricsAreValid } from "./feature-result-validation"
import { inspectOcctBody } from "./occt-body-validation"
import { castOcctShape } from "./occt-cast"
import {
  combineShapes,
  copySourceWithFaces,
  forEachSubShape,
  formatMillimetres,
  ownership,
  patchEvidence,
  requireCurvatureClearance,
  requireSourceSolid,
  slabBuilders,
  ThickenError,
} from "./occt-offset-slab"

export { ThickenError } from "./occt-offset-slab"

export type ThickenSide = "outward" | "inward" | "symmetric"
export type ThickenOperation = "new" | "add" | "remove"
export type ThickenGeometryParameters = Readonly<{
  /** Total thickness in millimetres; symmetric mode splits it evenly across both sides. */
  thickness: number
  side: ThickenSide
  operation: ThickenOperation
}>

/** Signed offsets along the outward face normals for one Thicken side mode. */
function signedOffsets(thickness: number, side: ThickenSide): readonly number[] {
  if (side === "outward") return [thickness]
  if (side === "inward") return [-thickness]
  return [thickness / 2, -thickness / 2]
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

/**
 * Boundary edges of each selected face, excluding degenerate edges (sphere poles) and seams that a
 * face shares only with itself (cylinder and torus seams). Edges are keyed by native hash.
 */
function faceBoundaryEdges(occt: OpenCascadeInstance, faces: readonly Face[]) {
  return faces.map((face) => {
    const edges = new Set<number>()
    forEachSubShape(
      occt,
      face.wrapped,
      "TopAbs_EDGE",
      (current) => occt.TopoDS.Edge_1(current),
      (edge) => {
        if (occt.BRep_Tool.Degenerated(edge) || occt.BRep_Tool.IsClosed_2(edge, face.wrapped))
          return
        edges.add(edge.HashCode(2_147_483_647))
      },
    )
    return edges
  })
}

/** Selected faces must form one edge-connected patch; returns nothing or throws. */
function requireConnectedFaces(edgeSets: readonly ReadonlySet<number>[]) {
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
  const detached = edgeSets.findIndex((_edges, index) => !reached.has(index))
  if (detached >= 0)
    throw new ThickenError(
      `Selected face ${detached + 1} does not share an edge with selected face 1. Thicken ` +
        "needs one connected patch of faces; create a separate Thicken for each patch.",
    )
}

/**
 * Whether the faces form a closed shell: OCCT pairs every edge occurrence, cancelling shared edges
 * and same-face seams, and ignores degenerate, INTERNAL and EXTERNAL edges. A closed selection
 * offsets to a whole solid rather than a wall.
 */
export function faceSelectionIsClosed(occt: OpenCascadeInstance, faces: readonly TopoDS_Shape[]) {
  const builder = new occt.TopoDS_Builder()
  const shell = new occt.TopoDS_Shell()
  try {
    builder.MakeShell(shell)
    for (const face of faces) builder.Add(shell, face)
    return occt.BRep_Tool.IsClosed_1(shell)
  } finally {
    shell.delete()
    builder.delete()
  }
}

/** Shell owns uniform walls of closed bodies; Thicken needs a free boundary to build a wall from. */
function requireFreeBoundary(occt: OpenCascadeInstance, faces: readonly Face[]) {
  if (
    !faceSelectionIsClosed(
      occt,
      faces.map((face) => face.wrapped),
    )
  )
    return
  throw new ThickenError(
    "The selected faces enclose a closed region with no free boundary edge, such as a whole " +
      "sphere, torus or every face of a body, so Thicken cannot build a wall from them. Use Shell " +
      "for a uniform wall around a closed body, or leave at least one face unselected.",
  )
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
 * Thickens one connected, open patch of faces of an exact solid into a new solid, then optionally
 * adds it to or removes it from the source. Every selected face is thickened; nothing is skipped.
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
    const edgeSets = faceBoundaryEdges(occt, selected)
    requireConnectedFaces(edgeSets)
    requireFreeBoundary(occt, selected)
    const offsets = signedOffsets(parameters.thickness, parameters.side)
    const evidence = patchEvidence(occt, selected)
    requireCurvatureClearance(evidence, offsets, "Thicken")
    const { copied } = copySourceWithFaces(occt, source, selected, own)
    const builders = slabBuilders(occt, source, selected, evidence, own)
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
    const thick = first && second ? combineShapes(occt, "fuse", first, second, own)?.shape : first
    const combined =
      !thick || parameters.operation === "new"
        ? thick
        : combineShapes(occt, parameters.operation === "add" ? "fuse" : "cut", copied, thick, own)
            ?.shape
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
