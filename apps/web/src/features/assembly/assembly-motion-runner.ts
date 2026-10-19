import {
  type AssemblyMotionStudy,
  type AssemblyMutation,
  assemblyMotionTimes,
} from "@vibeshape/domain/assembly-authority"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { previewAssemblyChanges } from "../../document/document-controller"
import { type AssemblyMotionCoordinate, assemblyMotionSamples } from "./assembly-motion"
import type { AssemblyPlaybackOptions } from "./use-assembly-motion"

export type AssemblyMotionTarget = {
  revision: number
  changes: (value: number) => readonly AssemblyMutation[]
}
type SolvedPose = {
  inspection: AssemblyInspection
  changes: readonly AssemblyMutation[]
  value: number
}
export class AssemblyMotionPreviewFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function sampleDelay(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener("abort", finish, { once: true })
    if (signal.aborted) finish()
  })
}

function sampleBytes(inspection: AssemblyInspection) {
  return inspection.occurrences.reduce(
    (total, occurrence) =>
      total +
      Object.values(occurrence.mesh).reduce(
        (bytes, value) => bytes + (ArrayBuffer.isView(value) ? value.byteLength : 0),
        0,
      ),
    0,
  )
}

type MotionCache = { poses: Map<number, SolvedPose>; bytes: number }
async function solveCachedPose(
  cache: MotionCache,
  target: AssemblyMotionTarget,
  value: number,
  signal: AbortSignal,
  pending: () => void,
) {
  const cached = cache.poses.get(value)
  if (cached) return cached
  pending()
  const changes = target.changes(value)
  const result = await previewAssemblyChanges(changes, target.revision, [], signal)
  if (signal.aborted) return null
  if (!result.ok)
    throw new AssemblyMotionPreviewFailure(
      result.diagnostic.assembly?.code ?? "unavailable",
      result.diagnostic.message,
    )
  cache.bytes += sampleBytes(result.inspection)
  if (cache.bytes > 64 * 1024 * 1024)
    throw new AssemblyMotionPreviewFailure(
      "sample-budget",
      "The solved sequence exceeds the 64 MiB mesh budget.",
    )
  const pose = { inspection: result.inspection, changes, value }
  cache.poses.set(value, pose)
  return pose
}
/** Solve one bounded cycle. Later loops replay exact receipts without more worker materialization. */
export async function solveAssemblyMotionSweep({
  target,
  values,
  signal,
  playing,
  pending,
  publish,
  options,
}: {
  target: AssemblyMotionTarget
  values: readonly number[]
  signal: AbortSignal
  playing: boolean
  pending: () => void
  publish: (sample: SolvedPose) => void
  options: AssemblyPlaybackOptions
}) {
  const cache: MotionCache = { poses: new Map(), bytes: 0 }
  do {
    for (const value of values) {
      if (signal.aborted) return
      const sample = await solveCachedPose(cache, target, value, signal, pending)
      if (!sample || signal.aborted) return
      publish(sample)
      if (playing) await sampleDelay(signal, 200 / (options.speed ?? 1))
    }
  } while (playing && options.loop && !signal.aborted)
}

export function assemblyPlaybackValues(
  study: AssemblyMotionStudy | null,
  coordinate: AssemblyMotionCoordinate | null,
  start: number,
  end: number,
  options: AssemblyPlaybackOptions,
) {
  const speed = options.speed ?? 1
  if (!Number.isFinite(speed) || speed < 0.1 || speed > 10)
    throw new Error("Invalid playback speed.")
  if (study) return assemblyMotionTimes(study.duration, options.count ?? 13, options.reverse)
  if (!coordinate) throw new Error("No motion coordinate is selected.")
  return assemblyMotionSamples(
    coordinate,
    options.reverse ? end : start,
    options.reverse ? start : end,
    options.count ?? 13,
  )
}

export function assemblyMotionFailureKey(
  error: { kind: "invalid" | "save" | "solver"; code?: string } | null,
) {
  if (!error) return null
  if (error.kind === "invalid") return "motionStudyInvalidDetails" as const
  if (error.kind === "save") return "motionStudySaveFailed" as const
  if (
    error.code === "conflicting-mates" ||
    error.code === "did-not-converge" ||
    error.code === "drive-limit"
  )
    return "motionSolverConflict" as const
  return "motionSolverUnavailable" as const
}
