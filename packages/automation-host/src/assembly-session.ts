import {
  type AssemblyOperation,
  assemblyCommitViewSchema,
  assemblyDiscardViewSchema,
  assemblyDraftPreviewSchema,
  assemblyDraftStateSchema,
  assemblyInspectionViewSchema,
  assemblyOperationSchema,
} from "@vibeshape/automation-api/assembly-tools"
import {
  type LibraryOperation,
  libraryOperationSchema,
} from "@vibeshape/automation-api/library-tools"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { serializedQueryBytes } from "@vibeshape/automation-api/query-byte-budget"
import {
  type AssemblyMutation,
  assemblyMutationsSchema,
} from "@vibeshape/domain/assembly-authority"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"
import { authoredDocumentSnapshotSchema } from "@vibeshape/domain/document-v2"
import { z } from "zod"
import {
  type AssemblyDraftRecord,
  draftAssemblyAuthority,
  mergeOwnedBlobs,
  namedAssemblyMutation,
  previewAssemblyBlobs,
  renewedDraft,
} from "./assembly-draft-support"
import { executeLibraryOperation } from "./assembly-library-operations"
import { sampleAssemblyMotion } from "./assembly-motion-sampling"
import type { AssemblyCancellation } from "./assembly-session-contract"
import {
  ASSEMBLY_DRAFT_TTL_MS,
  type AssemblyResult,
  type AssemblySessionConfiguration,
  assemblyFailure,
  assemblyModelView,
} from "./assembly-session-contract"

const operationSchema = z.union([assemblyOperationSchema, libraryOperationSchema])
type Operation = AssemblyOperation | LibraryOperation
type OwnedAssemblyOperation = Extract<AssemblyOperation, { arguments: { draftId: string } }>
const clockSchema = z
  .number()
  .int()
  .nonnegative()
  .max(8_640_000_000_000_000 - ASSEMBLY_DRAFT_TTL_MS)

/** Private authored drafts never accept caller-owned pins, source bytes or document authority. */
export function createAssemblyAutomationSession(configuration: AssemblySessionConfiguration) {
  const drafts = new Map<string, AssemblyDraftRecord>()
  const now = () => clockSchema.parse((configuration.now ?? Date.now)())
  let owner: CommandActor | null = null
  let closed = false
  let busy = false
  let persisting = false
  let generation = 0

  function snapshot() {
    if (closed || !configuration.isActive())
      throw new Error("The paired assembly session is unavailable.")
    const parsed = authoredDocumentSnapshotSchema.parse(configuration.readSnapshot())
    if (parsed.id !== configuration.documentId)
      throw new Error("The paired authored document authority is unavailable.")
    return parsed
  }
  function guard(revision: number, captured = generation, signal?: AssemblyCancellation) {
    return () => {
      if (closed || generation !== captured || signal?.aborted || !configuration.isActive())
        return localFailure(
          "session-revoked",
          "The paired assembly session or request was cancelled.",
        )
      try {
        return snapshot().revision === revision
          ? null
          : localFailure(
              "stale-revision",
              "The paired document changed; create a fresh assembly draft.",
              true,
            )
      } catch {
        return localFailure(
          "assembly-authority-unavailable",
          "The paired authored document authority is unavailable.",
        )
      }
    }
  }
  function bounded<T>(value: T): AssemblyResult<T> {
    const result = { ok: true as const, value }
    return serializedQueryBytes(result) <= 128 * 1024
      ? result
      : localFailure(
          "query-result-too-large",
          "The complete assembly response exceeds the 128 KiB budget; inspect a smaller topology page.",
        )
  }
  function ownedDraft(
    actor: CommandActor,
    input: { draftId: string; baseRevision: number; draftVersion: number },
  ): AssemblyResult<AssemblyDraftRecord> {
    const record = drafts.get(input.draftId)
    if (!record || Date.parse(record.state.expiresAt) <= now()) {
      drafts.delete(input.draftId)
      return localFailure("draft-expired", "The owned assembly draft is missing or expired.")
    }
    if (!commandActorsEqual(actor, record.actor))
      return localFailure(
        "draft-owner-mismatch",
        "The paired actor does not own this assembly draft.",
      )
    if (
      input.baseRevision !== record.state.baseRevision ||
      input.draftVersion !== record.state.draftVersion
    )
      return localFailure(
        "stale-draft-version",
        "Use the returned assembly draft version and its original base revision.",
        true,
      )
    const interrupted = guard(record.state.baseRevision)()
    return interrupted ?? { ok: true, value: record }
  }
  function append(
    record: AssemblyDraftRecord,
    additions: readonly AssemblyMutation[],
    blobs = record.blobs,
  ) {
    const changes = assemblyMutationsSchema.parse([...record.changes, ...additions])
    const next = {
      ...record,
      changes,
      blobs: mergeOwnedBlobs(record.blobs, blobs),
      state: assemblyDraftStateSchema.parse({
        ...renewedDraft(record, now()),
        draftVersion: record.state.draftVersion + 1,
        changeCount: changes.length,
      }),
    }
    drafts.set(record.state.draftId, next)
    return bounded(next.state)
  }
  function createDraft(actor: CommandActor, baseRevision: number) {
    const current = snapshot()
    if (current.revision !== baseRevision)
      return localFailure(
        "stale-revision",
        "Create the assembly draft from the current committed revision.",
        true,
      )
    for (const [id, record] of drafts)
      if (Date.parse(record.state.expiresAt) <= now()) drafts.delete(id)
    if (drafts.size >= 8)
      return localFailure(
        "draft-limit-reached",
        "Discard an existing assembly draft before creating another.",
      )
    const state = assemblyDraftStateSchema.parse({
      schemaVersion: 1,
      draftId: configuration.createId(),
      documentId: current.id,
      baseRevision,
      draftVersion: 0,
      changeCount: 0,
      expiresAt: new Date(now() + ASSEMBLY_DRAFT_TTL_MS).toISOString(),
    })
    if (drafts.has(state.draftId))
      return localFailure(
        "duplicate-draft-id",
        "The generated assembly draft identity already exists.",
      )
    drafts.set(state.draftId, { state, actor, snapshot: current, changes: [], blobs: [] })
    return bounded(state)
  }
  async function exactPreview(
    record: AssemblyDraftRecord,
    expiresAt: string,
    signal?: AssemblyCancellation,
  ) {
    const current = guard(record.state.baseRevision, generation, signal)
    const unavailable = current()
    if (unavailable) return unavailable
    const exact = await configuration.preview(
      assemblyMutationsSchema.parse(record.changes),
      record.state.baseRevision,
      previewAssemblyBlobs(record).map((blob) => ({
        digest: blob.digest,
        bytes: Uint8Array.from(blob.bytes),
      })),
    )
    const interrupted = current()
    if (interrupted) return interrupted
    if (Date.parse(expiresAt) <= now())
      return localFailure("draft-expired", "The assembly draft expired during exact preview.")
    if (!exact.ok) return exact
    const inspection = assemblyInspectionViewSchema.parse(exact.value)
    if (
      inspection.documentId !== record.state.documentId ||
      inspection.revision !== record.state.baseRevision
    )
      return localFailure(
        "invalid-assembly-preview",
        "Exact assembly evidence belongs to a different document revision.",
      )
    return { ok: true as const, value: inspection }
  }
  async function preview(record: AssemblyDraftRecord, signal?: AssemblyCancellation) {
    if (!record.changes.length)
      return localFailure("draft-empty", "The assembly draft has no changes to preview.")
    const authority = draftAssemblyAuthority(record)
    const exact = await exactPreview(record, record.state.expiresAt, signal)
    if (!exact.ok) return exact
    const state = renewedDraft(record, now())
    const result = bounded(
      assemblyDraftPreviewSchema.parse({
        schemaVersion: 1,
        draft: state,
        assembly: assemblyModelView(authority),
        inspection: exact.value,
      }),
    )
    if (result.ok) drafts.set(state.draftId, { ...record, state })
    return result
  }
  async function persistReviewed(record: AssemblyDraftRecord) {
    persisting = true
    const receipt = await configuration.commit({
      draftId: record.state.draftId,
      actor: commandActorSchema.parse(record.actor),
      baseRevision: record.state.baseRevision,
      draftVersion: record.state.draftVersion,
      changes: assemblyMutationsSchema.parse(record.changes),
      blobs: record.blobs.map((blob) => ({
        digest: blob.digest,
        bytes: Uint8Array.from(blob.bytes),
      })),
    })
    if (!receipt.ok) return receipt
    const revisionIncrements = { 2: 3, 3: 2, 4: 1, 5: 1 }
    if (
      receipt.value.revision !==
      record.state.baseRevision + revisionIncrements[record.snapshot.schemaVersion]
    )
      return localFailure(
        "invalid-commit-port-result",
        "The authored receipt does not match the approved assembly transaction.",
      )
    const value = assemblyCommitViewSchema.parse({
      schemaVersion: 1,
      draftId: record.state.draftId,
      documentId: record.state.documentId,
      baseRevision: record.state.baseRevision,
      revision: receipt.value.revision,
      changeCount: record.changes.length,
    })
    drafts.delete(record.state.draftId)
    return bounded(value)
  }
  async function commit(record: AssemblyDraftRecord, signal?: AssemblyCancellation) {
    const current = guard(record.state.baseRevision, generation, signal)
    const exact = await preview(record, signal)
    if (!exact.ok) return exact
    const reviewed = await configuration.review({
      kind: "assembly",
      actor: commandActorSchema.parse(record.actor),
      documentName: record.snapshot.name,
      draft: assemblyDraftStateSchema.parse(exact.value.draft),
      changes: assemblyMutationsSchema.parse(record.changes),
      preview: assemblyDraftPreviewSchema.parse(exact.value),
    })
    const interrupted = current()
    if (interrupted) return interrupted
    if (Date.parse(exact.value.draft.expiresAt) <= now())
      return localFailure("draft-expired", "The assembly draft expired during review.")
    if (reviewed !== "approved")
      return localFailure("draft-review-cancelled", "The assembly proposal was not approved.")
    // Approval covers these captured changes; exact solvability is checked again before ordinary CAS.
    const checked = await exactPreview(record, exact.value.draft.expiresAt, signal)
    return checked.ok ? persistReviewed(record) : checked
  }
  async function inspect(
    operation: Extract<AssemblyOperation, { tool: "inspect_assembly" }>,
    signal?: AssemblyCancellation,
  ) {
    const current = guard(operation.arguments.revision, generation, signal)
    const interrupted = current()
    if (interrupted) return interrupted
    const exact = await configuration.inspect(operation.arguments.revision, operation.arguments)
    const changed = current()
    if (changed) return changed
    if (!exact.ok) return exact
    const view = assemblyInspectionViewSchema.parse(exact.value)
    return view.documentId === configuration.documentId &&
      view.revision === operation.arguments.revision
      ? bounded(view)
      : localFailure(
          "invalid-assembly-preview",
          "Exact assembly evidence belongs to a different document revision.",
        )
  }
  function executeOwned(
    actor: CommandActor,
    operation: OwnedAssemblyOperation,
    signal?: AssemblyCancellation,
  ) {
    const owned = ownedDraft(actor, operation.arguments)
    if (!owned.ok) return owned
    switch (operation.tool) {
      case "preview_assembly_draft":
        return preview(owned.value, signal)
      case "commit_assembly_draft":
        return commit(owned.value, signal)
      case "discard_assembly_draft": {
        drafts.delete(owned.value.state.draftId)
        return bounded(
          assemblyDiscardViewSchema.parse({
            schemaVersion: 1,
            draftId: owned.value.state.draftId,
            discarded: true,
          }),
        )
      }
      default: {
        const mutation = namedAssemblyMutation(operation)
        return mutation
          ? append(owned.value, [mutation])
          : localFailure("invalid-operation", "The named assembly operation is unavailable.")
      }
    }
  }
  async function sampleMotion(
    operation: Extract<AssemblyOperation, { tool: "sample_assembly_motion_study" }>,
    signal?: AssemblyCancellation,
  ) {
    const input = operation.arguments,
      current = guard(input.revision, generation, signal)
    const unavailable = current()
    if (unavailable) return unavailable
    const authority = snapshot()
    if (authority.schemaVersion !== 4 && authority.schemaVersion !== 5)
      return localFailure(
        "assembly-operation-failed",
        "The document has no persisted assembly study.",
      )
    const study = authority.assembly.motionStudies?.find(({ id }) => id === input.studyId)
    if (!study) return localFailure("assembly-operation-failed", "The motion study is missing.")
    if (
      input.instanceIds.some(
        (id) => !authority.assembly.instances.some((instance) => instance.id === id),
      )
    )
      return localFailure("assembly-operation-failed", "A selected motion occurrence is missing.")
    const result = await sampleAssemblyMotion({ configuration, authority, study, input, current })
    return result.ok ? bounded(result.value) : result
  }

  function executeAssembly(
    actor: CommandActor,
    operation: AssemblyOperation,
    signal?: AssemblyCancellation,
  ) {
    switch (operation.tool) {
      case "sample_assembly_motion_study":
        return sampleMotion(operation, signal)
      case "model_assembly":
        return guard(operation.arguments.revision)() ?? bounded(assemblyModelView(snapshot()))
      case "inspect_assembly":
        return inspect(operation, signal)
      case "create_assembly_draft":
        return createDraft(actor, operation.arguments.baseRevision)
      default:
        return executeOwned(actor, operation, signal)
    }
  }
  function requestAvailability(signal?: AssemblyCancellation) {
    return closed || signal?.aborted || !configuration.isActive()
      ? localFailure("session-revoked", "The paired assembly session is unavailable.")
      : null
  }
  function authorize(
    actorInput: unknown,
    input: unknown,
    signal?: AssemblyCancellation,
  ): AssemblyResult<{ actor: CommandActor; operation: Operation }> {
    const actor = commandActorSchema.safeParse(actorInput)
    const operation = operationSchema.safeParse(input)
    if (!actor.success || actor.data.type !== "mcp" || !operation.success)
      return localFailure(
        "invalid-operation",
        "Assembly automation requires a paired MCP actor and a named operation.",
      )
    if (owner && !commandActorsEqual(owner, actor.data))
      return localFailure(
        "draft-owner-mismatch",
        "This paired assembly session belongs to another actor.",
      )
    const unavailable = requestAvailability(signal)
    if (unavailable) return unavailable
    owner = actor.data
    return { ok: true, value: { actor: actor.data, operation: operation.data } }
  }
  function dispatch(actor: CommandActor, operation: Operation, signal?: AssemblyCancellation) {
    const library = libraryOperationSchema.safeParse(operation)
    return library.success
      ? executeLibraryOperation({
          configuration,
          actor,
          operation: library.data,
          snapshot,
          guard,
          ownedDraft,
          append,
          bounded,
          markPersisting: () => {
            persisting = true
          },
          signal,
        })
      : executeAssembly(actor, assemblyOperationSchema.parse(operation), signal)
  }
  return {
    async execute(
      actorInput: unknown,
      input: unknown,
      signal?: AssemblyCancellation,
    ): Promise<AssemblyResult<unknown>> {
      if (busy) return localFailure("busy", "Another assembly or library request is pending.", true)
      const authorized = authorize(actorInput, input, signal)
      if (!authorized.ok) return authorized
      busy = true
      try {
        return await dispatch(authorized.value.actor, authorized.value.operation, signal)
      } catch (error) {
        return assemblyFailure(
          persisting ? "document-commit-failed" : "assembly-operation-failed",
          error,
          persisting,
        )
      } finally {
        busy = false
        persisting = false
      }
    },
    cancel() {
      generation += 1
      drafts.clear()
    },
    dispose() {
      closed = true
      generation += 1
      drafts.clear()
    },
    isPersisting: () => persisting,
  }
}
