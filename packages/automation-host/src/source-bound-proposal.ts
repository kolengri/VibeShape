import type { ImportUploadCommit } from "@vibeshape/automation-api/imports"
import type { LightweightingSourceIdentity } from "@vibeshape/automation-api/lightweighting-tools"
import { type LocalFailure, localFailure } from "@vibeshape/automation-api/local-tools"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"
import type { z } from "zod"

export type SourceBoundProposalSource = {
  documentId: string
  revision: number
  identity: LightweightingSourceIdentity
}
type Result<T> = { ok: true; value: T } | LocalFailure

/** Geometry and imported bytes stay in the captured browser; adapters receive bounded evidence. */
export type SourceBoundProposalConfiguration<
  Settings,
  Summary,
  S extends SourceBoundProposalSource,
  P,
  C extends Readonly<{ aborted: boolean }>,
> = {
  createCancellation: () => { signal: C; abort: () => void }
  observeCancellation?: (signal: C | undefined, cancel: () => void) => () => void
  documentId: string
  isActive: () => boolean
  readSource: (identity: LightweightingSourceIdentity) => S | null
  optimize: (source: S, settings: Settings, signal: C) => Promise<{ summary: Summary; payload: P }>
  requestSnapshot: (
    actor: CommandActor,
    source: S,
    settings: Settings,
    summary: Summary,
    payload: P,
    label: string,
    signal: C,
  ) => Promise<Result<ImportUploadCommit>>
  cancelSnapshot: () => void
  describeFailure?: (error: unknown) => LocalFailure | null
}
type Operation<Settings> = {
  tool: string
  arguments: {
    baseRevision: number
    source: LightweightingSourceIdentity
    settings: Settings
    label?: string
  }
}
type Analysis<Summary> = {
  documentId: string
  baseRevision: number
  source: LightweightingSourceIdentity
  summary: Summary
}

export function createSourceBoundProposalCoordinator<
  Settings,
  Summary,
  S extends SourceBoundProposalSource,
  P,
  C extends Readonly<{ aborted: boolean }>,
>(
  configuration: SourceBoundProposalConfiguration<Settings, Summary, S, P, C> & {
    contracts: {
      operationSchema: z.ZodType<Operation<Settings>>
      summarySchema: z.ZodType<Summary>
      analysisSchema: z.ZodType<Analysis<Summary>>
      requestSchema: z.ZodType<unknown>
      analyzeTool: string
      needsSnapshot: (summary: Summary) => boolean
      resultContextMatches: (
        operation: { tool: string; arguments: unknown },
        result: { ok: boolean; value?: unknown },
        documentId?: string,
      ) => boolean | null
    }
  },
) {
  const contracts = configuration.contracts
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
  function requestedSourceMatches(source: S, operation: Operation<Settings>) {
    return (
      source.documentId === configuration.documentId &&
      source.revision === operation.arguments.baseRevision &&
      canonicalJson(source.identity) === canonicalJson(operation.arguments.source)
    )
  }
  function prepare(inputActor: unknown, input: unknown) {
    const actor = pairedActor(inputActor)
    if (!actor)
      return localFailure(
        "lightweighting-owner-mismatch",
        "The paired actor does not own this analysis.",
      )
    if (closed || !configuration.isActive())
      return localFailure("session-revoked", "The paired browser session is unavailable.")
    const operation = contracts.operationSchema.safeParse(input)
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
  function analysisEvidence(operation: Operation<Settings>, source: S, rawSummary: Summary) {
    const parsedSummary = contracts.summarySchema.safeParse(rawSummary)
    if (!parsedSummary.success)
      return localFailure("invalid-result", "The computation returned invalid measured evidence.")
    const value = contracts.analysisSchema.parse({
      documentId: configuration.documentId,
      baseRevision: source.revision,
      source: source.identity,
      summary: parsedSummary.data,
    })
    const analysisOperation = {
      tool: contracts.analyzeTool,
      arguments: {
        baseRevision: source.revision,
        source: source.identity,
        settings: operation.arguments.settings,
      },
    }
    return contracts.resultContextMatches(
      analysisOperation,
      { ok: true, value },
      configuration.documentId,
    ) === true
      ? { ok: true as const, value }
      : localFailure(
          "invalid-result",
          "Analysis evidence does not match the requested constraints.",
        )
  }
  async function reviewSnapshot(
    actor: CommandActor,
    operation: Operation<Settings>,
    source: S,
    value: Analysis<Summary>,
    payload: P,
    signal: C,
  ) {
    const result = await configuration.requestSnapshot(
      actor,
      source,
      operation.arguments.settings,
      value.summary,
      payload,
      operation.arguments.label ?? "",
      signal,
    )
    if (!result.ok) return result
    const output = contracts.requestSchema.parse({ ...value, snapshot: result.value })
    return contracts.resultContextMatches(
      operation,
      { ok: true, value: output },
      configuration.documentId,
    ) === true
      ? { ok: true as const, value: output }
      : localFailure("invalid-result", "The applied snapshot does not match its captured source.")
  }
  async function compute(
    actor: CommandActor,
    operation: Operation<Settings>,
    source: S,
    signal: C,
  ) {
    if (!current(source, signal))
      return localFailure("request-cancelled", "The analysis was cancelled.", true)
    const { summary, payload } = await configuration.optimize(
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
    const evidence = analysisEvidence(operation, source, summary)
    if (!evidence.ok) return evidence
    if (operation.tool === contracts.analyzeTool) return evidence
    if (!contracts.needsSnapshot(evidence.value.summary))
      return {
        ok: true as const,
        value: contracts.requestSchema.parse({ ...evidence.value, snapshot: null }),
      }
    return reviewSnapshot(actor, operation, source, evidence.value, payload, signal)
  }
  function computationFailure(signal: C, error: unknown) {
    if (signal.aborted)
      return localFailure("request-cancelled", "The analysis was cancelled.", true)
    return (
      configuration.describeFailure?.(error) ??
      localFailure(
        "lightweighting-failed",
        "The lightweighting computation failed; review the source and generation settings.",
        true,
      )
    )
  }
  return {
    async execute(inputActor: unknown, input: unknown, signal?: C) {
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
