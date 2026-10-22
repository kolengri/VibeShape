import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import { resolveShellOpeningCandidates } from "@vibeshape/application/shell-opening-resolution"
import { type BodyReference, bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"
import { createBodyTopologyReferenceProjector } from "@vibeshape/domain/model-body-topology"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../../document/document-controller"
import type { ModelBodyGeometry } from "../part-design/model-bodies"
import { terminalModelBodies } from "../part-design/model-bodies"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"

type Report = NonNullable<DocumentControllerState["report"]>
type RebuiltReport = Report & { rebuild: Extract<Report["rebuild"], { ok: true }> }
function isExactSolid(body: ModelBodyGeometry | null | undefined) {
  return (
    body?.representation !== "triangle-mesh" &&
    body?.shape.valid &&
    body.shape.solidCount === 1 &&
    body.shape.volume > 0
  )
}
function selectedExactBody(
  report: RebuiltReport,
  selection: ViewerSelection,
): BodyReference | null {
  const outputRole = selection.outputRole ?? "result"
  const terminal = terminalModelBodies(report.snapshot.features, report.rebuild.response) ?? []
  const matches = terminal.filter(
    ({ geometry }) =>
      geometry.featureId === selection.featureId &&
      (geometry.outputRole ?? "result") === outputRole,
  )
  const body = matches.length === 1 ? matches[0]?.geometry : null
  return isExactSolid(body)
    ? bodyReferenceSchema.parse({ schemaVersion: 0, featureId: selection.featureId, outputRole })
    : null
}
function pickedFaceCandidateId(report: RebuiltReport, target: BodyReference, faceId: number) {
  const feature = report.rebuild.response.geometry.find(
    ({ featureId }) => featureId === target.featureId,
  )
  const body = feature?.geometry.bodies?.find(({ outputRole }) => outputRole === target.outputRole)
  const picked = body?.topologyCandidates.filter(
    (candidate) => candidate.kind === "face" && candidate.meshFaceId === faceId,
  )
  return picked?.length === 1 ? picked[0]?.candidateId : undefined
}
function resolvePlanarFace(
  evidence: ModelBodyTopologyEvidence,
  candidateId: string | undefined,
  targetBody: BodyReference,
) {
  const candidate = evidence.candidates.find((candidate) => candidate.candidateId === candidateId)
  if (candidate?.signature.geometryClass !== "PLANE") return null
  const face = bodyFaceRefSchema.parse(createBodyTopologyReferenceProjector(evidence)(candidate))
  const { featureId: _featureId, ...contentFace } = face
  const resolution = resolveShellOpeningCandidates(
    [contentFace],
    evidence.candidates,
    targetBody,
    "exact",
    { allowSemanticRebinding: false },
  )
  return resolution.ok && resolution.candidateIds[0] === candidate.candidateId ? face : null
}
/** Capture the current pick into durable parameters; mesh/native face IDs never enter a feature. */
export function pressPullToolFromSelection(
  report: Report | null,
  selection: ViewerSelection | null | undefined,
): Extract<ActivePartDesignTool, { kind: "create-press-pull" }> | null {
  if (!report || !selection || report.mode === "read-only" || !report.rebuild.ok) return null
  const rebuilt = { ...report, rebuild: report.rebuild }
  const targetBody = selectedExactBody(rebuilt, selection)
  if (!targetBody) return null
  const result = createModelBodyTopologyEvidence(report.snapshot, report.rebuild, {
    ...targetBody,
    kind: "face",
  })
  if (!result.ok) return null
  const candidateId = pickedFaceCandidateId(rebuilt, targetBody, selection.faceId)
  const face = resolvePlanarFace(result.evidence, candidateId, targetBody)
  if (!face) return null
  return {
    kind: "create-press-pull",
    targetBody,
    face,
    sourceContentHash: result.evidence.contentHash,
  }
}
