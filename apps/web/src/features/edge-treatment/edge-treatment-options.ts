import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import {
  createModelBodyTopologyEvidenceResolver,
  type ModelBodyTopologyEvidenceResolver,
} from "@vibeshape/application/model-body-topology"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { DocumentSnapshot } from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"
import { exactSolidBodyOptions } from "../part-design/exact-body-options"

export type EdgeTreatmentTargetOption = Readonly<{
  id: string
  label: string
  body?: BodyReference
  legacy?: boolean
  edgeEvidence?: ModelBodyTopologyEvidence
  faceEvidence?: ModelBodyTopologyEvidence
}>

export function edgeTreatmentOptionOwner(option: EdgeTreatmentTargetOption | undefined) {
  return option?.body?.featureId ?? option?.id
}

export function edgeTreatmentRequiresV3(option: EdgeTreatmentTargetOption | undefined) {
  if (!option?.body) return false
  return option.legacy === false || option.body.outputRole !== "result"
}

function targetTopologyEvidence(
  resolve: ModelBodyTopologyEvidenceResolver,
  body: BodyReference,
  kind: "edge" | "face" | undefined,
) {
  const edges = kind === "face" ? null : resolve({ ...body, kind: "edge" })
  const faces = kind === "edge" ? null : resolve({ ...body, kind: "face" })
  return {
    ...(edges?.ok ? { edgeEvidence: edges.evidence } : {}),
    ...(faces?.ok ? { faceEvidence: faces.evidence } : {}),
  }
}

export function edgeTreatmentTargetOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  editingId: string | undefined,
  parts: readonly ResolvedAuthoredPart[],
  unnamed: string,
  operation: "fillet" | "chamfer",
  kind?: "edge" | "face",
): readonly EdgeTreatmentTargetOption[] {
  if (!rebuild.ok) return []
  const resolve = createModelBodyTopologyEvidenceResolver(snapshot, rebuild)
  return exactSolidBodyOptions(snapshot, rebuild, editingId, parts, unnamed).flatMap((option) => {
    if (!option.body) return []
    const body = option.body
    const source = rebuild.response.geometry.find(({ featureId }) => featureId === body.featureId)
    const legacy = body.outputRole === "result" && source?.geometry.bodies?.length === 1
    if (operation === "fillet" && !legacy) return []
    return [
      {
        ...option,
        id: legacy ? body.featureId : option.id,
        body,
        legacy,
        ...targetTopologyEvidence(resolve, body, kind),
      },
    ]
  })
}
