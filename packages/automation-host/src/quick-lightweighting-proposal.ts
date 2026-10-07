import {
  quickLightweightingAnalysisSchema,
  quickLightweightingOperationSchema,
  quickLightweightingRequestSchema,
  quickLightweightingResultContextMatches,
} from "@vibeshape/automation-api/quick-lightweighting-tools"
import {
  type QuickLightweightingSettings,
  type QuickLightweightingSummary,
  quickLightweightingSummarySchema,
} from "@vibeshape/domain/quick-lightweighting"
import {
  createSourceBoundProposalCoordinator,
  type SourceBoundProposalConfiguration,
  type SourceBoundProposalSource,
} from "./source-bound-proposal"

export function createQuickLightweightingProposalCoordinator<
  S extends SourceBoundProposalSource,
  P,
  C extends Readonly<{ aborted: boolean }>,
>(
  configuration: SourceBoundProposalConfiguration<
    QuickLightweightingSettings,
    QuickLightweightingSummary,
    S,
    P,
    C
  >,
) {
  return createSourceBoundProposalCoordinator({
    ...configuration,
    contracts: {
      operationSchema: quickLightweightingOperationSchema,
      summarySchema: quickLightweightingSummarySchema,
      analysisSchema: quickLightweightingAnalysisSchema,
      requestSchema: quickLightweightingRequestSchema,
      resultContextMatches: quickLightweightingResultContextMatches,
      analyzeTool: "analyze_quick_lightweighting",
      needsSnapshot: () => true,
    },
  })
}
