import type { ImportUploadCommit } from "@vibeshape/automation-api/imports"
import {
  type LightweightingOperation,
  type LightweightingSourceIdentity,
  lightweightingAnalysisSchema,
  lightweightingOperationSchema,
  lightweightingRequestSchema,
  lightweightingResultContextMatches,
} from "@vibeshape/automation-api/lightweighting-tools"
import { type LocalFailure, localFailure } from "@vibeshape/automation-api/local-tools"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"
import {
  type StructuralOptimizationSettings,
  type StructuralOptimizationSummary,
  structuralOptimizationSummarySchema,
} from "@vibeshape/domain/lightweighting"

type Source = { documentId: string; revision: number; identity: LightweightingSourceIdentity }
type Result<T> = { ok: true; value: T } | LocalFailure

/** Geometry and imported bytes stay in the captured browser; adapters receive bounded evidence. */
export function createLightweightingProposalCoordinator<
  S extends Source,
  P,
  C extends Readonly<{ aborted: boolean }>,
>(configuration: {
  createCancellation: () => { signal: C; abort: () => void }
  observeCancellation?: (signal: C | undefined, cancel: () => void) => () => void
  documentId: string
  isActive: () => boolean
  readSource: (identity: LightweightingSourceIdentity) => S | null
  optimize: (
    source: S,
    settings: StructuralOptimizationSettings,
    signal: C,
  ) => Promise<{ summary: StructuralOptimizationSummary; payload: P }>
  requestSnapshot: (
    actor: CommandActor,
    source: S,
    settings: StructuralOptimizationSettings,
    summary: StructuralOptimizationSummary,
    payload: P,
    label: string,
    signal: C,
  ) => Promise<Result<ImportUploadCommit>>
  cancelSnapshot: () => void
  describeFailure?: (error: unknown) => LocalFailure | null
}) {
  let owner: CommandActor | null = null
  let closed = false
  let busy = false
  let cancellation: ReturnType<typeof configuration.createCancellation> | null = null
  function current(source: S, signal: C) {
    const next = configuration.readSource(source.identity)
    return (
      !closed &&
      configuration.isActive() &&
      !signal.aborted &&
      next !== null &&
      next.documentId === source.documentId &&
      next.revision === source.revision &&
      canonicalJson(next.identity) === canonicalJson(source.identity)
    )
  }
  function cancel() {
    cancellation?.abort()
    configuration.cancelSnapshot()
  }
  function pairedActor(inputActor: unknown) {
    const parsed = commandActorSchema.safeParse(inputActor)
    if (!parsed.success || parsed.data.type !== "mcp") return null
    return owner && !commandActorsEqual(owner, parsed.data) ? null : parsed.data
  }
  function requestedSourceMatches(source: S, operation: LightweightingOperation) {
    return (
      source.documentId === configuration.documentId &&
      source.revision === operation.arguments.baseRevision &&
      canonicalJson(source.identity) === canonicalJson(operation.arguments.source)
    )
  }
  function prepare(inputActor: unknown, input: LightweightingOperation) {
    const actor = pairedActor(inputActor)
    if (!actor)
      return localFailure(
        "lightweighting-owner-mismatch",
        "The paired actor does not own this analysis.",
      )
    if (closed || !configuration.isActive())
      return localFailure("session-revoked", "The paired browser session is unavailable.")
    const operation = lightweightingOperationSchema.safeParse(input)
    if (!operation.success)
      return localFailure("invalid-arguments", "Lightweighting inputs are invalid.")
    if (busy)
      return localFailure(
        "lightweighting-busy",
        "Another lightweighting operation is pending.",
        true,
      )
    const source = configuration.readSource(operation.data.arguments.source)
    if (!source || !requestedSourceMatches(source, operation.data))
      return localFailure("stale-revision", "The requested source body is no longer current.", true)
    owner ??= actor
    return { ok: true as const, value: { actor, operation: operation.data, source } }
  }
  async function compute(
    actor: CommandActor,
    operation: LightweightingOperation,
    source: S,
    signal: C,
  ) {
    if (!current(source, signal))
      return localFailure("request-cancelled", "The analysis was cancelled.", true)
    const { summary: rawSummary, payload } = await configuration.optimize(
      source,
      operation.arguments.settings,
      signal,
    )
    if (!current(source, signal))
      return localFailure(
        "stale-revision",
        "The analysis source changed or the operation was cancelled.",
        true,
      )
    const summary = structuralOptimizationSummarySchema.parse(rawSummary)
    const value = lightweightingAnalysisSchema.parse({
      documentId: configuration.documentId,
      baseRevision: source.revision,
      source: source.identity,
      summary,
    })
    const analysisOperation = {
      tool: "analyze_lightweighting",
      arguments: {
        baseRevision: source.revision,
        source: source.identity,
        settings: operation.arguments.settings,
      },
    }
    if (
      lightweightingResultContextMatches(
        analysisOperation,
        { ok: true, value },
        configuration.documentId,
      ) !== true
    )
      return localFailure(
        "invalid-result",
        "Analysis evidence does not match the requested constraints.",
      )
    if (operation.tool === "analyze_lightweighting") return { ok: true as const, value }
    if (summary.status === "no-improvement")
      return {
        ok: true as const,
        value: lightweightingRequestSchema.parse({ ...value, snapshot: null }),
      }
    const result = await configuration.requestSnapshot(
      actor,
      source,
      operation.arguments.settings,
      summary,
      payload,
      operation.arguments.label,
      signal,
    )
    if (!result.ok) return result
    const output = lightweightingRequestSchema.parse({ ...value, snapshot: result.value })
    if (
      lightweightingResultContextMatches(
        operation,
        { ok: true, value: output },
        configuration.documentId,
      ) !== true
    )
      return localFailure(
        "invalid-result",
        "The applied snapshot does not match its captured source.",
      )
    return { ok: true as const, value: output }
  }
  function computationFailure(signal: C, error: unknown) {
    if (signal.aborted)
      return localFailure("request-cancelled", "The analysis was cancelled.", true)
    return (
      configuration.describeFailure?.(error) ??
      localFailure(
        "lightweighting-failed",
        "The structural analysis failed; review the material, regions, constraints and resolution.",
        true,
      )
    )
  }
  return {
    async execute(inputActor: unknown, input: LightweightingOperation, signal?: C) {
      const prepared = prepare(inputActor, input)
      if (!prepared.ok) return prepared
      busy = true
      const controller = configuration.createCancellation()
      cancellation = controller
      const stopObserving = configuration.observeCancellation?.(signal, cancel)
      try {
        if (signal?.aborted) cancel()
        const { actor, operation, source } = prepared.value
        return await compute(actor, operation, source, controller.signal)
      } catch (error) {
        return computationFailure(controller.signal, error)
      } finally {
        stopObserving?.()
        if (cancellation === controller) cancellation = null
        busy = false
      }
    },
    cancel,
    dispose() {
      closed = true
      cancel()
    },
  }
}
