import { canonicalJson } from "@vibeshape/domain"
import type { AssemblyAuthority, AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { sha256Text } from "@vibeshape/persistence"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { z } from "zod"
import { assemblyClearancePoseDigest } from "./assembly-clearance-pose"
import {
  assemblyMotionChanges,
  assemblyMotionCoordinates,
  assemblyMotionSamples,
} from "./assembly-motion"

const identity = z.string().uuid()
const pairSchema = z.object({ leftInstanceId: identity, rightInstanceId: identity }).strict()
/** Canonical coordinates: radians for angle, millimeters for translation and minimum gap. */
export const motionClearanceInputSchema = z
  .object({
    documentId: identity,
    revision: z.number().int().nonnegative(),
    actor: commandActorSchema,
    jointId: identity,
    coordinate: z.enum(["angle", "translation"]),
    start: z.number().finite(),
    end: z.number().finite(),
    sampleCount: z.number().int().min(2).max(64).default(13),
    minimumGap: z.number().finite().min(0).max(100000).optional(),
    pairs: z.array(pairSchema).min(1).max(32).optional(),
    budgetMs: z.number().int().min(100).max(120000).default(120000),
  })
  .strict()
export type MotionClearanceInput = z.input<typeof motionClearanceInputSchema>
export type MotionClearanceCapture = {
  documentId: string
  revision: number
  assembly: AssemblyAuthority
  defaultMinimumGap: number
}
export type MotionClearanceProgress = {
  phase: "solving-and-measuring"
  completed: number
  total: number
}
export type MotionClearancePair = z.infer<typeof pairSchema> & {
  distance: number
  volume: number
  solidCount: number
  violatesMinimumGap: boolean
}
export type MotionClearanceSample = {
  value: number
  poseDigest: string
  pairs: MotionClearancePair[]
}
export type MotionClearanceReason =
  | "invalid-input"
  | "busy"
  | "unavailable"
  | "missing-joint"
  | "stale"
  | "cancelled"
  | "budget"
  | "unsupported-mesh"
  | "solve-failed"
  | "missing-evidence"
export type MotionClearanceResult = {
  status: "complete" | "incomplete"
  reason?: MotionClearanceReason
  scope: {
    documentId: string
    revision: number
    actor: z.infer<typeof commandActorSchema>
    sourceDigest: string
  } | null
  jointId: string
  coordinate: "angle" | "translation"
  start: number
  end: number
  requestedSamples: number
  minimumGap: number
  resolution: number
  samples: MotionClearanceSample[]
  smallest: ({ value: number } & MotionClearancePair) | null
}
type PreviewResult = { ok: true; inspection: AssemblyInspection } | { ok: false }
export type MotionClearancePorts = {
  capture: () => MotionClearanceCapture | null
  preview: (
    changes: readonly AssemblyMutation[],
    revision: number,
    pairs: readonly z.infer<typeof pairSchema>[],
    signal: AbortSignal,
  ) => Promise<PreviewResult>
}
class ClearanceFailure extends Error {
  constructor(readonly reason: MotionClearanceReason) {
    super(reason)
  }
}
function sourceIdentity(capture: MotionClearanceCapture) {
  return canonicalJson(capture.assembly)
}
function selectedPairs(capture: MotionClearanceCapture, requested?: z.infer<typeof pairSchema>[]) {
  const ids = capture.assembly.instances.map(({ id }) => id)
  if (!requested && ids.length > 8) throw new ClearanceFailure("budget")
  const pairs =
    requested ??
    ids.flatMap((leftInstanceId, index) =>
      ids.slice(index + 1).map((rightInstanceId) => ({ leftInstanceId, rightInstanceId })),
    )
  const keys = pairs.map(({ leftInstanceId, rightInstanceId }) =>
    [leftInstanceId, rightInstanceId].sort().join(":"),
  )
  if (
    !pairs.length ||
    pairs.some(
      ({ leftInstanceId, rightInstanceId }) =>
        leftInstanceId === rightInstanceId ||
        !ids.includes(leftInstanceId as (typeof ids)[number]) ||
        !ids.includes(rightInstanceId as (typeof ids)[number]),
    ) ||
    new Set(keys).size !== keys.length
  )
    throw new ClearanceFailure("invalid-input")
  return pairs
}
function evidence(
  inspection: AssemblyInspection,
  pairs: z.infer<typeof pairSchema>[],
  minimumGap: number,
) {
  return pairs.map((pair): MotionClearancePair => {
    const matches = inspection.interference.filter(
      (result) =>
        [pair.leftInstanceId, pair.rightInstanceId].sort().join(":") ===
        [result.leftInstanceId, result.rightInstanceId].sort().join(":"),
    )
    const result = matches[0]
    if (matches.length !== 1 || !result) throw new ClearanceFailure("missing-evidence")
    if (result.status === "unsupported-mesh") throw new ClearanceFailure("unsupported-mesh")
    if (
      result.distance === undefined ||
      !Number.isFinite(result.distance) ||
      result.distance < 0 ||
      !Number.isFinite(result.volume) ||
      result.volume < 0
    )
      throw new ClearanceFailure("missing-evidence")
    return {
      ...pair,
      distance: result.distance,
      volume: result.volume,
      solidCount: result.solidCount,
      violatesMinimumGap: result.distance < minimumGap,
    }
  })
}

type ClearanceRequest = z.output<typeof motionClearanceInputSchema>
function prepareSweep(
  capture: MotionClearanceCapture,
  input: ClearanceRequest,
  result: MotionClearanceResult,
) {
  const joint = capture.assembly.joints.find(({ id }) => id === input.jointId)
  const coordinate =
    joint && assemblyMotionCoordinates(joint).find(({ kind }) => kind === input.coordinate)
  if (!joint || !coordinate) throw new ClearanceFailure("missing-joint")
  result.minimumGap = input.minimumGap ?? capture.defaultMinimumGap
  if (!Number.isFinite(result.minimumGap) || result.minimumGap < 0)
    throw new ClearanceFailure("invalid-input")
  const pairs = selectedPairs(capture, input.pairs)
  if (pairs.length * input.sampleCount > 1024) throw new ClearanceFailure("budget")
  let values: number[]
  try {
    values = assemblyMotionSamples(coordinate, input.start, input.end, input.sampleCount)
  } catch {
    throw new ClearanceFailure("invalid-input")
  }
  result.resolution = Math.abs(input.end - input.start) / (input.sampleCount - 1)
  return { joint, coordinate, pairs, values }
}
function retainSample(result: MotionClearanceResult, sample: MotionClearanceSample) {
  result.samples.push(sample)
  for (const pair of sample.pairs) {
    if (
      !result.smallest ||
      pair.distance < result.smallest.distance ||
      (pair.distance === result.smallest.distance && pair.volume > result.smallest.volume)
    )
      result.smallest = { value: sample.value, ...pair }
  }
}
async function solveSamples({
  ports,
  sweep,
  result,
  signal,
  assertCurrent,
  progress,
}: {
  ports: MotionClearancePorts
  sweep: ReturnType<typeof prepareSweep>
  result: MotionClearanceResult
  signal: AbortSignal
  assertCurrent: () => void
  progress: ((value: MotionClearanceProgress) => void) | undefined
}) {
  const publishProgress = () =>
    progress?.({
      phase: "solving-and-measuring",
      completed: result.samples.length,
      total: sweep.values.length,
    })
  for (const value of sweep.values) {
    assertCurrent()
    publishProgress()
    const pose = await ports.preview(
      assemblyMotionChanges(sweep.joint, sweep.coordinate, value),
      result.scope?.revision ?? -1,
      sweep.pairs,
      signal,
    )
    assertCurrent()
    if (!pose.ok) throw new ClearanceFailure("solve-failed")
    const sample = {
      value,
      pairs: evidence(pose.inspection, sweep.pairs, result.minimumGap),
      poseDigest: await assemblyClearancePoseDigest(pose.inspection),
    }
    assertCurrent()
    retainSample(result, sample)
  }
  assertCurrent()
  publishProgress()
}
function failureReason(
  error: unknown,
  expired: boolean,
  signal: AbortSignal,
): MotionClearanceReason {
  if (error instanceof ClearanceFailure && error.reason === "stale") return "stale"
  if (expired) return "budget"
  if (signal.aborted) return "cancelled"
  return error instanceof ClearanceFailure ? error.reason : "solve-failed"
}

/** One serialized read-only operation shared by UI and MCP; no receipts confer save authority. */
export function createMotionClearanceInspector(ports: MotionClearancePorts) {
  let running = false
  return async (
    raw: MotionClearanceInput,
    signal?: AbortSignal,
    progress?: (value: MotionClearanceProgress) => void,
  ): Promise<MotionClearanceResult> => {
    const parsed = motionClearanceInputSchema.safeParse(raw)
    const result: MotionClearanceResult = {
      status: "incomplete",
      scope: null,
      jointId: raw.jointId,
      coordinate: raw.coordinate,
      start: raw.start,
      end: raw.end,
      requestedSamples: parsed.success ? parsed.data.sampleCount : 0,
      minimumGap: 0.2,
      resolution: 0,
      samples: [],
      smallest: null,
    }
    if (!parsed.success) return { ...result, reason: "invalid-input" }
    if (running) return { ...result, reason: "busy" }
    running = true
    const input = parsed.data
    const abort = new AbortController()
    let expired = false
    const deadline = performance.now() + input.budgetMs
    const cancel = () => abort.abort()
    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) cancel()
    const timer = setTimeout(() => {
      expired = true
      abort.abort()
    }, input.budgetMs)
    try {
      const captured = ports.capture()
      if (!captured) throw new ClearanceFailure("unavailable")
      const capture = structuredClone(captured)
      const source = sourceIdentity(capture)
      const assertCurrent = () => {
        if (performance.now() >= deadline) {
          expired = true
          abort.abort()
        }
        const current = ports.capture()
        if (
          !current ||
          current.documentId !== input.documentId ||
          current.revision !== input.revision ||
          sourceIdentity(current) !== source
        )
          throw new ClearanceFailure("stale")
        if (abort.signal.aborted) throw new ClearanceFailure(expired ? "budget" : "cancelled")
      }
      assertCurrent()
      result.scope = {
        documentId: capture.documentId,
        revision: capture.revision,
        actor: input.actor,
        sourceDigest: await sha256Text(source),
      }
      const sweep = prepareSweep(capture, input, result)
      await solveSamples({ ports, sweep, result, signal: abort.signal, assertCurrent, progress })
      return { ...result, status: "complete" }
    } catch (error) {
      const reason = failureReason(error, expired, abort.signal)
      return {
        ...result,
        ...(reason === "stale" ? { samples: [], smallest: null } : {}),
        reason,
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", cancel)
      running = false
    }
  }
}
