import { localFailure } from "@vibeshape/automation-api/local-tools"
import type { AutomationHostDiagnosticCode } from "@vibeshape/automation-host/host"
import { createSurfaceTextureProposalCoordinator } from "@vibeshape/automation-host/surface-texture-proposal"
import type {
  SurfaceTextureProposalConfiguration,
  SurfaceTextureReviewedInput,
} from "@vibeshape/automation-host/surface-texture-proposal-contract"
import { automationReviews } from "./automation-review-controller"

type BrowserTextureConfiguration = Omit<
  SurfaceTextureProposalConfiguration,
  "review" | "preview"
> & {
  preview: (
    input: SurfaceTextureReviewedInput,
    signal: AbortSignal,
  ) => ReturnType<SurfaceTextureProposalConfiguration["preview"]>
}

export function createBrowserSurfaceTextureAutomationSession(
  configuration: BrowserTextureConfiguration,
) {
  const owner = Symbol("browser-surface-texture-review")
  let closed = false
  let busy = false
  let cancellation: AbortController | null = null
  const coordinator = createSurfaceTextureProposalCoordinator({
    ...configuration,
    isActive: () => !closed && configuration.isActive(),
    preview: (input) => configuration.preview(input, cancellation?.signal ?? AbortSignal.abort()),
    review: (input) => automationReviews.request(owner, input),
  })
  function cancel(reason?: AutomationHostDiagnosticCode) {
    coordinator.cancel()
    cancellation?.abort()
    if (!coordinator.isPersisting()) automationReviews.cancel(owner, reason)
  }
  return {
    async execute(
      actor: unknown,
      operation: { tool: string; arguments: unknown },
      signal?: AbortSignal,
    ) {
      if (busy) return localFailure("busy", "Another texture proposal is pending.", true)
      busy = true
      cancellation = new AbortController()
      const onAbort = () => cancel()
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        if (signal?.aborted) onAbort()
        const result = await coordinator.execute(actor, operation, signal)
        if (operation.tool !== "model_surface_textures") automationReviews.complete(owner, result)
        return result
      } finally {
        busy = false
        signal?.removeEventListener("abort", onAbort)
        cancellation?.abort()
        cancellation = null
      }
    },
    cancel,
    dispose() {
      closed = true
      coordinator.dispose()
      cancellation?.abort()
      if (!coordinator.isPersisting()) automationReviews.cancel(owner)
    },
  }
}
