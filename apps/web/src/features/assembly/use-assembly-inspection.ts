import type { AssemblyInspection } from "@vibeshape/protocol"
import { useCallback, useEffect, useRef, useState } from "react"
import { inspectActiveAssembly } from "../../document/document-controller"
import type { AssemblyDocumentContext } from "./assembly-model"

type Pair = { leftInstanceId: string; rightInstanceId: string }
type InspectionOutcome = { inspection: AssemblyInspection | null; diagnostic: string | null }
type InspectionState = InspectionOutcome & { key: string; pending: boolean }
async function requestInspection(pairs: readonly Pair[]): Promise<InspectionOutcome> {
  try {
    const result = await inspectActiveAssembly(pairs)
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
    void requestInspection([]).then((outcome) => publish(token, outcome))
    return () => {
      generation.current += 1
    }
  }, [key, publish])
  const inspectPairs = useCallback(
    async (pairs: readonly Pair[]) => {
      if (pairLock.current || key === "unavailable") return
      pairLock.current = true
      const token = generation.current
      setState((previous) => ({ ...previous, pending: true, diagnostic: null }))
      try {
        publish(token, await requestInspection(pairs))
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
