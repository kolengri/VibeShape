import {
  derivedReadResultContextMatches,
  inspectMotionClearanceArgumentsSchema,
  motionClearanceReportSchema,
} from "@vibeshape/automation-api/derived-reads"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { canonicalJson } from "@vibeshape/domain"
import { commandActorSchema } from "@vibeshape/domain/commands"
import type { z } from "zod"
import {
  createMotionClearanceInspector,
  type MotionClearanceCapture,
  type MotionClearancePorts,
  type MotionClearanceResult,
  type MotionClearanceSample,
} from "../features/assembly/assembly-motion-clearance"

type Operation = { tool: "inspect_motion_clearance"; arguments: unknown }
type Request = z.infer<typeof inspectMotionClearanceArgumentsSchema>
function minimum(pairs: MotionClearanceSample["pairs"]) {
  return pairs.reduce<(typeof pairs)[number] | null>((a, b) => {
    if (!a || b.distance < a.distance) return b
    return b.distance === a.distance && b.volume > a.volume ? b : a
  }, null)
}
function sampleSummary(sample: MotionClearanceSample) {
  const smallest = minimum(sample.pairs)
  if (!smallest) throw new Error("The sampled pose has no measured pairs.")
  return {
    value: sample.value,
    poseDigest: sample.poseDigest,
    smallest,
    collisionCount: sample.pairs.filter((p) => p.volume > 0).length,
    belowGapCount: sample.pairs.filter((p) => p.violatesMinimumGap).length,
  }
}
function reportResult(result: MotionClearanceResult, request: Request, effectiveGap: number) {
  return motionClearanceReportSchema.safeParse({
    ...result,
    minimumGap: result.samples.length ? result.minimumGap : effectiveGap,
    pairs:
      result.samples[0]?.pairs.map(({ leftInstanceId, rightInstanceId }) => ({
        leftInstanceId,
        rightInstanceId,
      })) ??
      request.pairs ??
      [],
    samples: result.samples.map(sampleSummary),
    coverage: "sampled-poses-only",
  })
}
function captureMatches(current: MotionClearanceCapture | null, source: MotionClearanceCapture) {
  if (!current || current.documentId !== source.documentId || current.revision !== source.revision)
    return false
  return (
    current.defaultMinimumGap === source.defaultMinimumGap &&
    canonicalJson(current.assembly) === canonicalJson(source.assembly)
  )
}
/** Binds the UI's pure inspector to one authenticated project runtime; never applies a pose. */
export function createMotionClearanceAutomationSession(
  options: MotionClearancePorts & { documentId: string; isActive: () => boolean },
) {
  let owner: string | null = null,
    closed = false,
    epoch = 0
  let pending: AbortController | null = null
  const capture = () => (!closed && options.isActive() ? options.capture() : null)
  let activeSource: MotionClearanceCapture | null = null
  const previewBound: MotionClearancePorts["preview"] = async (...args) => {
    const source = activeSource
    if (!source || !captureMatches(capture(), source)) return { ok: false }
    const result = await options.preview(...args)
    if (activeSource !== source || !captureMatches(capture(), source)) return { ok: false }
    return result
  }
  const inspect = createMotionClearanceInspector({ capture, preview: previewBound })
  function authorizeActor(actor: unknown) {
    const parsed = commandActorSchema.safeParse(actor)
    if (!parsed.success || parsed.data.type !== "mcp")
      return localFailure("invalid-operation", "Clearance requires an authenticated MCP actor.")
    const key = JSON.stringify([parsed.data.clientId, parsed.data.sessionId])
    if (owner !== null && owner !== key)
      return localFailure(
        "clearance-owner-mismatch",
        "The clearance session belongs to another actor.",
      )
    owner = key
    return { ok: true as const, actor: parsed.data }
  }
  function readSource(revision: number, signal?: AbortSignal) {
    const source = capture()
    if (!source || source.documentId !== options.documentId || source.revision !== revision)
      return localFailure(
        "stale-revision",
        "The bound clearance source is unavailable or stale.",
        true,
      )
    if (signal?.aborted)
      return localFailure("session-revoked", "The clearance request was cancelled.", true)
    if (pending)
      return localFailure("clearance-busy", "Another clearance inspection is running.", true)
    return { ok: true as const, source: structuredClone(source) }
  }
  function bindRequest(actor: unknown, raw: unknown, signal?: AbortSignal) {
    const parsed = inspectMotionClearanceArgumentsSchema.safeParse(raw)
    if (!parsed.success)
      return localFailure("invalid-operation", "The clearance request is invalid.")
    const authorized = authorizeActor(actor)
    if (!authorized.ok) return authorized
    const captured = readSource(parsed.data.revision, signal)
    if (!captured.ok) return captured
    return {
      ok: true as const,
      actor: authorized.actor,
      request: parsed.data,
      source: captured.source,
      effectiveGap: parsed.data.minimumGap ?? captured.source.defaultMinimumGap,
    }
  }
  function confirm(
    result: MotionClearanceResult,
    bound: Extract<ReturnType<typeof bindRequest>, { ok: true }>,
  ) {
    const report = reportResult(result, bound.request, bound.effectiveGap)
    const response = report.success ? { ok: true as const, value: report.data } : null
    const validation = {
      tool: "inspect_motion_clearance",
      arguments: bound.request,
    }
    return response &&
      response.value.minimumGap === bound.effectiveGap &&
      derivedReadResultContextMatches(validation, response, options.documentId, bound.actor)
      ? response
      : localFailure(
          "invalid-clearance-evidence",
          "The inspector returned inconsistent clearance evidence.",
        )
  }
  return {
    async execute(actor: unknown, operation: Operation, signal?: AbortSignal) {
      const bound = bindRequest(actor, operation.arguments, signal)
      if (!bound.ok) return bound
      const operationEpoch = epoch,
        abort = new AbortController()
      pending = abort
      activeSource = bound.source
      const cancel = () => abort.abort()
      signal?.addEventListener("abort", cancel, { once: true })
      try {
        // Preserve omission: the shared inspector resolves the captured authored default.
        const result = await inspect(
          { ...bound.request, documentId: options.documentId, actor: bound.actor },
          abort.signal,
        )
        if (
          epoch !== operationEpoch ||
          abort.signal.aborted ||
          !captureMatches(capture(), bound.source)
        )
          return localFailure(
            "session-revoked",
            "The clearance inspection was cancelled or its source changed.",
            true,
          )
        return confirm(result, bound)
      } catch {
        return localFailure(
          "clearance-failed",
          "Motion clearance inspection failed; no clearance pass is established.",
          true,
        )
      } finally {
        signal?.removeEventListener("abort", cancel)
        if (pending === abort) {
          pending = null
          activeSource = null
        }
      }
    },
    cancel() {
      epoch++
      pending?.abort()
    },
    dispose() {
      closed = true
      epoch++
      pending?.abort()
    },
  }
}
