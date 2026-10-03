import { createBodyTopologyReferenceResolver } from "@vibeshape/domain/model-body-topology"
import {
  type SurfaceTextureLayer,
  surfaceTextureLayerSchema,
} from "@vibeshape/domain/surface-textures"
import { type SurfaceTextureMeshLayer, surfaceTextureMeshLayerSchema } from "@vibeshape/protocol"
import { createModelBodyTopologyEvidence } from "./model-body-topology"
import type { PersistentDocumentSessionReport } from "./persistent-document-session"

/** Resolve authored face intent against the exact source revision before crossing the worker boundary. */
export function resolveSurfaceTextureMeshLayer(
  report: Pick<PersistentDocumentSessionReport, "snapshot" | "rebuild">,
  input: SurfaceTextureLayer,
): SurfaceTextureMeshLayer {
  const layer = surfaceTextureLayerSchema.parse(input)
  const { featureId, target, ...settings } = layer
  let targetFaceIds: number[] | null = null
  if (target.kind === "faces") {
    const evidence = createModelBodyTopologyEvidence(report.snapshot, report.rebuild, {
      featureId,
      outputRole: target.outputRole,
      kind: "face",
    })
    if (!evidence.ok) throw new Error("Surface texture source geometry is unavailable.")
    const resolve = createBodyTopologyReferenceResolver(evidence.evidence)
    targetFaceIds = target.refs.map((reference) => {
      const resolved = resolve(reference)
      if (resolved.status !== "resolved")
        throw new Error("A textured surface is missing or ambiguous. Select its replacement.")
      const match = /^face:(\d+)$/.exec(resolved.candidateId)
      if (!match) throw new Error("The textured surface cannot be mapped to the current mesh.")
      return Number(match[1])
    })
  }
  return surfaceTextureMeshLayerSchema.parse({ ...settings, targetFaceIds })
}

export type ResolvedSurfaceTextureBody = Readonly<{
  featureId: string
  outputRole: string
  layers: readonly SurfaceTextureMeshLayer[]
}>

export function resolveSurfaceTextureExportLayers(
  report: Pick<PersistentDocumentSessionReport, "snapshot" | "rebuild">,
  layers: readonly SurfaceTextureLayer[],
  bodies?: readonly { featureId: string; outputRole?: string | undefined }[],
): readonly ResolvedSurfaceTextureBody[] {
  const selected = bodies
    ? new Set(bodies.map((body) => `${body.featureId}:${body.outputRole ?? "result"}`))
    : null
  const groups = new Map<
    string,
    { featureId: string; outputRole: string; layers: SurfaceTextureMeshLayer[] }
  >()
  for (const layer of layers) {
    const key = `${layer.featureId}:${layer.target.outputRole}`
    if (!layer.enabled || (selected && !selected.has(key))) continue
    const group = groups.get(key) ?? {
      featureId: layer.featureId,
      outputRole: layer.target.outputRole,
      layers: [],
    }
    group.layers.push(resolveSurfaceTextureMeshLayer(report, layer))
    groups.set(key, group)
  }
  return [...groups.values()]
}
