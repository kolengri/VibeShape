import { localFailure } from "@vibeshape/automation-api/local-tools"
import {
  type NumericalOperation,
  numericalCompletedResultContextMatches,
  numericalOperationSchema,
  numericalToolResultSchema,
} from "@vibeshape/automation-api/numerical-jobs"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"

type Job = {
  jobId: string
  tool: NumericalOperation["tool"]
  documentId: string
  baseRevision: number
  status: "running" | "cancelling" | "completed"
  result: unknown
}
type OwnedJob = {
  view: Job
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
    return { ok: true as const, value }
  }

  async function run(job: OwnedJob) {
    try {
      const raw = await configuration.execute(job.actor, job.operation, job.controller.signal)
      const parsed = numericalToolResultSchema(job.operation.tool).safeParse(raw)
      job.view.result =
        parsed.success &&
        numericalCompletedResultContextMatches(
          job.operation,
          parsed.data,
          configuration.documentId,
        ) !== false
          ? parsed.data
          : localFailure("invalid-result", "The numerical result does not match its request.")
    } catch {
      job.view.result = localFailure(
        job.controller.signal.aborted ? "request-cancelled" : "lightweighting-failed",
        job.controller.signal.aborted
          ? "The numerical operation was cancelled."
          : "The numerical operation failed before returning a result.",
        true,
      )
    } finally {
      job.view.status = "completed"
      if (active === job) active = null
    }
  }

  function cancelActive() {
    if (!active) return
    active.view.status = "cancelling"
    active.controller.abort()
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
        view: {
          jobId: configuration.createId(),
          tool: parsed.data.tool,
          documentId: configuration.documentId,
          baseRevision: parsed.data.arguments.baseRevision,
          status: "running",
          result: null,
        },
      }
      jobs.set(job.view.jobId, job)
      active = job
      const started = receipt(job)
      // Do not couple this controller to the already completed start request's signal.
      void run(job)
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
    cancel: cancelActive,
    dispose() {
      closed = true
      cancelActive()
      jobs.clear()
    },
  }
}
