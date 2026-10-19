import { localFailure, localFailureSchema } from "@vibeshape/automation-api/local-tools"
import { createAssemblyAutomationSession } from "@vibeshape/automation-host/assembly-session"
import type { AssemblySessionConfiguration } from "@vibeshape/automation-host/assembly-session-contract"
import type { AutomationHostDiagnosticCode } from "@vibeshape/automation-host/host"
import { automationReviews } from "./automation-review-controller"

export function createBrowserAssemblyAutomationSession(
  configuration: Omit<AssemblySessionConfiguration, "review">,
  reviews = automationReviews,
) {
  const owner = Symbol("browser-assembly-review")
  const session = createAssemblyAutomationSession({
    ...configuration,
    review: (input) => reviews.request(owner, input),
  })
  let reviewing = false
  return {
    async execute(
      actor: unknown,
      operation: { tool: string; arguments: unknown },
      signal?: AbortSignal,
    ) {
      const review =
        operation.tool === "commit_assembly_draft" ||
        operation.tool === "save_library_definition" ||
        operation.tool === "update_library_metadata"
      if (review && reviewing)
        return localFailure("busy", "An assembly or library proposal is already pending.", true)
      if (review) reviewing = true
      const abort = () => {
        session.cancel()
        if (!session.isPersisting()) reviews.cancel(owner)
      }
      signal?.addEventListener("abort", abort, { once: true })
      try {
        const result = await session.execute(actor, operation, signal)
        if (review) reviews.complete(owner, result)
        return result
      } finally {
        if (review) reviewing = false
        signal?.removeEventListener("abort", abort)
      }
    },
    cancel(reason?: AutomationHostDiagnosticCode) {
      session.cancel()
      if (!session.isPersisting()) reviews.cancel(owner, reason)
    },
    dispose() {
      session.dispose()
      if (!session.isPersisting()) reviews.cancel(owner)
    },
  }
}

export function assemblyPortFailure(diagnostic: {
  code: string
  message: string
  retryable: boolean
  assembly?: unknown
}) {
  const parsed = localFailureSchema.safeParse({
    ok: false,
    diagnostic: {
      code: diagnostic.code,
      message: diagnostic.message.slice(0, 512),
      retryable: diagnostic.retryable,
      ...(diagnostic.assembly === undefined ? {} : { assembly: diagnostic.assembly }),
    },
  })
  if (!parsed.success)
    return localFailure(
      "assembly-operation-failed",
      "The controller returned invalid assembly diagnostics.",
    )
  const constraint = parsed.data.diagnostic.assembly
  return constraint
    ? { ...parsed.data, diagnostic: { ...parsed.data.diagnostic, code: constraint.code } }
    : parsed.data
}
