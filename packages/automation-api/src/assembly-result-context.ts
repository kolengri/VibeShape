import { assemblyLibraryItemSchema } from "@vibeshape/domain/assembly-library"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import type { z } from "zod"
import {
  type AssemblyInspectionView,
  type AssemblyOperation,
  assemblyCommitViewSchema,
  assemblyDiscardViewSchema,
  assemblyDraftPreviewSchema,
  assemblyDraftStateSchema,
  assemblyInspectionViewSchema,
  assemblyModelViewSchema,
  assemblyMotionSamplesViewSchema,
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
function pairKey(pair: { leftInstanceId: string; rightInstanceId: string }) {
  return [pair.leftInstanceId, pair.rightInstanceId].sort().join(":")
}
type TopologyInput = NonNullable<
  Extract<AssemblyOperation, { tool: "inspect_assembly" }>["arguments"]["topology"]
>
type TopologyPage = NonNullable<AssemblyInspectionView["topology"]>
const topologyReferenceKinds = {
  "planar-face": "face",
  "cylindrical-face": "face",
  "spherical-face": "face",
  "circular-edge": "edge",
  vertex: "vertex",
} as const
function topologyPaginationMatches(input: TopologyInput, topology: TopologyPage) {
  if (input.offset > topology.total) return false
  const count = Math.min(input.limit, topology.total - input.offset)
  const nextOffset = input.offset + count < topology.total ? input.offset + count : null
  return topology.references.length === count && topology.nextOffset === nextOffset
}
function topologyOwnerMatches(
  input: TopologyInput,
  topology: TopologyPage,
  occurrence: AssemblyInspectionView["occurrences"][number],
) {
  return (
    topology.instanceId === input.instanceId &&
    topology.sourceIndex === input.sourceIndex &&
    topology.pinRevision === occurrence.pinRevision &&
    canonicalJson(topology.body) === canonicalJson(occurrence.selectedBody)
  )
}
function topologyMatches(input: TopologyInput, view: AssemblyInspectionView) {
  const topology = view.topology
  if (!topology) return false
  const occurrences = view.occurrences.filter(
    ({ instanceId, sourceIndex }) =>
      instanceId === input.instanceId && sourceIndex === input.sourceIndex,
  )
  const occurrence = occurrences[0]
  if (occurrences.length !== 1 || occurrence?.representation !== "exact-solid") return false
  return (
    topologyOwnerMatches(input, topology, occurrence) &&
    topologyPaginationMatches(input, topology) &&
    topology.references.every(
      ({ reference, geometry }) =>
        reference.featureId === occurrence.selectedBody.featureId &&
        reference.kind === topologyReferenceKinds[geometry],
    )
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
  const expectedPairs = new Set(requested.map(pairKey))
  const actualPairs = new Set(view.interference.map(pairKey))
  if (
    expectedPairs.size !== requested.length ||
    actualPairs.size !== view.interference.length ||
    actualPairs.size !== expectedPairs.size ||
    ![...expectedPairs].every((pair) => actualPairs.has(pair))
  )
    return false
  const topology = operation.arguments.topology
  if (!topology) return view.topology === undefined
  return topologyMatches(topology, view)
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
    case "sample_assembly_motion_study":
      return sampledStudyMatches(operation, value, belongs)
    case "model_assembly":
      return assemblyModelMatches(operation, value, belongs)
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
function assemblyModelMatches(
  operation: Extract<AssemblyOperation, { tool: "model_assembly" }>,
  value: unknown,
  belongs: DocumentContext,
) {
  const view = assemblyModelViewSchema.parse(value)
  return belongs(view.documentId) && view.revision === operation.arguments.revision
}
function sampledStudyMatches(
  operation: Extract<AssemblyOperation, { tool: "sample_assembly_motion_study" }>,
  value: unknown,
  belongs: DocumentContext,
) {
  const view = assemblyMotionSamplesViewSchema.parse(value),
    input = operation.arguments
  return (
    belongs(view.documentId) &&
    view.revision === input.revision &&
    view.studyId === input.studyId &&
    view.samples.length === input.sampleCount &&
    motionSamplesMatch(view, input)
  )
}
function motionSamplesMatch(
  view: z.infer<typeof assemblyMotionSamplesViewSchema>,
  input: Extract<AssemblyOperation, { tool: "sample_assembly_motion_study" }>["arguments"],
) {
  const endpoint = input.reverse ? view.samples.at(-1) : view.samples[0]
  if (endpoint?.timeSeconds !== 0) return false
  return view.samples.every((sample, index) => {
    const previous = view.samples[index - 1]
    if (
      previous &&
      (input.reverse
        ? sample.timeSeconds >= previous.timeSeconds
        : sample.timeSeconds <= previous.timeSeconds)
    )
      return false
    const identities = sample.occurrences.map(
      ({ instanceId, sourceIndex }) => `${instanceId}:${sourceIndex}`,
    )
    if (new Set(identities).size !== identities.length) return false
    if (
      input.instanceIds.some(
        (id) => !sample.occurrences.some(({ instanceId }) => instanceId === id),
      )
    )
      return false
    if (sample.occurrences.some(({ instanceId }) => !input.instanceIds.includes(instanceId)))
      return false
    return input.trace === undefined
      ? sample.tracePointMm === undefined
      : sample.tracePointMm !== undefined
  })
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
