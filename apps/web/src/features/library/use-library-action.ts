import { useEffect, useRef, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { libraryDocumentScope, libraryScopeMatches } from "./library-model"

type ActionOutcome<T> = { ok: true; value?: T } | { ok: false; diagnostic: { message: string } }
export function useLibraryAction(
  controller: DocumentControllerState,
  stale: string,
  failed: string,
) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const lock = useRef(false)
  const active = useRef(true)
  const scope = useRef(libraryDocumentScope(controller))
  const { documentId, revision } = libraryDocumentScope(controller)
  useEffect(() => {
    scope.current = { documentId, revision }
  }, [documentId, revision])
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const run = async <T>(
    operation: () => Promise<ActionOutcome<T>>,
    onSuccess: (value: T | undefined) => void,
    revisionSensitive = true,
  ) => {
    if (lock.current) return
    lock.current = true
    const captured = scope.current
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const result = await operation()
      if (!active.current) return
      if (!libraryScopeMatches(captured, scope.current, revisionSensitive)) {
        setError(stale)
        return
      }
      if (!result.ok) {
        setError(result.diagnostic.message)
        return
      }
      onSuccess(result.value)
    } catch {
      if (active.current) setError(failed)
    } finally {
      lock.current = false
      if (active.current) setPending(false)
    }
  }
  return { pending, error, notice, run, setError, setNotice, isPending: () => lock.current }
}
export type LibraryAction = ReturnType<typeof useLibraryAction>
