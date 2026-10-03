import { canonicalJson } from "./canonical-json"
import { type DomainDiagnostic, domainDiagnostic } from "./command-support"
import type { DocumentAuthoritySnapshot, DocumentSnapshotV2 } from "./document-v2"
import type { DocumentV2Event } from "./document-v2-command-schemas"
import type { PartAllocation, PartEffect } from "./parts"

export type DocumentV2Result =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV2 }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>
export type DocumentV2CommandResult =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV2; event: DocumentV2Event }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

export function invalidV2(
  message: string,
  code: DomainDiagnostic["code"] = "invalid-event",
): Extract<DocumentV2Result, { ok: false }> {
  return { ok: false, diagnostic: domainDiagnostic(code, message, code === "stale-revision") }
}

export function validateV2Envelope(
  snapshot: DocumentAuthoritySnapshot,
  event: DocumentV2Event,
): Extract<DocumentV2Result, { ok: false }> | null {
  if (event.documentId !== snapshot.id)
    return invalidV2("The operation targets a different document.", "document-id-mismatch")
  if (snapshot.revision === Number.MAX_SAFE_INTEGER)
    return invalidV2("The document revision cannot advance safely.", "revision-exhausted")
  if (event.baseRevision !== snapshot.revision || event.revision !== snapshot.revision + 1)
    return invalidV2(
      "The operation does not extend the current document revision.",
      "stale-revision",
    )
  return null
}

export function sameOperationEnvelope(
  left: {
    commandId: string
    documentId: string
    baseRevision: number
    issuedAt: string
    actor: unknown
  },
  right: typeof left,
): boolean {
  return (
    left.commandId === right.commandId &&
    left.documentId === right.documentId &&
    left.baseRevision === right.baseRevision &&
    left.issuedAt === right.issuedAt &&
    canonicalJson(left.actor) === canonicalJson(right.actor)
  )
}

export function allocationsFromEffects(effects: readonly PartEffect[]): readonly PartAllocation[] {
  return effects.flatMap((effect) => {
    const body = effect.kind === "create" ? effect.part.bodyHistory[0] : undefined
    return effect.kind === "create" && body
      ? [{ id: effect.part.id, body, name: effect.part.name, origin: effect.part.origin }]
      : []
  })
}
