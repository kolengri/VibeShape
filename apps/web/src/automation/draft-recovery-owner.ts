import {
  type DraftRecoveryCapture,
  type DraftRecoveryJournal,
  draftRecoveryCaptureSchema,
  recoverableDraftsViewSchema,
  recoverySemanticPayload,
  restoredDraftViewSchema,
} from "@vibeshape/automation-api/draft-recovery"
import type { LocalConnection } from "@vibeshape/automation-api/local-session"
import { type LocalOperation, localFailure } from "@vibeshape/automation-api/local-tools"
import type { AutomationHost, AutomationHostResult } from "@vibeshape/automation-host/host"
import { commandActorsEqual } from "@vibeshape/domain/commands"
import type { DocumentId } from "@vibeshape/domain/identifiers"
import { z } from "zod"

type Identity = Readonly<{ id: DocumentId; revision: number }>
type Handle = Readonly<{ host: AutomationHost; readIdentity: () => Identity | null }>
type RecoveryOperation = Extract<
  LocalOperation,
  { tool: "list_recoverable_drafts" | "restore_draft" }
>
export type DraftRecoveryPort = Readonly<{
  execute: (operation: RecoveryOperation, signal?: AbortSignal) => Promise<unknown>
}>

/** This connection owns pure intent only; disposed handles and render resources are never retained. */
export function createDraftRecoveryOwner(now = Date.now) {
  let epoch = 0
  let journals: readonly DraftRecoveryJournal[] = []
  let pending: Promise<void> | null = null
  let failure: ReturnType<typeof localFailure> | null = null
  let lineage: {
    token: string
    documentId: DocumentId
    client: LocalConnection["client"]
    actor: LocalConnection["actor"] | null
  } | null = null
  function clear() {
    epoch++
    journals = []
    pending = null
    failure = null
    lineage = null
  }
  function acceptCapture(
    result: AutomationHostResult<DraftRecoveryCapture>,
    retained: readonly DraftRecoveryJournal[],
  ) {
    if (!result.ok) {
      journals = []
      failure = localFailure(result.diagnostic.code, result.diagnostic.message)
      return
    }
    const merged = new Map(
      retained.map((journal) => [journal.origin?.draftId ?? journal.originalDraftId, journal]),
    )
    for (const journal of result.value.journals)
      merged.set(journal.origin?.draftId ?? journal.originalDraftId, journal)
    const capture = draftRecoveryCaptureSchema.safeParse(
      JSON.parse(JSON.stringify({ schemaVersion: 1, journals: [...merged.values()] })),
    )
    if (!capture.success) {
      journals = []
      failure = localFailure(
        "draft-recovery-too-large",
        "The complete recovery journal exceeds its budget; no partial journal was retained.",
      )
      return
    }
    journals = capture.data.journals
    failure = null
  }
  function retain(handle: Handle, credential: LocalConnection) {
    const identity = handle.readIdentity()
    const retained = lineage?.token === credential.token ? journals : []
    clear()
    if (!identity) return
    const at = epoch
    lineage = {
      token: credential.token,
      client: credential.client,
      documentId: identity.id,
      actor: null,
    }
    const capture = handle.host?.captureDraftRecovery?.(credential.actor)
    if (!capture) return
    pending = capture
      .then(
        (result) => {
          if (epoch === at) acceptCapture(result, retained)
        },
        () => {
          if (epoch === at)
            failure = localFailure(
              "draft-recovery-unavailable",
              "Accepted private intent could not be captured completely.",
            )
        },
      )
      .finally(() => {
        if (epoch === at) pending = null
      })
  }
  function authorize(
    previousToken: string | undefined,
    credential: LocalConnection,
    identity: Identity,
  ) {
    if (
      !lineage ||
      lineage.token !== previousToken ||
      lineage.documentId !== identity.id ||
      lineage.client.name !== credential.client.name ||
      lineage.client.version !== credential.client.version ||
      credential.expiresAt <= now()
    ) {
      clear()
      return
    }
    lineage = { ...lineage, token: credential.token, actor: credential.actor }
  }
  function bind(
    handle: Handle,
    readCredential: () => LocalConnection,
    isCurrent: () => boolean,
  ): DraftRecoveryPort {
    function allowed(signal?: AbortSignal) {
      const credential = readCredential()
      return (
        !signal?.aborted &&
        isCurrent() &&
        credential.expiresAt > now() &&
        (!lineage ||
          (lineage.token === credential.token &&
            lineage.actor !== null &&
            commandActorsEqual(lineage.actor, credential.actor)))
      )
    }
    async function list(identity: Identity) {
      journals = journals.filter(
        (journal) => journal.expiresAt > now() && journal.baseRevision === identity.revision,
      )
      const view = recoverableDraftsViewSchema.safeParse({
        schemaVersion: 1,
        documentId: identity.id,
        revision: identity.revision,
        items: journals.map((journal) => ({
          recoveryId: journal.originalDraftId,
          originalDraftId: journal.originalDraftId,
          baseRevision: journal.baseRevision,
          privateRevision: journal.privateRevision,
          commandCount: journal.commands.length,
          expiresAt: new Date(journal.expiresAt).toISOString(),
          intent: journal.commands.map((command) => ({
            kind: command.kind,
            schemaVersion: command.schemaVersion,
            payload: recoverySemanticPayload(z.json().parse(command.payload)),
          })),
        })),
      })
      return view.success
        ? { ok: true, value: view.data }
        : localFailure(
            "draft-recovery-too-large",
            "The complete recovery view exceeds 128 KiB; no partial intent was returned.",
          )
    }
    function recoveryJournal(
      operation: Extract<RecoveryOperation, { tool: "restore_draft" }>,
      identity: Identity,
    ) {
      const journal = journals.find(
        (item) => item.originalDraftId === operation.arguments.recoveryId,
      )
      if (!journal)
        return localFailure(
          "draft-not-found",
          "The recoverable intent is unavailable or was already adopted.",
        )
      if (journal.expiresAt <= now())
        return localFailure("draft-expired", "The recoverable intent expired.")
      if (
        journal.documentId !== identity.id ||
        journal.baseRevision !== identity.revision ||
        operation.arguments.baseRevision !== identity.revision
      )
        return localFailure(
          "stale-revision",
          "The saved model changed; reconcile its current revision before restoring intent.",
          true,
        )
      return { ok: true as const, journal }
    }
    async function restore(
      operation: Extract<RecoveryOperation, { tool: "restore_draft" }>,
      identity: Identity,
      signal?: AbortSignal,
    ) {
      const recovered = recoveryJournal(operation, identity)
      if (!recovered.ok) return recovered
      const { journal } = recovered
      if (!handle.host.restoreDraft)
        return localFailure(
          "draft-recovery-unavailable",
          "This document cannot restore private intent.",
        )
      const credential = readCredential()
      const result = await handle.host.restoreDraft(credential.actor, journal)
      if (!allowed(signal)) {
        if (result.ok)
          await handle.host.discardDraft(credential.actor, {
            schemaVersion: 1,
            draftId: result.value.draftId,
          })
        return localFailure(
          "request-cancelled",
          "The recovery owner changed before restoration finished.",
        )
      }
      if (!result.ok)
        return localFailure(
          result.diagnostic.code,
          result.diagnostic.message,
          result.diagnostic.retryable,
        )
      journals = journals.filter((item) => item !== journal)
      return {
        ok: true,
        value: restoredDraftViewSchema.parse({
          schemaVersion: 1,
          recoveryId: journal.originalDraftId,
          attribution: { type: "current-actor", actor: credential.actor },
          draft: result.value,
        }),
      }
    }
    return {
      async execute(operation, signal) {
        await pending
        if (!allowed(signal))
          return localFailure(
            "request-cancelled",
            "Authenticated recovery is unavailable for this connection owner.",
          )
        const identity = handle.readIdentity()
        if (!identity || (lineage && lineage.documentId !== identity.id))
          return localFailure(
            "document-write-unavailable",
            "The captured recovery project is unavailable.",
          )
        if (failure) return failure
        return operation.tool === "list_recoverable_drafts"
          ? list(identity)
          : restore(operation, identity, signal)
      },
    }
  }
  return { clear, retain, authorize, bind }
}
