import { localFailure } from "@vibeshape/automation-api/local-tools"
import {
  type SurfaceTextureMutationOperation,
  type SurfaceTextureOperation,
  type SurfaceTexturePreviewEvidence,
  surfaceTextureCommitViewSchema,
  surfaceTextureOperationSchema,
  surfaceTexturePreviewEvidenceSchema,
} from "@vibeshape/automation-api/surface-texture-tools"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"
import { metadataProposalClockSchema } from "./metadata-proposal-support"
import {
  type SurfaceTextureCancellation,
  type SurfaceTextureProposalConfiguration,
  type SurfaceTextureResult,
  type SurfaceTextureReviewedInput,
  surfaceTextureCommandSchema,
} from "./surface-texture-proposal-contract"
import {
  prepareSurfaceTextureProposal,
  readSurfaceTextureAuthority,
  readSurfaceTextures,
  SurfaceTexturePreparationError,
} from "./surface-texture-proposal-support"

function commitReceiptResult(
  documentId: string,
  input: SurfaceTextureReviewedInput,
  preview: SurfaceTexturePreviewEvidence,
  committed: SurfaceTextureResult<{ documentId: string; revision: number }>,
) {
  if (!committed.ok) return committed
  if (
    committed.value.documentId !== documentId ||
    committed.value.revision !== input.draft.baseRevision + 1
  )
    return localFailure(
      "document-commit-failed",
      "The texture save could not be confirmed; inspect the saved project before retrying.",
      true,
    )
  return {
    ok: true as const,
    value: surfaceTextureCommitViewSchema.parse({
      schemaVersion: 1,
      documentId,
      baseRevision: input.draft.baseRevision,
      revision: committed.value.revision,
      featureId: input.command.payload.featureId,
      layerId: input.layerId,
      operation: input.operation,
      preview,
    }),
  }
}

export function createSurfaceTextureProposalCoordinator(
  configuration: SurfaceTextureProposalConfiguration,
) {
  const now = configuration.now ?? Date.now
  let owner: CommandActor | null = null
  let closed = false
  let busy = false
  let persisting = false
  let generation = 0
  const seen = new Set<string>()
  const cloneInput = (input: SurfaceTextureReviewedInput): SurfaceTextureReviewedInput => ({
    ...input,
    actor: commandActorSchema.parse(input.actor),
    draft: { ...input.draft },
    command: surfaceTextureCommandSchema.parse(input.command),
  })

  function interrupted(captured: number, signal?: SurfaceTextureCancellation, expiresAt?: string) {
    if (closed || !configuration.isActive())
      return localFailure("session-revoked", "The texture session is unavailable.")
    if (generation !== captured || signal?.aborted)
      return localFailure("draft-review-cancelled", "The texture proposal was cancelled.")
    if (expiresAt !== undefined && now() >= Date.parse(expiresAt))
      return localFailure("draft-expired", "The texture proposal expired.")
    return null
  }
  async function currentSnapshot(
    captured: number,
    revision: number,
    signal?: SurfaceTextureCancellation,
    expiresAt?: string,
  ) {
    const before = interrupted(captured, signal, expiresAt)
    if (before) return before
    const value = await configuration.readSnapshot()
    const after = interrupted(captured, signal, expiresAt)
    if (after) return after
    const snapshot = readSurfaceTextureAuthority(value)
    return snapshot.id === configuration.documentId && snapshot.revision === revision
      ? { ok: true as const, value: snapshot }
      : localFailure("stale-revision", "The texture source revision changed.", true)
  }
  async function checkedPreview(
    input: SurfaceTextureReviewedInput,
    captured: number,
    signal?: SurfaceTextureCancellation,
  ) {
    const current = await currentSnapshot(
      captured,
      input.draft.baseRevision,
      signal,
      input.draft.expiresAt,
    )
    if (!current.ok) return current
    const result = await configuration.preview(cloneInput(input), signal)
    const after = await currentSnapshot(
      captured,
      input.draft.baseRevision,
      signal,
      input.draft.expiresAt,
    )
    if (!after.ok) return after
    return result.ok
      ? { ok: true as const, value: surfaceTexturePreviewEvidenceSchema.parse(result.value) }
      : result
  }
  async function reviewPrepared(
    prepared: ReturnType<typeof prepareSurfaceTextureProposal>,
    captured: number,
    signal?: SurfaceTextureCancellation,
  ) {
    const { input } = prepared
    const identity = canonicalJson(input)
    const preview = await checkedPreview(input, captured, signal)
    if (!preview.ok) return preview
    const decision = await configuration.review({
      ...cloneInput(input),
      kind: "surface-texture",
      documentName: prepared.documentName,
      featureName: prepared.featureName,
      preview: preview.value,
    })
    const current = await currentSnapshot(
      captured,
      input.draft.baseRevision,
      signal,
      input.draft.expiresAt,
    )
    if (!current.ok) return current
    if (decision !== "approved")
      return localFailure("draft-review-cancelled", "The texture proposal was not applied.")
    if (canonicalJson(input) !== identity)
      return localFailure("draft-commit-intent-mismatch", "The reviewed texture intent changed.")
    return checkedPreview(input, captured, signal)
  }
  async function mutate(
    operation: SurfaceTextureMutationOperation,
    actor: CommandActor,
    captured: number,
    signal?: SurfaceTextureCancellation,
  ) {
    const base = await currentSnapshot(captured, operation.arguments.baseRevision, signal)
    if (!base.ok) return base
    const prepared = prepareSurfaceTextureProposal(
      configuration,
      base.value,
      operation,
      actor,
      metadataProposalClockSchema.parse(now()),
    )
    const { input } = prepared
    if (seen.has(input.command.commandId))
      return localFailure(
        "duplicate-command-id",
        "The texture proposal identifier was already used.",
      )
    if (seen.size >= 4096)
      return localFailure(
        "draft-limit-reached",
        "Reconnect to start a new bounded texture session.",
      )
    seen.add(input.command.commandId)
    const checked = await reviewPrepared(prepared, captured, signal)
    if (!checked.ok) return checked
    const beforeWrite = interrupted(captured, signal, input.draft.expiresAt)
    if (beforeWrite) return beforeWrite
    persisting = true
    const committed = await configuration.commit(cloneInput(input))
    return commitReceiptResult(configuration.documentId, input, checked.value, committed)
  }
  function validateRequest(actorInput: unknown, operationInput: unknown) {
    if (busy) return localFailure("busy", "Another texture proposal is pending.", true)
    const actor = commandActorSchema.safeParse(actorInput)
    if (!actor.success || actor.data.type !== "mcp")
      return localFailure("invalid-automation-actor", "Textures require a paired MCP actor.")
    if (owner && !commandActorsEqual(owner, actor.data))
      return localFailure("draft-owner-mismatch", "The texture session belongs to another actor.")
    const parsed = surfaceTextureOperationSchema.safeParse(operationInput)
    if (!parsed.success)
      return localFailure("invalid-operation", "The texture operation is invalid.")
    return { ok: true as const, actor: actor.data, operation: parsed.data }
  }
  async function runOperation(
    actor: CommandActor,
    operation: SurfaceTextureOperation,
    captured: number,
    signal?: SurfaceTextureCancellation,
  ) {
    if (operation.tool !== "model_surface_textures")
      return mutate(operation, actor, captured, signal)
    const result = await currentSnapshot(captured, operation.arguments.revision, signal)
    return result.ok
      ? {
          ok: true as const,
          value: readSurfaceTextures(result.value, operation.arguments.featureId),
        }
      : result
  }
  function operationFailure(error: unknown, captured: number, signal?: SurfaceTextureCancellation) {
    if (!persisting) {
      const cancelled = interrupted(captured, signal)
      if (cancelled) return cancelled
      if (error instanceof SurfaceTexturePreparationError)
        return localFailure(error.code, error.message)
    }
    return localFailure(
      persisting ? "document-commit-failed" : "surface-texture-operation-failed",
      persisting
        ? "The texture save could not be confirmed; inspect the saved project before retrying."
        : "The texture proposal could not be completed.",
      persisting,
    )
  }
  return {
    async execute(
      actorInput: unknown,
      operationInput: unknown,
      signal?: SurfaceTextureCancellation,
    ) {
      const parsed = validateRequest(actorInput, operationInput)
      if (!parsed.ok) return parsed
      owner ??= parsed.actor
      const captured = generation
      const before = interrupted(captured, signal)
      if (before) return before
      busy = true
      try {
        return await runOperation(parsed.actor, parsed.operation, captured, signal)
      } catch (error) {
        return operationFailure(error, captured, signal)
      } finally {
        busy = false
        persisting = false
      }
    },
    cancel() {
      generation += 1
    },
    dispose() {
      closed = true
      generation += 1
    },
    isPersisting: () => persisting,
  }
}
