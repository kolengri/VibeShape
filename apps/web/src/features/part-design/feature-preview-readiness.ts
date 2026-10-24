import type { FeaturePreviewState } from "../preview/use-feature-preview"

export function isFeaturePreviewReady(status: FeaturePreviewState["status"] | undefined) {
  return status === undefined || status === "ready"
}
