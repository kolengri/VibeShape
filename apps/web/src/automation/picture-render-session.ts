import {
  createDisposableDocumentPreview,
  type DisposableDocumentPreview,
} from "@vibeshape/application/disposable-document-preview"
import { BINARY_EXPORT_MAX_BYTES } from "@vibeshape/automation-api/binary-exports"
import { preparePictureRenderArgumentsSchema } from "@vibeshape/automation-api/derived-reads"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import { canonicalJson } from "@vibeshape/domain"
import { sha256Text } from "@vibeshape/persistence"
import type { SourceAssetMaterialization } from "@vibeshape/protocol"
import { renderPicture } from "@vibeshape/viewer/picture-render"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import type { z } from "zod"
import { PRODUCT_MESH_POLICY } from "../document/document-worker-settings"
import { BinaryExportPreparationError, type PreparedPictureFile } from "./binary-export-session"
import {
  assertPictureRepresentation,
  type PictureRenderSource,
  pictureSourceMatches,
  projectPictureMeshes,
} from "./picture-render-source"

type Request = z.infer<typeof preparePictureRenderArgumentsSchema>
function renderRequest(meshes: readonly ViewerMesh[], request: Request) {
  const camera = request.camera
  if (!camera) return { meshes, settings: request.settings }
  return {
    meshes,
    settings: request.settings,
    camera: {
      position: camera.position,
      target: camera.target,
      ...(camera.up ? { up: camera.up } : {}),
      ...(camera.viewHeightMm ? { viewHeightMm: camera.viewHeightMm } : {}),
    },
  }
}
function validatePng(output: Awaited<ReturnType<typeof renderPicture>>, request: Request) {
  if (output.blob.size > BINARY_EXPORT_MAX_BYTES)
    throw new BinaryExportPreparationError(
      "export-too-large",
      "Prepared pictures must contain at most 6 MiB.",
    )
  if (
    output.mimeType !== "image/png" ||
    output.blob.type !== "image/png" ||
    output.width !== request.settings.width ||
    output.height !== request.settings.height
  )
    throw new Error("The renderer returned an inconsistent PNG.")
}
function validateFinishes(meshes: readonly ViewerMesh[], request: Request) {
  const keys = new Set(
    meshes.map((mesh) =>
      mesh.outputRole === undefined ? mesh.featureId : `${mesh.featureId}\u0000${mesh.outputRole}`,
    ),
  )
  if (Object.keys(request.settings.finishes).some((key) => !keys.has(key)))
    throw new BinaryExportPreparationError(
      "picture-target-unavailable",
      "A finish targets an unavailable visible body.",
    )
}
async function rebuildMeshes(
  preview: DisposableDocumentPreview,
  source: PictureRenderSource,
  isCurrent: () => boolean,
) {
  assertPictureRepresentation(source.authority)
  const rebuilt = await preview.preview(source.snapshot)
  if (!isCurrent() || !rebuilt.ok) return null
  if (!rebuilt.valid || !rebuilt.rebuild) return null
  return projectPictureMeshes(source, rebuilt.rebuild)
}
export function createPictureRenderSession(options: {
  documentId: string
  capture: () => PictureRenderSource | null
  materializeSourceAssets: (document: unknown) => Promise<readonly SourceAssetMaterialization[]>
  preview?: DisposableDocumentPreview
  render?: typeof renderPicture
}) {
  const preview =
    options.preview ??
    createDisposableDocumentPreview({
      retainRebuild: true,
      mesh: PRODUCT_MESH_POLICY,
      createRebuildPort: (documentId) =>
        createDocumentWorkerSession(documentId, {
          materializeSourceAssets: options.materializeSourceAssets,
        }),
    })
  let epoch = 0,
    closed = false,
    pending: AbortController | null = null
  function begin(source: PictureRenderSource, signal: AbortSignal) {
    const signature = canonicalJson(source.authority),
      operationEpoch = epoch,
      abort = new AbortController()
    pending = abort
    const cancel = () => {
      abort.abort()
      preview.cancel()
    }
    const timer = setTimeout(cancel, 120_000)
    signal.addEventListener("abort", cancel, { once: true })
    if (signal.aborted) cancel()
    const isCurrent = () => {
      const current = options.capture()
      if (closed || epoch !== operationEpoch || abort.signal.aborted) return false
      return (
        pictureSourceMatches(current, options.documentId, source.snapshot.revision) &&
        canonicalJson(current.authority) === signature
      )
    }
    return {
      signature,
      abort,
      isCurrent,
      finish() {
        clearTimeout(timer)
        signal.removeEventListener("abort", cancel)
        if (pending === abort) pending = null
      },
    }
  }
  async function renderFile(
    meshes: readonly ViewerMesh[],
    request: Request,
    control: ReturnType<typeof begin>,
  ) {
    validateFinishes(meshes, request)
    const output = await (options.render ?? renderPicture)(renderRequest(meshes, request), {
      signal: control.abort.signal,
      isCurrent: control.isCurrent,
    })
    if (!control.isCurrent()) return null
    validatePng(output, request)
    const file = new Uint8Array(await output.blob.arrayBuffer())
    return control.isCurrent() ? file : null
  }
  return {
    async prepare(raw: Request, signal: AbortSignal): Promise<PreparedPictureFile | { ok: false }> {
      const request = preparePictureRenderArgumentsSchema.parse(raw),
        source = options.capture()
      if (closed || pending || !pictureSourceMatches(source, options.documentId, request.revision))
        return { ok: false }
      const captured = {
        snapshot: structuredClone(source.snapshot),
        authority: structuredClone(source.authority),
        report: source.report,
      }
      const control = begin(captured, signal)
      try {
        const meshes = await rebuildMeshes(preview, captured, control.isCurrent)
        if (!meshes) return { ok: false }
        const sourceDigest = await sha256Text(control.signature)
        if (!control.isCurrent()) return { ok: false }
        const file = await renderFile(meshes, request, control)
        if (!file) return { ok: false }
        return {
          ok: true,
          documentId: options.documentId,
          revision: request.revision,
          format: "png",
          file,
          isCurrent: control.isCurrent,
          metadata: {
            settings: request.settings,
            ...(request.camera ? { camera: request.camera } : {}),
            sourceDigest,
          },
        }
      } finally {
        control.finish()
      }
    },
    cancel() {
      epoch++
      pending?.abort()
      preview.cancel()
    },
    dispose() {
      closed = true
      epoch++
      pending?.abort()
      preview.dispose()
    },
  }
}
