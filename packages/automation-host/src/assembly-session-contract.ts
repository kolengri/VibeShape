import type {
  AssemblyDraftPreview,
  AssemblyDraftState,
  AssemblyInspectionView,
} from "@vibeshape/automation-api/assembly-tools"
import {
  assemblyDefinitionViewSchema,
  assemblyModelViewSchema,
} from "@vibeshape/automation-api/assembly-tools"
import { libraryVersionViewSchema } from "@vibeshape/automation-api/library-tools"
import { type LocalFailure, localFailure } from "@vibeshape/automation-api/local-tools"
import type {
  AssemblyMutation,
  PinnedAssemblyDefinition,
} from "@vibeshape/domain/assembly-authority"
import { emptyAssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import {
  assemblyLibraryDefinitionAssets,
  assemblyLibraryItemSchema,
  assemblyLibraryVersionSchema,
} from "@vibeshape/domain/assembly-library"
import type { CommandActor } from "@vibeshape/domain/commands"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import type { SourceAssetBlob } from "@vibeshape/domain/source-assets"
import { sourceAssetBlobSchema } from "@vibeshape/domain/source-assets"
import { z } from "zod"

export type AssemblyCancellation = Readonly<{ aborted: boolean }>
export const ASSEMBLY_DRAFT_TTL_MS = 5 * 60 * 1000
export type AssemblyResult<T> = Readonly<{ ok: true; value: T }> | LocalFailure
export const ownedLibraryVersionSchema = z
  .object({
    item: assemblyLibraryItemSchema,
    version: assemblyLibraryVersionSchema,
    blobs: z.array(sourceAssetBlobSchema).max(128),
  })
  .strict()
export type OwnedLibraryVersion = z.infer<typeof ownedLibraryVersionSchema>
export type AssemblyReviewInput = Readonly<{
  kind: "assembly" | "library"
  actor: CommandActor
  documentName: string
  draft: AssemblyDraftState
  changes: readonly AssemblyMutation[]
  preview?: AssemblyDraftPreview
  library?: Readonly<{
    operation: "save" | "metadata"
    itemId: string
    name: string
    tags: readonly string[]
    version: number | null
  }>
}>
export type AssemblyLibraryPort = Readonly<{
  list: (
    input: Readonly<{ query: string; limit: number }>,
  ) => Promise<AssemblyResult<readonly z.infer<typeof assemblyLibraryItemSchema>[]>>
  read: (
    input: Readonly<{ itemId: string; version?: number | undefined }>,
  ) => Promise<AssemblyResult<OwnedLibraryVersion>>
  prepareSource: (
    input: Readonly<{ source: { kind: "part" | "definition"; id: string }; name: string }>,
  ) => Promise<
    AssemblyResult<
      Readonly<{ definition: PinnedAssemblyDefinition; blobs: readonly SourceAssetBlob[] }>
    >
  >
  publish: (
    input: Readonly<{
      itemId: string
      expectedMetadataRevision: number | null
      name: string
      tags: readonly string[]
      definition: PinnedAssemblyDefinition
      blobs: readonly SourceAssetBlob[]
      createdAt: string
    }>,
    checkAuthority: () => LocalFailure | null,
  ) => Promise<AssemblyResult<OwnedLibraryVersion>>
  updateMetadata: (
    input: Readonly<{
      itemId: string
      expectedMetadataRevision: number
      name: string
      tags: readonly string[]
      updatedAt: string
    }>,
    checkAuthority: () => LocalFailure | null,
  ) => Promise<AssemblyResult<z.infer<typeof assemblyLibraryItemSchema>>>
}>
export type AssemblySessionConfiguration = Readonly<{
  documentId: string
  isActive: () => boolean
  readSnapshot: () => unknown
  createId: () => string
  now?: () => number
  inspect: (
    revision: number,
    input: Readonly<{
      interferencePairs: readonly { leftInstanceId: string; rightInstanceId: string }[]
      topology?:
        | { instanceId: string; sourceIndex: number; offset: number; limit: number }
        | undefined
    }>,
  ) => Promise<AssemblyResult<AssemblyInspectionView>>
  preview: (
    changes: readonly AssemblyMutation[],
    baseRevision: number,
    blobs: readonly SourceAssetBlob[],
  ) => Promise<AssemblyResult<AssemblyInspectionView>>
  commit: (
    input: Readonly<{
      draftId: string
      actor: CommandActor
      baseRevision: number
      draftVersion: number
      changes: readonly AssemblyMutation[]
      blobs: readonly SourceAssetBlob[]
    }>,
  ) => Promise<AssemblyResult<{ revision: number }>>
  library: AssemblyLibraryPort
  review: (input: AssemblyReviewInput) => Promise<"approved" | "rejected" | "cancelled">
}>

export function assemblyModelView(snapshot: DocumentAuthoritySnapshot) {
  const assembly =
    snapshot.schemaVersion === 4 || snapshot.schemaVersion === 5
      ? snapshot.assembly
      : emptyAssemblyAuthority()
  return assemblyModelViewSchema.parse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    assemblyVersion: assembly.schemaVersion,
    definitions: assembly.definitions.map(definitionView),
    instances: assembly.instances,
    joints: assembly.joints,
  })
}
export function definitionView(definition: PinnedAssemblyDefinition) {
  const { pinnedModels: _pins, ...view } = definition
  return assemblyDefinitionViewSchema.parse(view)
}
export function libraryVersionView(read: OwnedLibraryVersion) {
  return libraryVersionViewSchema.parse({
    schemaVersion: 1,
    item: read.item,
    version: read.version.version,
    contentDigest: read.version.contentDigest,
    createdAt: read.version.createdAt,
    definition: definitionView(read.version.definition),
    sourceByteLength: assemblyLibraryDefinitionAssets(read.version.definition).reduce(
      (total, asset) => total + asset.byteLength,
      0,
    ),
  })
}
export function assemblyFailure(code: string, error: unknown, retryable = false) {
  return localFailure(
    code,
    error instanceof Error ? error.message.slice(0, 512) : "The assembly operation failed.",
    retryable,
  )
}
