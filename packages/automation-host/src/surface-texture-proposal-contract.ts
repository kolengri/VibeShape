import type { LocalFailure } from "@vibeshape/automation-api/local-tools"
import type { SurfaceTexturePreviewEvidence } from "@vibeshape/automation-api/surface-texture-tools"
import type { CommandActor } from "@vibeshape/domain/commands"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import {
  documentV3MetadataCommandSchema,
  replaceSurfaceTextureLayersSchema,
} from "@vibeshape/domain/document-v3-command-schemas"
import type { z } from "zod"

export const SURFACE_TEXTURE_PROPOSAL_TTL_MS = 5 * 60 * 1000
export type SurfaceTextureCancellation = Readonly<{ aborted: boolean }>
export type SurfaceTextureResult<T> = Readonly<{ ok: true; value: T }> | LocalFailure
export type SurfaceTextureChange = z.infer<typeof replaceSurfaceTextureLayersSchema>
export const surfaceTextureCommandSchema = documentV3MetadataCommandSchema.safeExtend({
  payload: replaceSurfaceTextureLayersSchema,
})
export type SurfaceTextureCommand = z.infer<typeof surfaceTextureCommandSchema>
export type SurfaceTextureProposalDraft = Readonly<{
  draftId: string
  baseRevision: number
  draftVersion: 0
  expiresAt: string
}>
export type SurfaceTextureReviewedInput = Readonly<{
  actor: CommandActor
  draft: SurfaceTextureProposalDraft
  command: SurfaceTextureCommand
  operation: "create" | "update" | "remove"
  layerId: string
}>
export type SurfaceTextureReviewInput = SurfaceTextureReviewedInput &
  Readonly<{
    kind: "surface-texture"
    documentName: string
    featureName: string
    preview: SurfaceTexturePreviewEvidence
  }>
export type SurfaceTextureProposalConfiguration = Readonly<{
  documentId: string
  readSnapshot: () => unknown | PromiseLike<unknown>
  isActive: () => boolean
  createId: () => unknown
  preview: (
    input: SurfaceTextureReviewedInput,
    signal?: SurfaceTextureCancellation,
  ) => Promise<SurfaceTextureResult<SurfaceTexturePreviewEvidence>>
  commit: (
    input: SurfaceTextureReviewedInput,
  ) => Promise<SurfaceTextureResult<{ documentId: string; revision: number }>>
  review: (input: SurfaceTextureReviewInput) => Promise<"approved" | "rejected" | "cancelled">
  now?: () => number
}>
export type SurfaceTextureAuthority = AuthoredDocumentSnapshot
