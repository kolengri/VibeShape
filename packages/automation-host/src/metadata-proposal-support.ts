import {
  metadataChangeArgumentsSchema,
  metadataCommitViewSchema,
} from "@vibeshape/automation-api/authored-metadata"
import { automationDraftPreviewSchema } from "@vibeshape/automation-api/drafts"
import { localFailureSchema } from "@vibeshape/automation-api/local-tools"
import { serializedQueryBytes } from "@vibeshape/automation-api/query-byte-budget"
import { projectDocumentSnapshotV1ToV0 } from "@vibeshape/domain"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import {
  type DocumentSnapshotV2,
  documentSnapshotV2Schema,
  projectDocumentSnapshotV2ToV1,
} from "@vibeshape/domain/document-v2"
import {
  documentV2MetadataChangeSchema,
  documentV2MetadataCommandSchema,
} from "@vibeshape/domain/document-v2-command-schemas"
import { applyDocumentV2Command } from "@vibeshape/domain/document-v2-commands"
import { type DraftId, draftIdSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import type { DraftReviewInput } from "./draft-review"
import { evaluateDraftGeometry } from "./exact-draft-preview"
import type { AutomationHostDiagnosticCode, AutomationHostResult } from "./host"
import type {
  MetadataCommand,
  MetadataCommitView,
  MetadataProposalConfiguration,
} from "./metadata-proposal"

export const metadataProposalClockSchema = z
  .number()
  .int()
  .nonnegative()
  .max(8_640_000_000_000_000 - 300_000)
export function metadataProposalFailure(
  code: AutomationHostDiagnosticCode,
  message: string,
  retryable = false,
): Extract<AutomationHostResult<never>, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}
export type PreparedMetadataInput = {
  command: MetadataCommand
  draftId: DraftId
  expiresAt: number
}
export type PreparedMetadataProposal = PreparedMetadataInput & {
  base: DocumentSnapshotV2
  snapshot: DocumentSnapshotV2
  value: MetadataCommitView
}

function pairedMetadataActor(
  ownerInput: unknown,
  actorInput: unknown,
): AutomationHostResult<CommandActor> {
  const owner = commandActorSchema.safeParse(ownerInput)
  const supplied = commandActorSchema.safeParse(actorInput)
  if (
    !owner.success ||
    owner.data.type !== "mcp" ||
    !supplied.success ||
    supplied.data.type !== "mcp"
  )
    return metadataProposalFailure(
      "invalid-automation-actor",
      "Metadata requires a validated paired MCP actor.",
    )
  if (!commandActorsEqual(owner.data, supplied.data))
    return metadataProposalFailure(
      "draft-owner-mismatch",
      "The metadata actor does not own this paired session.",
    )
  return { ok: true, value: owner.data }
}

export function parseMetadataProposalInput(
  configuration: MetadataProposalConfiguration,
  actorInput: unknown,
  input: unknown,
  time: number,
): AutomationHostResult<PreparedMetadataInput> {
  const actor = pairedMetadataActor(configuration.actor, actorInput)
  if (!actor.ok) return actor
  const request = metadataChangeArgumentsSchema.safeParse(input)
  if (!request.success || serializedQueryBytes(request.data, 192 * 1024) > 192 * 1024)
    return metadataProposalFailure(
      "invalid-draft-request",
      "The bounded metadata change is invalid.",
    )
  const at = metadataProposalClockSchema.safeParse(time)
  if (!at.success)
    return metadataProposalFailure("invalid-host-clock", "The proposal clock is invalid.")
  const draftId = draftIdSchema.safeParse(configuration.createDraftId())
  if (!draftId.success)
    return metadataProposalFailure(
      "invalid-generated-draft-id",
      "The proposal identifier is invalid.",
    )
  return {
    ok: true,
    value: {
      draftId: draftId.data,
      expiresAt: at.data + 300_000,
      command: documentV2MetadataCommandSchema.parse({
        kind: "org.vibeshape.document.metadata-command",
        schemaVersion: 2,
        documentId: configuration.documentId,
        commandId: request.data.commandId,
        baseRevision: request.data.baseRevision,
        issuedAt: new Date(at.data).toISOString(),
        actor: actor.value,
        payload: request.data.change,
      }),
    },
  }
}

export async function prepareMetadataProposal(
  configuration: MetadataProposalConfiguration,
  input: PreparedMetadataInput,
): Promise<AutomationHostResult<PreparedMetadataProposal>> {
  const before = documentSnapshotV2Schema.safeParse(await configuration.readSnapshot())
  if (!before.success || before.data.id !== configuration.documentId)
    return metadataProposalFailure(
      "invalid-document-snapshot",
      "The paired authored document is unavailable.",
    )
  if (before.data.revision !== input.command.baseRevision)
    return metadataProposalFailure(
      "stale-revision",
      "The metadata base revision is no longer current.",
      true,
    )
  if (await configuration.hasCommandId(input.command.commandId))
    return metadataProposalFailure(
      "duplicate-command-id",
      "The command identifier already exists in the journal.",
    )
  const prepared = applyDocumentV2Command(before.data, input.command)
  if (!prepared.ok) return { ok: false, diagnostic: { ...prepared.diagnostic, issues: [] } }
  const value = metadataCommitViewSchema.parse({
    documentId: input.command.documentId,
    commandId: input.command.commandId,
    baseRevision: input.command.baseRevision,
    revision: prepared.snapshot.revision,
    change: input.command.payload,
  })
  if (serializedQueryBytes({ ok: true, value }) > 128 * 1024)
    return metadataProposalFailure(
      "query-result-too-large",
      "The metadata change exceeds the bounded response budget.",
    )
  return { ok: true, value: { ...input, base: before.data, snapshot: prepared.snapshot, value } }
}

function historyRange(
  base: DocumentSnapshotV2,
  items: readonly HistoryItemRef[] | undefined,
): NonNullable<DraftReviewInput["metadata"]>["range"] {
  const first = items?.[0]
  const last = items?.at(-1)
  if (!first || !last) return null
  const itemLabel = (item: HistoryItemRef) =>
    (item.kind === "feature" ? base.features : base.sketches).find((entry) => entry.id === item.id)
      ?.label ?? item.id
  return {
    first,
    last,
    count: items?.length ?? 0,
    firstLabel: itemLabel(first),
    lastLabel: itemLabel(last),
  }
}

function metadataReviewDetails({
  base,
  command,
}: PreparedMetadataProposal): NonNullable<DraftReviewInput["metadata"]> {
  const change = documentV2MetadataChangeSchema.parse(command.payload)
  if ("partId" in change)
    return {
      change,
      targetName: base.parts.find((part) => part.id === change.partId)?.name ?? null,
      range: null,
    }
  if (change.kind === "folder.create")
    return {
      change,
      targetName: change.folder.name,
      range: historyRange(base, change.folder.items),
    }
  const folder = base.folders.find((entry) => entry.id === change.folderId)
  const items = change.kind === "folder.set-items" ? change.items : folder?.items
  return { change, targetName: folder?.name ?? null, range: historyRange(base, items) }
}

export async function previewMetadataProposal(
  configuration: MetadataProposalConfiguration,
  proposal: PreparedMetadataProposal,
): Promise<AutomationHostResult<DraftReviewInput>> {
  const projected = projectDocumentSnapshotV1ToV0(projectDocumentSnapshotV2ToV1(proposal.snapshot))
  if (!projected.ok)
    return metadataProposalFailure("invalid-document-snapshot", projected.diagnostic.message)
  const exact = await evaluateDraftGeometry(
    projected.snapshot,
    configuration.geometry,
    configuration.queries,
  )
  if (!exact.ok) return exact
  if (exact.geometry.status !== "valid")
    return metadataProposalFailure(
      "draft-geometry-invalid",
      "The metadata preview has invalid exact geometry.",
    )
  const summary = configuration.queries.dispatch(projected.snapshot, {
    kind: "org.vibeshape.document.summary",
    schemaVersion: 1,
    documentId: proposal.command.documentId,
    revision: proposal.snapshot.revision,
  })
  if (!summary.ok) return summary
  if (summary.view.kind !== "org.vibeshape.document.summary")
    return metadataProposalFailure("invalid-review-result", "The metadata summary is invalid.")
  const preview = automationDraftPreviewSchema.parse({
    schemaVersion: 2,
    draft: {
      schemaVersion: 1,
      draftId: proposal.draftId,
      documentId: proposal.command.documentId,
      baseRevision: proposal.command.baseRevision,
      revision: proposal.snapshot.revision,
      commandCount: 1,
      expiresAt: new Date(proposal.expiresAt).toISOString(),
    },
    summary: summary.view,
    geometry: exact.geometry,
  })
  return {
    ok: true,
    value: {
      actor: commandActorSchema.parse(proposal.command.actor),
      preview,
      commands: [],
      metadata: metadataReviewDetails(proposal),
    },
  }
}

export function metadataReviewDecision(input: unknown) {
  const decision = z.enum(["approved", "rejected", "cancelled"]).safeParse(input)
  if (!decision.success)
    return metadataProposalFailure(
      "invalid-review-result",
      "The metadata review decision is invalid.",
    )
  if (decision.data !== "approved")
    return metadataProposalFailure(
      decision.data === "rejected" ? "draft-review-rejected" : "draft-review-cancelled",
      "The metadata proposal was not approved.",
    )
  return null
}

export async function recheckMetadataProposal(
  configuration: MetadataProposalConfiguration,
  proposal: PreparedMetadataProposal,
) {
  const current = documentSnapshotV2Schema.safeParse(await configuration.readSnapshot())
  if (!current.success || canonicalJson(current.data) !== canonicalJson(proposal.base))
    return metadataProposalFailure(
      "stale-revision",
      "The authored document changed during metadata review.",
      true,
    )
  if (await configuration.hasCommandId(proposal.command.commandId))
    return metadataProposalFailure(
      "duplicate-command-id",
      "The command identifier already exists in the journal.",
    )
  return null
}

export function validateMetadataCommitReceipt(
  committed: unknown,
  expected: MetadataCommitView,
): AutomationHostResult<MetadataCommitView> {
  const rejected = localFailureSchema.safeParse(committed)
  if (rejected.success) {
    const code = z
      .enum([
        "stale-revision",
        "duplicate-command-id",
        "document-write-unavailable",
        "draft-commit-intent-mismatch",
      ])
      .safeParse(rejected.data.diagnostic.code)
    return metadataProposalFailure(
      code.success ? code.data : "document-commit-failed",
      rejected.data.diagnostic.message,
      rejected.data.diagnostic.retryable,
    )
  }
  const validated = metadataCommitViewSchema.safeParse(committed)
  if (!validated.success || canonicalJson(validated.data) !== canonicalJson(expected))
    return metadataProposalFailure(
      "invalid-commit-port-result",
      "The metadata save result could not be confirmed.",
    )
  return { ok: true, value: validated.data }
}
