import type { AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import type { AssemblyJointRecord } from "@vibeshape/domain/assembly-mates"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { useCallback, useEffect, useRef, useState } from "react"
import { previewAssemblyChanges } from "../../document/document-controller"
import {
  type AssemblyMotionCoordinate,
  assemblyMotionChanges,
  assemblyMotionSamples,
} from "./assembly-motion"

type MotionError = { kind: "invalid" | "save" } | { kind: "solver"; reason: string }
type MotionState = {
  key: string
  inspection: AssemblyInspection | null
  changes: readonly AssemblyMutation[] | null
  value: number | null
  pending: boolean
  playing: boolean
  applying: boolean
  error: MotionError | null
}
const idle = (key: string): MotionState => ({
  key,
  inspection: null,
  changes: null,
  value: null,
  pending: false,
  playing: false,
  applying: false,
  error: null,
})

function sampleDelay(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, 200)
    signal.addEventListener("abort", finish, { once: true })
    if (signal.aborted) finish()
  })
}
type MotionTarget = {
  joint: AssemblyJointRecord
  coordinate: AssemblyMotionCoordinate
  revision: number
}
async function solveMotionSweep({
  target,
  values,
  signal,
  playing,
  pending,
  publish,
}: {
  target: MotionTarget
  values: readonly number[]
  signal: AbortSignal
  playing: boolean
  pending: () => void
  publish: (sample: Pick<MotionState, "inspection" | "changes" | "value">) => void
}) {
  for (const value of values) {
    if (signal.aborted) return
    pending()
    const changes = assemblyMotionChanges(target.joint, target.coordinate, value)
    const result = await previewAssemblyChanges(changes, target.revision, [], signal)
    if (signal.aborted) return
    if (!result.ok) throw new Error(result.diagnostic.message)
    publish({ inspection: result.inspection, changes, value })
    if (playing) await sampleDelay(signal)
  }
}

export function useAssemblyMotion({
  key,
  joint,
  coordinate,
  revision,
  disabled,
  onApply,
}: {
  key: string
  joint: AssemblyJointRecord | null
  coordinate: AssemblyMotionCoordinate | null
  revision: number
  disabled: boolean
  onApply: (changes: readonly AssemblyMutation[], revision: number) => Promise<boolean>
}) {
  const [state, setState] = useState<MotionState>(() => idle(key))
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const applyLock = useRef(false)
  const stop = useCallback(() => {
    generation.current += 1
    request.current?.abort()
    request.current = null
  }, [])
  useEffect(() => {
    setState(idle(key))
    return stop
  }, [key, stop])
  useEffect(() => {
    if (disabled && !applyLock.current) {
      stop()
      setState(idle(key))
    }
  }, [disabled, key, stop])
  const reset = useCallback(() => {
    if (applyLock.current) return
    stop()
    setState(idle(key))
  }, [key, stop])
  const pause = () => {
    if (applyLock.current) return
    stop()
    // An interrupted sample is never shown as the coordinate of older geometry.
    setState((previous) => ({ ...previous, pending: false, playing: false }))
  }
  const target = (): MotionTarget | null => {
    if (disabled || applyLock.current || request.current || !joint || !coordinate) return null
    return { joint, coordinate, revision }
  }
  const run = async (values: readonly number[], playing: boolean, target: MotionTarget) => {
    stop()
    const token = generation.current
    const abort = new AbortController()
    request.current = abort
    setState({ ...idle(key), pending: true, playing })
    try {
      await solveMotionSweep({
        target,
        values,
        signal: abort.signal,
        playing,
        pending: () => setState((previous) => ({ ...previous, pending: true })),
        publish: (sample) => setState({ ...idle(key), ...sample, playing }),
      })
      if (token === generation.current)
        setState((previous) => ({ ...previous, playing: false, pending: false }))
    } catch (error) {
      if (token === generation.current && !abort.signal.aborted)
        setState({
          ...idle(key),
          error: {
            kind: "solver",
            reason: error instanceof Error ? error.message : "Assembly preview failed.",
          },
        })
    } finally {
      if (request.current === abort) request.current = null
    }
  }
  const invalid = () => {
    reset()
    setState({ ...idle(key), error: { kind: "invalid" } })
  }
  const preview = (value: number) => {
    const active = target()
    if (!active) return
    try {
      assemblyMotionChanges(active.joint, active.coordinate, value)
    } catch {
      invalid()
      return
    }
    return run([value], false, active)
  }
  const play = (start: number, end: number) => {
    const active = target()
    if (!active) return
    let values: number[]
    try {
      values = assemblyMotionSamples(active.coordinate, start, end)
    } catch {
      invalid()
      return
    }
    return run(values, true, active)
  }
  const current = state.key === key ? state : idle(key)
  const apply = async () => {
    if (disabled || applyLock.current || current.pending || current.playing || !current.changes)
      return false
    applyLock.current = true
    const token = generation.current
    setState((previous) => ({ ...previous, applying: true, error: null }))
    try {
      const applied = await onApply(current.changes, revision)
      if (token === generation.current) {
        setState((previous) => ({
          ...previous,
          applying: false,
          error: applied ? null : { kind: "save" },
        }))
      }
      return applied
    } catch {
      if (token === generation.current)
        setState((previous) => ({ ...previous, applying: false, error: { kind: "save" } }))
      return false
    } finally {
      applyLock.current = false
    }
  }
  return { ...current, reset, pause, preview, play, apply, invalid }
}
export type AssemblyMotionView = ReturnType<typeof useAssemblyMotion>
