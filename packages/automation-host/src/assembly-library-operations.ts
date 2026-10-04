import { assemblyDraftStateSchema } from "@vibeshape/automation-api/assembly-tools"
import {
  type LibraryOperation,
  libraryItemsViewSchema,
} from "@vibeshape/automation-api/library-tools"
import { type LocalFailure, localFailure } from "@vibeshape/automation-api/local-tools"
import {
  type AssemblyMutation,
  pinnedAssemblyDefinitionSchema,
} from "@vibeshape/domain/assembly-authority"
import {
  assemblyLibraryDefinitionSchema,
  assemblyLibraryItemSchema,
} from "@vibeshape/domain/assembly-library"
import { assemblyInstanceRecordSchema } from "@vibeshape/domain/assembly-mates"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { type CommandActor, commandActorSchema } from "@vibeshape/domain/commands"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { type SourceAssetBlob, sourceAssetBlobSchema } from "@vibeshape/domain/source-assets"
import { z } from "zod"
import {
  type AssemblyDraftRecord,
  draftAssemblyAuthority,
  mergeOwnedBlobs,
} from "./assembly-draft-support"
import type { AssemblyCancellation } from "./assembly-session-contract"
import {
  ASSEMBLY_DRAFT_TTL_MS,
  type AssemblyResult,
  type AssemblySessionConfiguration,
  libraryVersionView,
  ownedLibraryVersionSchema,
} from "./assembly-session-contract"

type LibraryOperationContext = Readonly<{
  configuration: AssemblySessionConfiguration
  actor: CommandActor
  operation: LibraryOperation
  snapshot: () => AuthoredDocumentSnapshot
  guard: (
    revision: number,
    generation?: number,
    signal?: AssemblyCancellation,
  ) => () => LocalFailure | null
  ownedDraft: (
    actor: CommandActor,
    input: { draftId: string; baseRevision: number; draftVersion: number },
  ) => AssemblyResult<AssemblyDraftRecord>
  append: (
    record: AssemblyDraftRecord,
    additions: readonly AssemblyMutation[],
    blobs?: readonly SourceAssetBlob[],
  ) => AssemblyResult<unknown>
  bounded: <T>(value: T) => AssemblyResult<T>
  markPersisting: () => void
  signal?: AssemblyCancellation | undefined
}>
type DraftLibraryOperation = Extract<LibraryOperation, { arguments: { draftId: string } }>
type FrozenDraftOperation = Exclude<DraftLibraryOperation, { tool: "detach_library_definition" }>
type SaveOperation = Extract<LibraryOperation, { tool: "save_library_definition" }>
type MetadataOperation = Extract<LibraryOperation, { tool: "update_library_metadata" }>
const preparedSourceSchema = z
  .object({
    definition: assemblyLibraryDefinitionSchema,
    blobs: z.array(sourceAssetBlobSchema).max(128),
  })
  .strict()
function versionMatches(
  read: ReturnType<typeof ownedLibraryVersionSchema.parse>,
  itemId: string,
  version?: number,
) {
  return (
    read.item.id === itemId &&
    read.version.itemId === itemId &&
    (version === undefined || read.version.version === version)
  )
}
async function frozenVersion(
  context: LibraryOperationContext,
  record: AssemblyDraftRecord,
  operation: FrozenDraftOperation,
) {
  const current = context.guard(record.state.baseRevision, undefined, context.signal)
  const unavailable = current()
  if (unavailable) return unavailable
  const result = await context.configuration.library.read({
    itemId: operation.arguments.itemId,
    version: operation.arguments.version,
  })
  const interrupted = current()
  if (interrupted) return interrupted
  if (Date.parse(record.state.expiresAt) <= (context.configuration.now ?? Date.now)())
    return localFailure("draft-expired", "The assembly draft expired during library lookup.")
  if (!result.ok) return result
  const saved = ownedLibraryVersionSchema.parse(result.value)
  return versionMatches(saved, operation.arguments.itemId, operation.arguments.version)
    ? { ok: true as const, value: saved }
    : localFailure("invalid-library-version", "The library returned a different frozen revision.")
}
function insertFrozen(
  context: LibraryOperationContext,
  record: AssemblyDraftRecord,
  operation: Extract<FrozenDraftOperation, { tool: "insert_library_version" }>,
  saved: ReturnType<typeof ownedLibraryVersionSchema.parse>,
) {
  const { libraryBinding: _binding, ...frozen } = saved.version.definition
  const input = operation.arguments
  const authority = draftAssemblyAuthority(record)
  const definition = pinnedAssemblyDefinitionSchema.parse({
    ...frozen,
    id: input.definitionId,
    pinRevision: 1,
    name: input.definitionName,
    ...(input.mode === "reference"
      ? { libraryBinding: { itemId: input.itemId, version: input.version } }
      : {}),
  })
  return context.append(
    record,
    [
      { kind: "definition.insert-pinned", definition },
      {
        kind: "instance.create",
        instance: assemblyInstanceRecordSchema.parse({
          schemaVersion: authority.assembly.schemaVersion,
          id: input.instanceId,
          definitionId: definition.id,
          name: input.instanceName,
          grounded: true,
          worldFrame: input.worldFrame,
        }),
      },
    ],
    saved.blobs,
  )
}
function relinkFrozen(
  context: LibraryOperationContext,
  record: AssemblyDraftRecord,
  operation: Extract<FrozenDraftOperation, { tool: "relink_library_definition" }>,
  saved: ReturnType<typeof ownedLibraryVersionSchema.parse>,
) {
  const previous = draftAssemblyAuthority(record).assembly.definitions.find(
    ({ id }) => id === operation.arguments.definitionId,
  )
  if (!previous?.libraryBinding)
    return localFailure(
      "library-reference-required",
      "Relinking requires an existing library reference definition.",
    )
  const { libraryBinding: _binding, ...frozen } = saved.version.definition
  const definition = pinnedAssemblyDefinitionSchema.parse({
    ...frozen,
    id: previous.id,
    pinRevision: previous.pinRevision + 1,
    name: previous.name,
    libraryBinding: { itemId: operation.arguments.itemId, version: operation.arguments.version },
  })
  return context.append(record, [{ kind: "definition.relink-pinned", definition }], saved.blobs)
}
async function draftLibraryChange(
  context: LibraryOperationContext,
  operation: DraftLibraryOperation,
) {
  const owned = context.ownedDraft(context.actor, operation.arguments)
  if (!owned.ok) return owned
  if (operation.tool === "detach_library_definition")
    return context.append(owned.value, [
      { kind: "definition.detach-library", definitionId: operation.arguments.definitionId },
    ])
  const saved = await frozenVersion(context, owned.value, operation)
  if (!saved.ok) return saved
  return operation.tool === "insert_library_version"
    ? insertFrozen(context, owned.value, operation, saved.value)
    : relinkFrozen(context, owned.value, operation, saved.value)
}
async function reviewLibraryProposal(
  context: LibraryOperationContext,
  operation: SaveOperation | MetadataOperation,
  itemId: string,
  expiresAt: number,
) {
  const input = operation.arguments
  const current = context.guard(input.baseRevision, undefined, context.signal)
  const unavailable = current()
  if (unavailable) return unavailable
  const source = context.snapshot()
  const now = context.configuration.now ?? Date.now
  if (now() >= expiresAt)
    return localFailure("draft-expired", "The library proposal expired during source preparation.")
  const draft = assemblyDraftStateSchema.parse({
    schemaVersion: 1,
    draftId: context.configuration.createId(),
    documentId: source.id,
    baseRevision: input.baseRevision,
    draftVersion: 0,
    changeCount: 0,
    expiresAt: new Date(expiresAt).toISOString(),
  })
  const decision = await context.configuration.review({
    kind: "library",
    actor: commandActorSchema.parse(context.actor),
    documentName: source.name,
    draft,
    changes: [],
    library: {
      operation: operation.tool === "save_library_definition" ? "save" : "metadata",
      itemId,
      name: input.name,
      tags: [...input.tags],
      version: null,
    },
  })
  const interrupted = current()
  if (interrupted) return interrupted
  if (now() >= expiresAt)
    return localFailure("draft-expired", "The library proposal expired before publication.")
  return decision === "approved"
    ? { ok: true as const, value: new Date(now()).toISOString() }
    : localFailure("draft-review-cancelled", "The library proposal was not approved.")
}
function metadataMatches(
  item: ReturnType<typeof assemblyLibraryItemSchema.parse>,
  input: { itemId: string; name: string; tags: readonly string[] },
  metadataRevision: number,
) {
  return (
    item.id === input.itemId &&
    item.metadataRevision === metadataRevision &&
    item.name === input.name &&
    canonicalJson(item.tags) === canonicalJson(input.tags)
  )
}
function publicationAuthority(
  context: LibraryOperationContext,
  revision: number,
  expiresAt: number,
) {
  const current = context.guard(revision, undefined, context.signal)
  return () =>
    current() ??
    ((context.configuration.now ?? Date.now)() >= expiresAt
      ? localFailure("draft-expired", "The library proposal expired before publication.")
      : null)
}
function publicationMatches(
  saved: ReturnType<typeof ownedLibraryVersionSchema.parse>,
  prepared: z.infer<typeof preparedSourceSchema>,
  input: SaveOperation["arguments"],
  itemId: string,
) {
  return (
    versionMatches(saved, itemId) &&
    metadataMatches(saved.item, { ...input, itemId }, (input.expectedMetadataRevision ?? 0) + 1) &&
    canonicalJson(saved.version.definition) === canonicalJson(prepared.definition)
  )
}
async function saveDefinition(context: LibraryOperationContext, operation: SaveOperation) {
  const input = operation.arguments
  const current = context.guard(input.baseRevision, undefined, context.signal)
  const unavailable = current()
  if (unavailable) return unavailable
  const expiresAt = (context.configuration.now ?? Date.now)() + ASSEMBLY_DRAFT_TTL_MS
  const checkAuthority = publicationAuthority(context, input.baseRevision, expiresAt)
  const result = await context.configuration.library.prepareSource({
    source: input.source,
    name: input.name,
  })
  const interrupted = current()
  if (interrupted) return interrupted
  if (!result.ok) return result
  const parsed = preparedSourceSchema.parse(result.value)
  const prepared = { definition: parsed.definition, blobs: mergeOwnedBlobs([], parsed.blobs) }
  const itemId = input.itemId ?? context.configuration.createId()
  const review = await reviewLibraryProposal(context, operation, itemId, expiresAt)
  if (!review.ok) return review
  context.markPersisting()
  const published = await context.configuration.library.publish(
    {
      itemId,
      expectedMetadataRevision: input.expectedMetadataRevision,
      name: input.name,
      tags: [...input.tags],
      definition: prepared.definition,
      blobs: prepared.blobs,
      createdAt: review.value,
    },
    checkAuthority,
  )
  if (!published.ok) return published
  const saved = ownedLibraryVersionSchema.parse(published.value)
  return publicationMatches(saved, parsed, input, itemId)
    ? context.bounded(libraryVersionView(saved))
    : localFailure(
        "invalid-library-receipt",
        "The frozen library receipt is outside the approved boundary.",
      )
}
async function updateMetadata(context: LibraryOperationContext, operation: MetadataOperation) {
  const input = operation.arguments
  const expiresAt = (context.configuration.now ?? Date.now)() + ASSEMBLY_DRAFT_TTL_MS
  const checkAuthority = publicationAuthority(context, input.baseRevision, expiresAt)
  const review = await reviewLibraryProposal(context, operation, input.itemId, expiresAt)
  if (!review.ok) return review
  context.markPersisting()
  const result = await context.configuration.library.updateMetadata(
    {
      itemId: input.itemId,
      expectedMetadataRevision: input.expectedMetadataRevision,
      name: input.name,
      tags: [...input.tags],
      updatedAt: review.value,
    },
    checkAuthority,
  )
  if (!result.ok) return result
  const item = assemblyLibraryItemSchema.parse(result.value)
  return metadataMatches(item, input, input.expectedMetadataRevision + 1)
    ? context.bounded(item)
    : localFailure(
        "invalid-library-receipt",
        "The library metadata receipt is outside the approved boundary.",
      )
}
async function listLibrary(
  context: LibraryOperationContext,
  operation: Extract<LibraryOperation, { tool: "library_items" }>,
) {
  const current = context.guard(operation.arguments.revision, undefined, context.signal)
  const unavailable = current()
  if (unavailable) return unavailable
  const result = await context.configuration.library.list({
    query: operation.arguments.query,
    limit: operation.arguments.limit,
  })
  const interrupted = current()
  if (interrupted) return interrupted
  return result.ok
    ? context.bounded(libraryItemsViewSchema.parse({ schemaVersion: 1, items: result.value }))
    : result
}
async function readLibrary(
  context: LibraryOperationContext,
  operation: Extract<LibraryOperation, { tool: "library_version" }>,
) {
  const current = context.guard(operation.arguments.revision, undefined, context.signal)
  const unavailable = current()
  if (unavailable) return unavailable
  const result = await context.configuration.library.read({
    itemId: operation.arguments.itemId,
    version: operation.arguments.version,
  })
  const interrupted = current()
  if (interrupted) return interrupted
  if (!result.ok) return result
  const saved = ownedLibraryVersionSchema.parse(result.value)
  return versionMatches(saved, operation.arguments.itemId, operation.arguments.version)
    ? context.bounded(libraryVersionView(saved))
    : localFailure("invalid-library-version", "The library returned a different frozen revision.")
}
export function executeLibraryOperation(
  context: LibraryOperationContext,
): Promise<AssemblyResult<unknown>> {
  const operation = context.operation
  switch (operation.tool) {
    case "library_items":
      return listLibrary(context, operation)
    case "library_version":
      return readLibrary(context, operation)
    case "save_library_definition":
      return saveDefinition(context, operation)
    case "update_library_metadata":
      return updateMetadata(context, operation)
    default:
      return draftLibraryChange(context, operation)
  }
}
