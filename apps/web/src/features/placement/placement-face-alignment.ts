import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import {
  type BodyTopoRef,
  createBodyTopologyReferenceProjector,
  createBodyTopologyReferenceResolver,
} from "@vibeshape/domain/model-body-topology"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { authoredPlacementTarget } from "../part-design/authored-part-selection"

type Vector3 = readonly [number, number, number]
export type PlacementAlignmentFace = Readonly<{
  key: string
  context: string
  candidateId: string
  meshFaceId?: number | undefined
  reference: BodyTopoRef
  bodyName: string
  center: Vector3
  normal: Vector3
}>
export type PlacementAlignmentFaces = Readonly<{
  source: readonly PlacementAlignmentFace[]
  targets: readonly PlacementAlignmentFace[]
}>
export type FaceAlignmentOrientation = "opposed" | "same"

function sameBody(left: BodyReference, right: BodyReference) {
  return left.featureId === right.featureId && left.outputRole === right.outputRole
}

function bodyFaces(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  body: BodyReference,
  bodyName: string,
): PlacementAlignmentFace[] {
  const result = createModelBodyTopologyEvidence(snapshot, rebuild, { ...body, kind: "face" })
  if (!result.ok) return []
  const rawBody = rebuild.ok
    ? rebuild.response.geometry
        .find(({ featureId }) => featureId === body.featureId)
        ?.geometry.bodies?.find(({ outputRole }) => outputRole === body.outputRole)
    : undefined
  const shape = rawBody?.shape
  if (!shape?.valid || shape.volume <= 0 || shape.solidCount !== 1) return []
  const { evidence } = result
  const project = createBodyTopologyReferenceProjector(evidence)
  const resolve = createBodyTopologyReferenceResolver(evidence)
  const context = JSON.stringify([
    evidence.documentId,
    evidence.revision,
    evidence.generation,
    evidence.rebuildId,
  ])
  return evidence.candidates.flatMap((candidate) => {
    const { signature } = candidate
    if (
      signature.geometryClass !== "PLANE" ||
      signature.directionMode !== "oriented" ||
      !signature.direction
    )
      return []
    const reference = project(candidate)
    const resolved = resolve(reference)
    if (resolved.status !== "resolved" || resolved.candidateId !== candidate.candidateId) return []
    return [
      {
        key: JSON.stringify([context, body, evidence.contentHash, candidate.candidateId]),
        context,
        candidateId: candidate.candidateId,
        meshFaceId: rawBody?.topologyCandidates.find(
          ({ candidateId }) => candidateId === candidate.candidateId,
        )?.meshFaceId,
        reference,
        bodyName,
        center: signature.centroid,
        normal: signature.direction,
      },
    ]
  })
}

/** Face references and candidate IDs are disposable inspection state, never Placement parameters. */
export function placementAlignmentFaces(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  source: BodyReference,
  parts: readonly ResolvedAuthoredPart[],
): PlacementAlignmentFaces {
  const sourcePart = parts.find(({ part }) =>
    part.bodyHistory.some((body) => sameBody(body, source)),
  )?.part
  const sourceName =
    sourcePart?.name ?? snapshot.features.find(({ id }) => id === source.featureId)?.label ?? ""
  return {
    source: bodyFaces(snapshot, rebuild, source, sourceName),
    targets: parts.flatMap((resolved) => {
      const reference = authoredPlacementTarget(resolved)
      if (!reference || resolved.part.id === sourcePart?.id || sameBody(reference, source))
        return []
      return bodyFaces(snapshot, rebuild, reference, resolved.part.name)
    }),
  }
}

export function selectedAlignmentFace(
  faces: readonly PlacementAlignmentFace[],
  selection: ViewerSelection | null | undefined,
) {
  if (!selection) return null
  const matches = faces.filter(
    ({ reference, meshFaceId }) =>
      reference.featureId === selection.featureId &&
      reference.outputRole === (selection.outputRole ?? "result") &&
      meshFaceId === selection.faceId,
  )
  return matches.length === 1 ? (matches[0] ?? null) : null
}

function dot(a: Vector3, b: Vector3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function cross(a: Vector3, b: Vector3): Vector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function finiteUnitVector(vector: Vector3) {
  return vector.every(Number.isFinite) && Math.abs(Math.hypot(...vector) - 1) <= 1e-6
}

function alignmentMatrix(from: Vector3, to: Vector3) {
  let [x, y, z] = cross(from, to)
  let w = 1 + Math.min(1, Math.max(-1, dot(from, to)))
  if (w < Number.EPSILON) {
    // A half turn has no unique shortest axis. Choose a deterministic perpendicular axis.
    const axis =
      Math.abs(from[0]) > Math.abs(from[2])
        ? ([-from[1], from[0], 0] as const)
        : ([0, -from[2], from[1]] as const)
    ;[x, y, z] = axis
    w = 0
  }
  const magnitude = Math.hypot(x, y, z, w)
  ;[x, y, z, w] = [x / magnitude, y / magnitude, z / magnitude, w / magnitude]
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ] as const
}

/** Frozen world-origin Rx, Ry, Rz then translation, matching Placement schema version 1. */
export function calculateFaceAlignment(
  source: PlacementAlignmentFace,
  target: PlacementAlignmentFace,
  orientation: FaceAlignmentOrientation,
  offset: number,
): { translation: Vector3; rotation: Vector3 } | null {
  if (
    source.context !== target.context ||
    (source.reference.featureId === target.reference.featureId &&
      source.reference.outputRole === target.reference.outputRole) ||
    !finiteUnitVector(source.normal) ||
    !finiteUnitVector(target.normal) ||
    !source.center.every(Number.isFinite) ||
    !target.center.every(Number.isFinite) ||
    !Number.isFinite(offset)
  )
    return null
  const direction: Vector3 = target.normal.map((v) => (orientation === "opposed" ? -v : v)) as [
    number,
    number,
    number,
  ]
  const matrix = alignmentMatrix(source.normal, direction)
  const horizontal = Math.hypot(matrix[0][0], matrix[1][0])
  const y = Math.atan2(-matrix[2][0], horizontal)
  const locked = horizontal < 1e-12
  const rotation: Vector3 = [
    locked ? 0 : Math.atan2(matrix[2][1], matrix[2][2]),
    y,
    locked ? Math.atan2(-matrix[0][1], matrix[1][1]) : Math.atan2(matrix[1][0], matrix[0][0]),
  ]
  const translation: Vector3 = matrix.map(
    (row, axis) =>
      (target.center[axis] as number) +
      offset * (target.normal[axis] as number) -
      dot(row, source.center),
  ) as [number, number, number]
  return translation.every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000)
    ? { translation, rotation }
    : null
}
