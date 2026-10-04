import type { SurfaceTextureReliefWorker } from "@vibeshape/application/surface-textures"
import {
  createGeometryRequestEnvelope,
  GeometryWorkerClient,
} from "@vibeshape/geometry-worker/client"
import { DEFAULT_SURFACE_TEXTURE_QUALITY } from "@vibeshape/protocol"

export function createSurfaceTexturePreviewWorker(): SurfaceTextureReliefWorker {
  const client = new GeometryWorkerClient()
  return {
    async preview(context, mesh, layers) {
      const response = await client.previewSurfaceTextureMesh(
        createGeometryRequestEnvelope(
          `${context.documentId}:texture:${context.featureId}:${context.outputRole}`,
          context.revision,
          context.revision,
        ),
        mesh,
        layers,
        DEFAULT_SURFACE_TEXTURE_QUALITY,
      )
      return response.mesh
    },
    terminate: () => client.terminate(),
  }
}
