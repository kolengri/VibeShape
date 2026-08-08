import { isError } from "is-what"
import { type PersistenceDiagnostic, persistenceDiagnosticSchema } from "./schemas"

export class PersistenceInvariantError extends Error {
  constructor(readonly diagnostic: PersistenceDiagnostic) {
    super(diagnostic.message)
  }
}

export function createPersistenceDiagnostic(
  code: PersistenceDiagnostic["code"],
  message: string,
  retryable = false,
) {
  return persistenceDiagnosticSchema.parse({ code, message, retryable })
}

export function persistenceInvariantError(code: PersistenceDiagnostic["code"], message: string) {
  return new PersistenceInvariantError(
    createPersistenceDiagnostic(code, message, code === "stale-revision"),
  )
}

export function classifyPersistenceError(error: unknown): PersistenceDiagnostic {
  if (error instanceof PersistenceInvariantError) return error.diagnostic
  const name = isError(error) ? error.name : ""
  if (name === "QuotaExceededError") {
    return createPersistenceDiagnostic(
      "quota-exceeded",
      "Browser storage quota was exceeded. Export a recovery file before continuing.",
      true,
    )
  }
  if (name === "AbortError") {
    return createPersistenceDiagnostic(
      "transaction-aborted",
      "The storage transaction was aborted.",
      true,
    )
  }
  return createPersistenceDiagnostic(
    "storage-unavailable",
    "Local browser storage is unavailable.",
    true,
  )
}
