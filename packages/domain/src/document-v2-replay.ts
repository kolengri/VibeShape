import { z } from "zod"
import { type DomainDiagnostic, domainDiagnostic } from "./command-support"
import { type DocumentAuthoritySnapshot, documentAuthoritySnapshotSchema } from "./document-v2"
import {
  type DocumentAuthorityEvent,
  documentAuthorityEventSchema,
} from "./document-v2-command-schemas"
import { reduceDocumentV2Event } from "./document-v2-commands"
import { reduceDocumentUpgradedV2Event } from "./document-v2-migration"
import { reduceVersionedDocumentEvent } from "./versioned-document-commands"

export type DocumentAuthorityResult =
  | Readonly<{ ok: true; snapshot: DocumentAuthoritySnapshot }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

export function reduceDocumentAuthorityEvent(
  snapshot: DocumentAuthoritySnapshot | null,
  input: unknown,
  target?: DocumentAuthoritySnapshot,
): DocumentAuthorityResult {
  const event = documentAuthorityEventSchema.safeParse(input)
  if (!event.success)
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "The document event version or payload is unsupported.",
      ),
    }
  if (event.data.schemaVersion === 2) {
    return event.data.type === "org.vibeshape.document.upgraded-v2"
      ? reduceDocumentUpgradedV2Event(snapshot, event.data)
      : reduceDocumentV2Event(snapshot, event.data, target)
  }
  if (snapshot?.schemaVersion === 2)
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "Legacy events cannot mutate V2 authority without captured part effects.",
      ),
    }
  return reduceVersionedDocumentEvent(
    snapshot,
    event.data,
    target?.schemaVersion === 1 ? target : undefined,
  )
}

function restoreTargetUses(events: readonly DocumentAuthorityEvent[]) {
  const uses = new Map<number, number>()
  for (const event of events)
    if (event.type === "org.vibeshape.document.restored")
      uses.set(event.targetRevision, (uses.get(event.targetRevision) ?? 0) + 1)
  return uses
}

function releaseRestoreTarget(
  event: DocumentAuthorityEvent,
  uses: Map<number, number>,
  targets: Map<number, DocumentAuthoritySnapshot>,
) {
  if (event.type !== "org.vibeshape.document.restored") return
  const remaining = (uses.get(event.targetRevision) ?? 1) - 1
  if (remaining > 0) uses.set(event.targetRevision, remaining)
  else {
    uses.delete(event.targetRevision)
    targets.delete(event.targetRevision)
  }
}

/** A bounded mixed suffix; a seed is a validated checkpoint, not a claim of complete history. */
export function replayDocumentAuthorityEvents(
  seedInput: unknown,
  eventInputs: readonly unknown[],
): DocumentAuthorityResult {
  const seed = documentAuthoritySnapshotSchema.nullable().safeParse(seedInput)
  const events = z.array(documentAuthorityEventSchema).max(100_000).safeParse(eventInputs)
  if (!seed.success || !events.success)
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "The document authority replay input is invalid.",
      ),
    }
  const referenced = restoreTargetUses(events.data)
  const targets = new Map<number, DocumentAuthoritySnapshot>()
  let snapshot: DocumentAuthoritySnapshot | null = seed.data
  if (snapshot && referenced.has(snapshot.revision)) targets.set(snapshot.revision, snapshot)
  const commands = new Set<string>()
  for (const event of events.data) {
    if (commands.has(event.commandId))
      return {
        ok: false,
        diagnostic: domainDiagnostic(
          "invalid-event",
          "A journal cannot repeat a command identity.",
        ),
      }
    commands.add(event.commandId)
    const target =
      event.type === "org.vibeshape.document.restored"
        ? targets.get(event.targetRevision)
        : undefined
    const reduced = reduceDocumentAuthorityEvent(snapshot, event, target)
    if (!reduced.ok) return reduced
    snapshot = reduced.snapshot
    releaseRestoreTarget(event, referenced, targets)
    if (referenced.has(snapshot.revision)) targets.set(snapshot.revision, snapshot)
  }
  return snapshot
    ? { ok: true, snapshot }
    : {
        ok: false,
        diagnostic: domainDiagnostic(
          "document-not-found",
          "The event history does not create a document.",
        ),
      }
}

export type DocumentAuthorityJournal = Readonly<{
  seed: DocumentAuthoritySnapshot | null
  events: readonly DocumentAuthorityEvent[]
}>
