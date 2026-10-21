import type { DisposableDocumentPreview } from "@vibeshape/application/disposable-document-preview"
import {
  type RenderPreviewArguments,
  type RenderPreviewResult,
  renderPreviewArgumentsSchema,
  renderPreviewResultContextMatches,
  renderPreviewResultSchema,
} from "@vibeshape/automation-api/render-preview"
import type {
  AutomationDocumentPort,
  AutomationHostDiagnosticCode,
  AutomationHostResult,
} from "@vibeshape/automation-host/host"
import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import type { ModelPreviewOptions, renderModelPreview } from "@vibeshape/viewer/model-preview"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { terminalModelBodies } from "../features/part-design/model-bodies"

type ModelPreview = Extract<RenderPreviewResult, { source: "model" }>
type PreviewOptions = Pick<RenderPreviewArguments, "quality" | "views" | "target" | "camera">
type SuccessfulRebuild = Extract<
  Awaited<ReturnType<DisposableDocumentPreview["preview"]>>,
  { ok: true }
>

function failure(code: AutomationHostDiagnosticCode, message: string, retryable = false) {
  return { ok: false as const, diagnostic: { code, message, retryable, issues: [] } }
}

function previewMeshes(
  snapshot: DocumentSnapshot,
  result: SuccessfulRebuild,
  target: PreviewOptions["target"],
): readonly ViewerMesh[] | null {
  const rebuild = result.rebuild
  if (!rebuild) return null
  const bodies = target
    ? rebuild.geometry
        .filter(({ featureId }) => featureId === target.featureId)
        .flatMap(({ featureId, geometry }) =>
          (geometry.bodies?.length ? geometry.bodies : [geometry]).map((body) => ({
            featureId,
            outputRole: "outputRole" in body ? body.outputRole : undefined,
            representation: body.representation,
            shape: body.shape,
            mesh: body.mesh,
          })),
        )
        .filter((body) => (body.outputRole ?? "result") === target.outputRole)
    : terminalModelBodies(snapshot.features, rebuild)?.map(({ geometry }) => geometry)
  if (!bodies) return null
  const datumIds = new Set<string>(
    snapshot.features
      .filter((feature) => readDatumPlaneFeatureParameters(feature))
      .map(({ id }) => id),
  )
  return bodies
    .filter(
      (body) =>
        !datumIds.has(body.featureId) &&
        body.shape.valid &&
        (body.representation === "triangle-mesh" ||
          (body.shape.solidCount > 0 && body.shape.volume > 0)),
    )
    .map(({ featureId, outputRole, mesh }) => ({
      ...mesh,
      featureId,
      ...(outputRole === undefined ? {} : { outputRole }),
    }))
}

function renderableMeshes(
  snapshot: DocumentSnapshot,
  rebuilt: SuccessfulRebuild,
  target: PreviewOptions["target"],
) {
  const meshes = previewMeshes(snapshot, rebuilt, target)
  if (!meshes)
    return failure("invalid-geometry-evidence", "The complete model body catalog is unavailable.")
  if (!meshes.length)
    return failure(
      target ? "body-not-found" : "geometry-unavailable",
      target ? "The exact requested body is unavailable." : "The model has no renderable bodies.",
    )
  return { ok: true as const, meshes }
}

function renderedEvidence(
  snapshot: DocumentSnapshot,
  rebuilt: SuccessfulRebuild,
  options: PreviewOptions,
  bodyCount: number,
  image: Awaited<ReturnType<typeof renderModelPreview>>,
): AutomationHostResult<ModelPreview> {
  const parsed = renderPreviewResultSchema.safeParse({
    source: "model",
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: rebuilt.evidence.generation,
    geometryStatus: rebuilt.valid ? "valid" : "invalid",
    bodyCount,
    quality: options.quality ?? "overview",
    ...(options.target ? { target: options.target } : {}),
    ...(options.camera ? { camera: options.camera } : {}),
    image,
  })
  if (!parsed.success || parsed.data.source !== "model")
    return failure("invalid-geometry-evidence", "The renderer returned an invalid preview image.")
  const result = { ok: true as const, value: parsed.data }
  const operation = {
    tool: "render_preview",
    arguments: { source: "model", revision: snapshot.revision, ...options },
  }
  return renderPreviewResultContextMatches(operation, result, snapshot.id)
    ? result
    : failure(
        "invalid-geometry-evidence",
        "The renderer returned an image for another preview request.",
      )
}

function rebuildFailure(
  code: Extract<Awaited<ReturnType<DisposableDocumentPreview["preview"]>>, { ok: false }>["code"],
) {
  return failure(
    code === "stale-geometry" || code === "invalid-geometry-evidence"
      ? code
      : "geometry-unavailable",
    "The preview geometry could not be rebuilt.",
    true,
  )
}

function viewerOptions(options: PreviewOptions): ModelPreviewOptions {
  const camera = options.camera
  return {
    quality: options.quality ?? "overview",
    ...(options.views ? { views: options.views } : {}),
    ...(camera
      ? {
          camera: {
            position: camera.position,
            target: camera.target,
            ...(camera.up ? { up: camera.up } : {}),
            ...(camera.viewHeightMm === undefined ? {} : { viewHeightMm: camera.viewHeightMm }),
          },
        }
      : {}),
  }
}

/** Owns isolated rebuilds and never touches the user's viewport or document history. */
export function createModelPreviewSession(
  input: Readonly<{
    documents: AutomationDocumentPort
    preview: DisposableDocumentPreview
    render: typeof renderModelPreview
    unsupportedRepresentation?: (target: PreviewOptions["target"]) => string | null
  }>,
) {
  let closed = false
  let epoch = 0
  function unavailable(operationEpoch: number, signal?: Readonly<{ aborted: boolean }>) {
    if (signal?.aborted || operationEpoch !== epoch)
      return failure("request-cancelled", "The preview request was cancelled.", true)
    if (closed) return failure("geometry-unavailable", "The automation session is closed.")
    return null
  }
  async function prepareGeometry(
    snapshot: DocumentSnapshot,
    options: PreviewOptions,
    operationEpoch: number,
    signal?: Readonly<{ aborted: boolean }>,
  ) {
    const unsupported = input.unsupportedRepresentation?.(options.target)
    if (unsupported) return failure("preview-representation-unsupported", unsupported)
    const rebuilt = await input.preview.preview(snapshot)
    const cancelled = unavailable(operationEpoch, signal)
    if (cancelled) return cancelled
    if (!rebuilt.ok) return rebuildFailure(rebuilt.code)
    const bodies = renderableMeshes(snapshot, rebuilt, options.target)
    return bodies.ok ? { ok: true as const, meshes: bodies.meshes, rebuilt } : bodies
  }
  async function renderSnapshot(
    snapshot: DocumentSnapshot,
    options: PreviewOptions,
    signal?: Readonly<{ aborted: boolean }>,
  ): Promise<AutomationHostResult<ModelPreview>> {
    const operationEpoch = ++epoch
    const requestedOptions: PreviewOptions = { ...options, quality: options.quality ?? "overview" }
    input.preview.cancel()
    try {
      const inactive = unavailable(operationEpoch, signal)
      if (inactive) return inactive
      const bodies = await prepareGeometry(snapshot, requestedOptions, operationEpoch, signal)
      if (!bodies.ok) return bodies
      const image = await input.render(bodies.meshes, viewerOptions(requestedOptions))
      const encoded = unavailable(operationEpoch, signal)
      if (encoded) return encoded
      return renderedEvidence(
        snapshot,
        bodies.rebuilt,
        requestedOptions,
        bodies.meshes.length,
        image,
      )
    } catch {
      return (
        unavailable(operationEpoch, signal) ??
        failure("geometry-unavailable", "The model preview could not be rendered.", true)
      )
    }
  }
  async function publishCommitted(
    rendered: AutomationHostResult<ModelPreview>,
    snapshot: DocumentSnapshot,
    operationEpoch: number,
    signal?: Readonly<{ aborted: boolean }>,
  ): Promise<AutomationHostResult<ModelPreview>> {
    const finished = unavailable(operationEpoch, signal)
    if (finished) return finished
    if (!rendered.ok) return rendered
    const after = await readRevision(snapshot.id, snapshot.revision)
    const encoded = unavailable(operationEpoch, signal)
    if (encoded) return encoded
    return after.ok
      ? rendered
      : failure(
          "stale-query-revision",
          "The active document changed while rendering the preview.",
          true,
        )
  }
  async function readRevision(documentId: DocumentSnapshot["id"], revision: number) {
    const parsed = documentSnapshotSchema.safeParse(await input.documents.readSnapshot(documentId))
    if (!parsed.success) return failure("document-not-found", "The paired document is unavailable.")
    if (parsed.data.id !== documentId || parsed.data.revision !== revision)
      return failure("stale-query-revision", "The requested document revision changed.", true)
    return { ok: true as const, snapshot: parsed.data }
  }
  async function read(
    documentId: DocumentSnapshot["id"],
    request: RenderPreviewArguments,
    signal?: AbortSignal,
  ): Promise<AutomationHostResult<ModelPreview>> {
    const operationEpoch = epoch
    const parsed = renderPreviewArgumentsSchema.safeParse(request)
    if (!parsed.success || parsed.data.source !== "model")
      return failure("invalid-query", "The committed preview request is invalid.")
    try {
      const inactive = unavailable(operationEpoch, signal)
      if (inactive) return inactive
      const before = await readRevision(documentId, parsed.data.revision)
      const cancelled = unavailable(operationEpoch, signal)
      if (cancelled) return cancelled
      if (!before.ok) return before
      const rendering = renderSnapshot(before.snapshot, parsed.data, signal)
      const renderedEpoch = epoch
      const rendered = await rendering
      return publishCommitted(rendered, before.snapshot, renderedEpoch, signal)
    } catch {
      return failure("geometry-unavailable", "The paired document could not be read.", true)
    }
  }
  return {
    read,
    renderSnapshot,
    cancel() {
      epoch++
      input.preview.cancel()
    },
    dispose() {
      closed = true
      epoch++
      input.preview.dispose()
    },
  }
}
