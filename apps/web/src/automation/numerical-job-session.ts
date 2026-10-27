import { localFailure } from "@vibeshape/automation-api/local-tools"
import {
  type NumericalCompletedResult,
  type NumericalJobStatus,
  type NumericalOperation,
  numericalCompletedResultContextMatches,
  numericalJobReceiptSchema,
  numericalJobStatusSchema,
  numericalOperationSchema,
  numericalToolResultSchema,
} from "@vibeshape/automation-api/numerical-jobs"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"

type OwnedJob = {
  view: NumericalJobStatus
  actor: CommandActor
  operation: NumericalOperation
  controller: AbortController
}

/** The browser owns computation independently of the short request that starts it. */
export function createNumericalJobSession(configuration: {
  documentId: string
  createId: () => string
  isActive: () => boolean
  execute: (
    actor: CommandActor,
    operation: NumericalOperation,
    signal: AbortSignal,
  ) => Promise<unknown>
}) {
  const jobs = new Map<string, OwnedJob>()
  let active: OwnedJob | null = null
  let owner: CommandActor | null = null
  let closed = false
  const empty: readonly NumericalJobStatus[] = []
  let snapshot = empty
  const listeners = new Set<() => void>()

  function publish() {
    snapshot = jobs.size ? Array.from(jobs.values(), (job) => job.view) : empty
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // Observers cannot interrupt job ownership or solver cleanup.
      }
    }
  }

  function authorize(input: unknown) {
    if (closed || !configuration.isActive())
      return localFailure("session-revoked", "The numerical job session is unavailable.")
    const parsed = commandActorSchema.safeParse(input)
    if (
      !parsed.success ||
      parsed.data.type !== "mcp" ||
      (owner && !commandActorsEqual(owner, parsed.data))
    )
      return localFailure("numerical-job-owner-mismatch", "The actor does not own these jobs.")
    return { ok: true as const, value: parsed.data }
  }

  function receipt(job: OwnedJob) {
    const { result: _result, ...value } = job.view
    return { ok: true as const, value: numericalJobReceiptSchema.parse(value) }
  }

  function completedResult(job: OwnedJob, raw: unknown): NumericalCompletedResult {
    const parsed = numericalToolResultSchema(job.operation.tool).safeParse(raw)
    if (
      parsed.success &&
      numericalCompletedResultContextMatches(
        job.operation,
        parsed.data,
        configuration.documentId,
      ) !== false
    )
      return parsed.data
    return localFailure("invalid-result", "The numerical result does not match its request.")
  }

  async function run(job: OwnedJob) {
    let result: NumericalCompletedResult
    try {
      const raw = await configuration.execute(job.actor, job.operation, job.controller.signal)
      result = completedResult(job, raw)
    } catch {
      result = localFailure(
        job.controller.signal.aborted ? "request-cancelled" : "lightweighting-failed",
        job.controller.signal.aborted
          ? "The numerical operation was cancelled."
          : "The numerical operation failed before returning a result.",
        true,
      )
    } finally {
      if (active === job) active = null
    }
    if (closed || jobs.get(job.view.jobId) !== job || !configuration.isActive()) return
    job.view = numericalJobStatusSchema.parse({ ...job.view, status: "completed", result })
    publish()
  }

  function cancelActive() {
    if (active?.view.status !== "running") return
    active.view = { ...active.view, status: "cancelling", result: null }
    active.controller.abort()
    publish()
  }

  return {
    start(inputActor: unknown, input: unknown) {
      const authorized = authorize(inputActor)
      if (!authorized.ok) return authorized
      const parsed = numericalOperationSchema.safeParse(input)
      if (!parsed.success)
        return localFailure("invalid-operation", "The numerical operation is invalid.")
      if (active) {
        if (
          active.view.status === "running" &&
          canonicalJson(active.operation) === canonicalJson(parsed.data)
        )
          return receipt(active)
        return localFailure(
          "busy",
          `Numerical job ${active.view.jobId} is pending. Read or cancel it before starting another.`,
          true,
        )
      }
      owner ??= authorized.value
      const job: OwnedJob = {
        actor: authorized.value,
        operation: parsed.data,
        controller: new AbortController(),
        view: numericalJobStatusSchema.parse({
          jobId: configuration.createId(),
          tool: parsed.data.tool,
          documentId: configuration.documentId,
          baseRevision: parsed.data.arguments.baseRevision,
          status: "running",
          result: null,
        }),
      }
      jobs.set(job.view.jobId, job)
      active = job
      const started = receipt(job)
      publish()
      // Do not couple this controller to the already completed start request's signal.
      if (!closed && jobs.get(job.view.jobId) === job) void run(job)
      return started
    },
    read(inputActor: unknown, jobId: string, cancel = false) {
      const authorized = authorize(inputActor)
      if (!authorized.ok) return authorized
      const job = jobs.get(jobId)
      if (!job || !commandActorsEqual(job.actor, authorized.value))
        return localFailure("numerical-job-missing", "The numerical job is unavailable.")
      if (cancel && active === job) cancelActive()
      return { ok: true as const, value: { ...job.view } }
    },
    getSnapshot(inputActor: unknown): readonly NumericalJobStatus[] {
      return authorize(inputActor).ok ? snapshot : empty
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    cancel: cancelActive,
    dispose() {
      if (closed) return
      closed = true
      active?.controller.abort()
      active = null
      jobs.clear()
      publish()
    },
  }
}
