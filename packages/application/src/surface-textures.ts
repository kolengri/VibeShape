import {
  createBodyTopologyReferenceProjector,
  createBodyTopologyReferenceResolver,
} from "@vibeshape/domain/model-body-topology"
import {
  type SurfaceTextureLayer,
  surfaceTextureLayerSchema,
} from "@vibeshape/domain/surface-textures"
import {
  type SurfaceTextureMesh,
  type SurfaceTextureMeshLayer,
  surfaceTextureMeshLayerSchema,
  surfaceTextureMeshSchema,
} from "@vibeshape/protocol"
import { createModelBodyTopologyEvidence } from "./model-body-topology"
import type { PersistentDocumentSessionReport } from "./persistent-document-session"

type TextureSourceReport = Pick<PersistentDocumentSessionReport, "snapshot" | "rebuild">
function sourceTextureBody(report: TextureSourceReport, featureId: string, outputRole: string) {
  if (!report.rebuild.ok) return null
  const bodies = report.rebuild.response.geometry
    .filter((record) => record.featureId === featureId)
    .flatMap((record) => record.geometry.bodies ?? [])
    .filter((body) => body.outputRole === outputRole)
  return bodies.length === 1 ? bodies[0] : null
}

/** Mesh picks are transient; persist the semantic candidate from the exact current body. */
export function projectSurfaceTextureFaceReference(
  report: TextureSourceReport,
  target: Readonly<{
    featureId: SurfaceTextureLayer["featureId"]
    outputRole: string
    meshFaceId: number
  }>,
) {
  const evidence = createModelBodyTopologyEvidence(report.snapshot, report.rebuild, {
    ...target,
    kind: "face",
  })
  if (!evidence.ok) return null
  const matches = sourceTextureBody(
    report,
    target.featureId,
    target.outputRole,
  )?.topologyCandidates.filter(
    (candidate) => candidate.kind === "face" && candidate.meshFaceId === target.meshFaceId,
  )
  if (matches?.length !== 1) return null
  const candidate = evidence.evidence.candidates.find(
    ({ candidateId }) => candidateId === matches[0]?.candidateId,
  )
  return candidate ? createBodyTopologyReferenceProjector(evidence.evidence)(candidate) : null
}

/** Resolve authored face intent against the exact source revision before crossing the worker boundary. */
export function resolveSurfaceTextureMeshLayer(
  report: TextureSourceReport,
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
    const body = sourceTextureBody(report, featureId, target.outputRole)
    targetFaceIds = target.refs.map((reference) => {
      const resolved = resolve(reference)
      if (resolved.status !== "resolved")
        throw new Error("A textured surface is missing or ambiguous. Select its replacement.")
      const candidate = body?.topologyCandidates.find(
        (value) => value.kind === "face" && value.candidateId === resolved.candidateId,
      )
      if (candidate?.meshFaceId === undefined)
        throw new Error("The textured surface cannot be mapped to the current mesh.")
      return candidate.meshFaceId
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

export type SurfaceTexturePreviewSource = Readonly<{
  featureId: string
  outputRole?: string | undefined
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  triangleFaceIds: Uint32Array
}>
export type SurfaceTexturePreviewCancellation = Readonly<{
  aborted: boolean
  addEventListener: (type: "abort", listener: () => void) => void
  removeEventListener: (type: "abort", listener: () => void) => void
}>
export type SurfaceTextureReliefWorker = Readonly<{
  preview: (
    context: Readonly<{
      documentId: string
      revision: number
      featureId: string
      outputRole: string
    }>,
    mesh: SurfaceTextureMesh,
    layers: readonly SurfaceTextureMeshLayer[],
  ) => Promise<SurfaceTextureMesh>
  terminate: () => void
}>

/** UI and automation use the same exact topology resolution and copied worker inputs. */
export async function previewSurfaceTextureRelief<
  Source extends SurfaceTexturePreviewSource,
>(input: {
  report: Pick<PersistentDocumentSessionReport, "snapshot" | "rebuild">
  layers: readonly SurfaceTextureLayer[]
  sources: readonly Source[]
  requiredLayers?: readonly SurfaceTextureLayer[] | undefined
  createWorker: () => SurfaceTextureReliefWorker
  signal?: SurfaceTexturePreviewCancellation | undefined
}): Promise<readonly { source: Source; mesh: SurfaceTextureMesh }[]> {
  const { report, layers, sources, signal } = input
  if (signal?.aborted) throw new Error("The surface texture preview was cancelled.")
  const byBody = new Map(
    sources.map((source) => [`${source.featureId}:${source.outputRole ?? "result"}`, source]),
  )
  if (byBody.size !== sources.length)
    throw new Error("Surface texture source bodies are ambiguous.")
  if (
    input.requiredLayers?.some(
      (layer) => layer.enabled && !byBody.has(`${layer.featureId}:${layer.target.outputRole}`),
    )
  )
    throw new Error("Show the textured body or choose a current body before previewing its relief.")
  const groups = resolveSurfaceTextureExportLayers(report, layers, sources)
  if (!groups.length) return []
  const worker = input.createWorker()
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    worker.terminate()
  }
  let rejectCancelled: (error: Error) => void = () => undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject
  })
  const onAbort = () => {
    dispose()
    rejectCancelled(new Error("The surface texture preview was cancelled."))
  }
  signal?.addEventListener("abort", onAbort)
  try {
    if (signal?.aborted) onAbort()
    const previews = Promise.all(
      groups.map(async (group) => {
        const source = byBody.get(`${group.featureId}:${group.outputRole}`)
        if (!source) throw new Error("Surface texture source is unavailable.")
        const mesh = surfaceTextureMeshSchema.parse({
          positions: new Float32Array(source.positions),
          normals: new Float32Array(source.normals),
          indices: new Uint32Array(source.indices),
          triangleFaceIds: new Uint32Array(source.triangleFaceIds),
        })
        const previewed = await worker.preview(
          {
            documentId: report.snapshot.id,
            revision: report.snapshot.revision,
            featureId: group.featureId,
            outputRole: group.outputRole,
          },
          mesh,
          group.layers,
        )
        return { source, mesh: surfaceTextureMeshSchema.parse(previewed) }
      }),
    )
    return await Promise.race([previews, cancelled])
  } finally {
    signal?.removeEventListener("abort", onAbort)
    dispose()
  }
}
