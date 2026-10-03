import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import { createBodyTopologyReferenceProjector } from "@vibeshape/domain/model-body-topology"
import {
  type SurfaceTextureLayer,
  surfaceTextureFaceRefSchema,
} from "@vibeshape/domain/surface-textures"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../../document/document-controller"

export function textureFaceReference(
  controller: DocumentControllerState,
  selection: ViewerSelection,
) {
  const report = controller.report
  if (!report) return null
  const result = createModelBodyTopologyEvidence(report.snapshot, report.rebuild, {
    featureId: selection.featureId as SurfaceTextureLayer["featureId"],
    outputRole: selection.outputRole ?? "result",
    kind: "face",
  })
  if (!result.ok) return null
  const candidate = result.evidence.candidates.find(
    ({ candidateId }) => candidateId === `face:${selection.faceId}`,
  )
  if (!candidate) return null
  const parsed = surfaceTextureFaceRefSchema.safeParse(
    createBodyTopologyReferenceProjector(result.evidence)(candidate),
  )
  return parsed.success ? parsed.data : null
}
