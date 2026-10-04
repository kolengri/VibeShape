import { assemblyLibraryItemSchema } from "@vibeshape/domain/assembly-library"
import {
  type AssemblyOperation,
  assemblyCommitViewSchema,
  assemblyDiscardViewSchema,
  assemblyDraftPreviewSchema,
  assemblyDraftStateSchema,
  assemblyInspectionViewSchema,
  assemblyModelViewSchema,
  assemblyOperationSchema,
  assemblyToolInputs,
} from "./assembly-tools"
import {
  type LibraryOperation,
  libraryItemsViewSchema,
  libraryOperationSchema,
  libraryToolInputs,
  libraryVersionViewSchema,
} from "./library-tools"
import { serializedQueryBytes } from "./query-byte-budget"

type DocumentContext = (documentId: string) => boolean
export function isAssemblyLibraryToolName(name: string) {
  return Object.hasOwn(assemblyToolInputs, name) || Object.hasOwn(libraryToolInputs, name)
}
function samePair(
  left: { leftInstanceId: string; rightInstanceId: string },
  right: { leftInstanceId: string; rightInstanceId: string },
) {
  return (
    [left.leftInstanceId, left.rightInstanceId].sort().join(":") ===
    [right.leftInstanceId, right.rightInstanceId].sort().join(":")
  )
}
function inspectionMatches(
  operation: Extract<AssemblyOperation, { tool: "inspect_assembly" }>,
  value: unknown,
  belongs: DocumentContext,
) {
  const view = assemblyInspectionViewSchema.parse(value)
  if (!belongs(view.documentId) || view.revision !== operation.arguments.revision) return false
  const requested = operation.arguments.interferencePairs
  if (
    view.interference.length !== requested.length ||
    !view.interference.every((pair) => requested.some((expected) => samePair(pair, expected)))
  )
    return false
  const topology = operation.arguments.topology
  if (!topology) return view.topology === undefined
  return (
    view.topology?.instanceId === topology.instanceId &&
    view.topology.sourceIndex === topology.sourceIndex &&
    view.topology.references.length <= topology.limit
  )
}
function createdDraftMatches(
  operation: Extract<AssemblyOperation, { tool: "create_assembly_draft" }>,
  value: unknown,
  belongs: DocumentContext,
) {
  const state = assemblyDraftStateSchema.parse(value)
  return (
    belongs(state.documentId) &&
    state.baseRevision === operation.arguments.baseRevision &&
    state.draftVersion === 0 &&
    state.changeCount === 0
  )
}
function previewMatches(
  operation: Extract<AssemblyOperation, { tool: "preview_assembly_draft" }>,
  value: unknown,
  belongs: DocumentContext,
) {
  const { draft } = assemblyDraftPreviewSchema.parse(value)
  return (
    belongs(draft.documentId) &&
    draft.draftId === operation.arguments.draftId &&
    draft.baseRevision === operation.arguments.baseRevision &&
    draft.draftVersion === operation.arguments.draftVersion
  )
}
function commitMatches(
  operation: Extract<AssemblyOperation, { tool: "commit_assembly_draft" }>,
  value: unknown,
  belongs: DocumentContext,
) {
  const view = assemblyCommitViewSchema.parse(value)
  return (
    belongs(view.documentId) &&
    view.draftId === operation.arguments.draftId &&
    view.baseRevision === operation.arguments.baseRevision
  )
}
function changedDraftMatches(
  operation: AssemblyOperation | LibraryOperation,
  value: unknown,
  belongs: DocumentContext,
) {
  if (!("draftId" in operation.arguments)) return false
  const state = assemblyDraftStateSchema.parse(value)
  return (
    belongs(state.documentId) &&
    state.draftId === operation.arguments.draftId &&
    state.baseRevision === operation.arguments.baseRevision &&
    state.draftVersion === operation.arguments.draftVersion + 1
  )
}
function assemblyMatches(
  operation: AssemblyOperation,
  value: unknown,
  belongs: DocumentContext,
): boolean {
  switch (operation.tool) {
    case "model_assembly": {
      const view = assemblyModelViewSchema.parse(value)
      return belongs(view.documentId) && view.revision === operation.arguments.revision
    }
    case "inspect_assembly":
      return inspectionMatches(operation, value, belongs)
    case "create_assembly_draft":
      return createdDraftMatches(operation, value, belongs)
    case "preview_assembly_draft":
      return previewMatches(operation, value, belongs)
    case "commit_assembly_draft":
      return commitMatches(operation, value, belongs)
    case "discard_assembly_draft":
      return assemblyDiscardViewSchema.parse(value).draftId === operation.arguments.draftId
    default:
      return changedDraftMatches(operation, value, belongs)
  }
}
function versionMatches(
  operation: Extract<LibraryOperation, { tool: "library_version" }>,
  value: unknown,
) {
  const view = libraryVersionViewSchema.parse(value)
  return (
    view.item.id === operation.arguments.itemId &&
    (operation.arguments.version === undefined || view.version === operation.arguments.version)
  )
}
function publishedVersionMatches(
  operation: Extract<LibraryOperation, { tool: "save_library_definition" }>,
  value: unknown,
) {
  const view = libraryVersionViewSchema.parse(value)
  return (
    (operation.arguments.itemId === undefined || view.item.id === operation.arguments.itemId) &&
    view.item.metadataRevision === (operation.arguments.expectedMetadataRevision ?? 0) + 1
  )
}
function metadataMatches(
  operation: Extract<LibraryOperation, { tool: "update_library_metadata" }>,
  value: unknown,
) {
  const item = assemblyLibraryItemSchema.parse(value)
  return (
    item.id === operation.arguments.itemId &&
    item.metadataRevision === operation.arguments.expectedMetadataRevision + 1
  )
}
function libraryMatches(operation: LibraryOperation, value: unknown, belongs: DocumentContext) {
  switch (operation.tool) {
    case "library_items":
      return libraryItemsViewSchema.parse(value).items.length <= operation.arguments.limit
    case "library_version":
      return versionMatches(operation, value)
    case "save_library_definition":
      return publishedVersionMatches(operation, value)
    case "update_library_metadata":
      return metadataMatches(operation, value)
    default:
      return changedDraftMatches(operation, value, belongs)
  }
}
/** Local and remote transports share revision, identity and response-budget checks. */
export function assemblyResultContextMatches(
  input: unknown,
  result: { ok: boolean; value?: unknown },
  documentId?: string,
): boolean | null {
  const assembly = assemblyOperationSchema.safeParse(input)
  const library = libraryOperationSchema.safeParse(input)
  if (!assembly.success && !library.success) return null
  if (serializedQueryBytes(result) > 128 * 1024) return false
  if (!result.ok) return true
  const belongs = (id: string) => documentId === undefined || id === documentId
  if (assembly.success) return assemblyMatches(assembly.data, result.value, belongs)
  return library.success && libraryMatches(library.data, result.value, belongs)
}
