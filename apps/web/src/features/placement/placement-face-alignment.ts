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

export {
  calculateFaceAlignment,
  type FaceAlignmentOrientation,
} from "@vibeshape/application/face-alignment"

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
