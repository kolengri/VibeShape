import { persistenceInvariantError } from "./diagnostics"
import type { LeaseRecord, WriterLeaseClaim } from "./schemas"

export function hasValidWriterLease(
  lease: LeaseRecord | undefined,
  sessionId: string,
  claim: WriterLeaseClaim | null,
) {
  if (!lease || !claim) return false
  return lease.ownerId === sessionId && lease.epoch === claim.epoch && lease.expiresAt > claim.nowMs
}

export function requireWriterLease(
  documentExists: boolean,
  lease: LeaseRecord | undefined,
  input: Readonly<{ sessionId: string; lease: WriterLeaseClaim | null }>,
) {
  if (!documentExists) {
    if (input.lease !== null)
      throw persistenceInvariantError(
        "invalid-input",
        "A new document cannot reference an existing writer lease.",
      )
    return
  }
  if (!hasValidWriterLease(lease, input.sessionId, input.lease))
    throw persistenceInvariantError("lease-lost", "The document writer lease is no longer valid.")
}
