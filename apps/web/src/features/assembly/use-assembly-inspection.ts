import type { AssemblyInspection } from "@vibeshape/protocol"
import { useCallback, useEffect, useRef, useState } from "react"
import { inspectActiveAssembly } from "../../document/document-controller"
import type { AssemblyDocumentContext } from "./assembly-model"

type Pair = { leftInstanceId: string; rightInstanceId: string }
type InspectionOutcome = { inspection: AssemblyInspection | null; diagnostic: string | null }
type InspectionState = InspectionOutcome & { key: string; pending: boolean }
async function requestInspection(
  pairs: readonly Pair[],
  signal: AbortSignal,
): Promise<InspectionOutcome> {
  try {
    const result = await inspectActiveAssembly(pairs, signal)
    return result.ok
      ? { inspection: result.inspection, diagnostic: null }
      : { inspection: null, diagnostic: result.diagnostic.message }
  } catch {
    return { inspection: null, diagnostic: "inspection-failed" }
  }
}
export function useAssemblyInspection(context: AssemblyDocumentContext | null) {
  const key = context ? `${context.documentId}:${context.revision}` : "unavailable"
  const generation = useRef(0)
  const pairLock = useRef(false)
  const scope = useRef<{ key: string; controller: AbortController } | null>(null)
  const [state, setState] = useState<InspectionState>({
    key,
    inspection: null,
    pending: false,
    diagnostic: null,
  })
  const publish = useCallback(
    (token: number, outcome: InspectionOutcome) => {
      if (generation.current !== token) return
      setState((previous) => ({
        key,
        pending: false,
        diagnostic: outcome.diagnostic,
        inspection: outcome.inspection ?? previous.inspection,
      }))
    },
    [key],
  )
  useEffect(() => {
    const token = ++generation.current
    pairLock.current = false
    setState({ key, inspection: null, pending: key !== "unavailable", diagnostic: null })
    if (key === "unavailable") return
    const controller = new AbortController()
    scope.current = { key, controller }
    void requestInspection([], controller.signal).then((outcome) => publish(token, outcome))
    return () => {
      generation.current += 1
      scope.current = null
      controller.abort()
    }
  }, [key, publish])
  const inspectPairs = useCallback(
    async (pairs: readonly Pair[]) => {
      const active = scope.current
      if (pairLock.current || !active || active.key !== key) return
      pairLock.current = true
      const token = ++generation.current
      setState((previous) => ({ ...previous, pending: true, diagnostic: null }))
      try {
        publish(token, await requestInspection(pairs, active.controller.signal))
      } finally {
        if (generation.current === token) pairLock.current = false
      }
    },
    [key, publish],
  )
  const current =
    state.key === key ? state : { key, inspection: null, pending: true, diagnostic: null }
  return { ...current, inspectPairs }
}
