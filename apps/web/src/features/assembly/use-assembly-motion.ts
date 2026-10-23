import {
  type AssemblyMotionStudy,
  type AssemblyMutation,
  assemblyMotionStudyChanges,
} from "@vibeshape/domain/assembly-authority"
import type { AssemblyJointRecord } from "@vibeshape/domain/assembly-mates"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { useCallback, useEffect, useRef, useState } from "react"
import { type AssemblyMotionCoordinate, assemblyMotionChanges } from "./assembly-motion"
import type { AssemblyMotionSolvedSample } from "./assembly-motion-export"
import {
  AssemblyMotionPreviewFailure,
  type AssemblyMotionTarget,
  assemblyPlaybackValues,
  solveAssemblyMotionSweep,
} from "./assembly-motion-runner"

type MotionError = { kind: "invalid" | "save" } | { kind: "solver"; reason: string; code?: string }
type MotionState = {
  key: string
  inspection: AssemblyInspection | null
  changes: readonly AssemblyMutation[] | null
  value: number | null
  pending: boolean
  playing: boolean
  applying: boolean
  error: MotionError | null
  samples: readonly AssemblyMotionSolvedSample[]
}
export type AssemblyPlaybackOptions = {
  count?: number
  speed?: number
  reverse?: boolean
  loop?: boolean
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
  samples: [],
})
function motionSolveError(error: unknown): MotionError {
  return {
    kind: "solver",
    reason: error instanceof Error ? error.message : "Assembly preview failed.",
    ...(error instanceof AssemblyMotionPreviewFailure ? { code: error.code } : {}),
  }
}

export function useAssemblyMotion({
  key,
  joint,
  coordinate,
  revision,
  disabled,
  onApply,
  study = null,
  joints = [],
}: {
  key: string
  joint: AssemblyJointRecord | null
  coordinate: AssemblyMotionCoordinate | null
  revision: number
  disabled: boolean
  onApply: (changes: readonly AssemblyMutation[], revision: number) => Promise<boolean>
  study?: AssemblyMotionStudy | null
  joints?: readonly AssemblyJointRecord[]
}) {
  const [state, setState] = useState<MotionState>(() => idle(key))
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const applyLock = useRef(false)
  const serial = useRef<Promise<void> | null>(null)
  const playback = useRef<AssemblyPlaybackOptions>({})
  const updatePlayback = (options: Pick<AssemblyPlaybackOptions, "speed" | "loop">) => {
    const speed = options.speed ?? 1
    if (Number.isFinite(speed) && speed >= 0.1 && speed <= 10) playback.current.speed = speed
    playback.current.loop = options.loop ?? false
  }
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
  const target = (): AssemblyMotionTarget | null => {
    if (disabled || applyLock.current) return null
    if (study)
      return {
        revision,
        sampleUnit: "seconds",
        changes: (time) => assemblyMotionStudyChanges(study, joints, time),
      }
    if (!joint || !coordinate) return null
    return {
      revision,
      sampleUnit: "joint-coordinate",
      changes: (value) => assemblyMotionChanges(joint, coordinate, value),
    }
  }
  const run = async (
    values: readonly number[],
    playing: boolean,
    target: AssemblyMotionTarget,
    options: AssemblyPlaybackOptions = {},
  ) => {
    stop()
    const token = generation.current
    const abort = new AbortController()
    const active = () => token === generation.current && !abort.signal.aborted
    request.current = abort
    playback.current = { ...options }
    setState((previous) => ({ ...previous, pending: true, playing, error: null, samples: [] }))
    const previous = serial.current
    let finish!: () => void
    const running = new Promise<void>((resolve) => {
      finish = resolve
    })
    serial.current = running
    try {
      if (previous) await previous
      if (!active()) return
      await solveAssemblyMotionSweep({
        target,
        values,
        signal: abort.signal,
        playing,
        pending: () => {
          if (active()) setState((previous) => ({ ...previous, pending: true }))
        },
        publish: (sample) => {
          if (active())
            setState((previous) => ({
              ...idle(key),
              ...sample,
              playing,
              samples: [
                ...previous.samples.filter(({ value }) => value !== sample.value),
                { value: sample.value, inspection: sample.inspection },
              ],
            }))
        },
        options: playback.current,
      })
      if (active()) setState((previous) => ({ ...previous, playing: false, pending: false }))
    } catch (error) {
      if (active())
        setState({
          ...idle(key),
          error: motionSolveError(error),
        })
    } finally {
      if (request.current === abort) request.current = null
      finish()
      if (serial.current === running) serial.current = null
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
      active.changes(value)
    } catch {
      invalid()
      return
    }
    return run([value], false, active)
  }
  const play = (start: number, end: number, options: AssemblyPlaybackOptions = {}) => {
    const active = target()
    if (!active) return
    let values: number[]
    try {
      values = assemblyPlaybackValues(study, coordinate, start, end, options)
    } catch {
      invalid()
      return
    }
    return run(values, true, active, options)
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
  return { ...current, reset, pause, preview, play, apply, invalid, updatePlayback }
}
export type AssemblyMotionView = ReturnType<typeof useAssemblyMotion>
