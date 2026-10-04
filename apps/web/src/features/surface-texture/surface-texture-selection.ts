import { projectSurfaceTextureFaceReference } from "@vibeshape/application/surface-textures"
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
  const reference = projectSurfaceTextureFaceReference(report, {
    featureId: selection.featureId as SurfaceTextureLayer["featureId"],
    outputRole: selection.outputRole ?? "result",
    meshFaceId: selection.faceId,
  })
  const parsed = surfaceTextureFaceRefSchema.safeParse(reference)
  return parsed.success ? parsed.data : null
}
