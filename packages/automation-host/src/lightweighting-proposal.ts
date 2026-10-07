import {
  lightweightingAnalysisSchema,
  lightweightingOperationSchema,
  lightweightingRequestSchema,
  lightweightingResultContextMatches,
} from "@vibeshape/automation-api/lightweighting-tools"
import {
  type StructuralOptimizationSettings,
  type StructuralOptimizationSummary,
  structuralOptimizationSummarySchema,
} from "@vibeshape/domain/lightweighting"
import {
  createSourceBoundProposalCoordinator,
  type SourceBoundProposalConfiguration,
  type SourceBoundProposalSource,
} from "./source-bound-proposal"

export function createLightweightingProposalCoordinator<
  S extends SourceBoundProposalSource,
  P,
  C extends Readonly<{ aborted: boolean }>,
>(
  configuration: SourceBoundProposalConfiguration<
    StructuralOptimizationSettings,
    StructuralOptimizationSummary,
    S,
    P,
    C
  >,
) {
  return createSourceBoundProposalCoordinator({
    ...configuration,
    contracts: {
      operationSchema: lightweightingOperationSchema,
      summarySchema: structuralOptimizationSummarySchema,
      analysisSchema: lightweightingAnalysisSchema,
      requestSchema: lightweightingRequestSchema,
      resultContextMatches: lightweightingResultContextMatches,
      analyzeTool: "analyze_lightweighting",
      needsSnapshot: (summary) => summary.status === "improved",
    },
  })
}
