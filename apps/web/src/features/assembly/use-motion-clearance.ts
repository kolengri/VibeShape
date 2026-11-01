import { useCallback, useEffect, useRef, useState } from "react"
import type {
  MotionClearanceInput,
  MotionClearanceProgress,
  MotionClearanceResult,
} from "./assembly-motion-clearance"
import { inspectMotionClearance } from "./motion-clearance-operation"

export function useMotionClearance(key: string) {
  const scope = useRef<{ key: string; controller: AbortController } | null>(null)
  const [state, setState] = useState<{
    key: string
    pending: boolean
    result: MotionClearanceResult | null
    progress: MotionClearanceProgress | null
  }>({ key, pending: false, result: null, progress: null })
  useEffect(
    () => () => {
      scope.current?.controller.abort()
      scope.current = null
    },
    [key],
  )
  const cancel = useCallback(() => scope.current?.controller.abort(), [])
  const run = async (input: MotionClearanceInput) => {
    if (scope.current) return
    const active = { key, controller: new AbortController() }
    scope.current = active
    setState({ key, pending: true, result: null, progress: null })
    try {
      const result = await inspectMotionClearance(input, active.controller.signal, (progress) => {
        if (scope.current === active) setState({ key, pending: true, result: null, progress })
      })
      if (scope.current === active) setState({ key, pending: false, result, progress: null })
    } finally {
      if (scope.current === active) scope.current = null
    }
  }
  return {
    ...(state.key === key ? state : { key, pending: false, result: null, progress: null }),
    run,
    cancel,
  }
}
export type MotionClearanceView = ReturnType<typeof useMotionClearance>
