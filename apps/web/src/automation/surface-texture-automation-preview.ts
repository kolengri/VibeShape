import { previewSurfaceTextureRelief } from "@vibeshape/application/surface-textures"
import { surfaceTexturePreviewEvidenceSchema } from "@vibeshape/automation-api/surface-texture-tools"
import type { SurfaceTextureReviewedInput } from "@vibeshape/automation-host/surface-texture-proposal-contract"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { commandActorsEqual } from "@vibeshape/domain/commands"
import type { SurfaceTextureLayer } from "@vibeshape/domain/surface-textures"
import type { DocumentControllerState } from "../document/document-controller"
import { terminalModelBodies } from "../features/part-design/model-bodies"
import { createSurfaceTexturePreviewWorker } from "../features/surface-texture/surface-texture-preview-worker"
import {
  authoredBodyKey,
  authoredBodyKeys,
  currentAuthoredSnapshot,
} from "../shell/authored-tree-state"
import type { AutomationReviewState } from "./automation-review-state"

export function surfaceTextureReviewedInputMatches(
  review: AutomationReviewState | null,
  input: SurfaceTextureReviewedInput,
  now = Date.now(),
) {
  if (
    !review ||
    review.status === "error" ||
    !("kind" in review.input) ||
    review.input.kind !== "surface-texture"
  )
    return false
  const owned = review.input
  return (
    owned.draft.draftId === input.draft.draftId &&
    owned.draft.baseRevision === input.draft.baseRevision &&
    owned.draft.draftVersion === input.draft.draftVersion &&
    owned.draft.expiresAt === input.draft.expiresAt &&
    now < Date.parse(input.draft.expiresAt) &&
    owned.operation === input.operation &&
    owned.layerId === input.layerId &&
    input.command.baseRevision === input.draft.baseRevision &&
    commandActorsEqual(owned.actor, input.actor) &&
    commandActorsEqual(input.command.actor, input.actor) &&
    canonicalJson(owned.command) === canonicalJson(input.command)
  )
}

export async function previewOwnedSurfaceTextures(
  controller: DocumentControllerState,
  layers: readonly SurfaceTextureLayer[],
  signal: AbortSignal,
) {
  const report = controller.report
  const authority = currentAuthoredSnapshot(controller)
  if (
    !report ||
    !authority ||
    !report.rebuild.ok ||
    report.rebuild.response.documentId !== authority.id ||
    report.rebuild.response.revision !== authority.revision
  )
    throw new Error("The current surface texture source geometry is unavailable.")
  const bodies = terminalModelBodies(report.snapshot.features, report.rebuild.response)
  if (!bodies) throw new Error("The current surface texture source bodies are unavailable.")
  const hidden = authoredBodyKeys(authority, true)
  const sources = bodies
    .filter(({ geometry }) => !hidden.has(authoredBodyKey(geometry)))
    .map(({ geometry }) => ({
      featureId: geometry.featureId,
      ...(geometry.outputRole === undefined ? {} : { outputRole: geometry.outputRole }),
      ...geometry.mesh,
    }))
  const results = await previewSurfaceTextureRelief({
    report,
    layers,
    sources,
    requiredLayers: layers,
    createWorker: createSurfaceTexturePreviewWorker,
    signal,
  })
  return surfaceTexturePreviewEvidenceSchema.parse({
    bodyCount: results.length,
    sourceTriangleCount: results.reduce(
      (total, { source }) => total + source.indices.length / 3,
      0,
    ),
    triangleCount: results.reduce((total, { mesh }) => total + mesh.indices.length / 3, 0),
    vertexCount: results.reduce((total, { mesh }) => total + mesh.positions.length / 3, 0),
  })
}
