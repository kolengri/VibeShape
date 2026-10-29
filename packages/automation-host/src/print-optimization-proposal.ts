import {
  type PrintOptimizationSettings,
  type PrintOptimizationSummary,
  printOptimizationAnalysisSchema,
  printOptimizationOperationSchema,
  printOptimizationRequestSchema,
  printOptimizationResultContextMatches,
  printOptimizationSummarySchema,
} from "@vibeshape/automation-api/print-optimization-tools"
import {
  createSourceBoundProposalCoordinator,
  type SourceBoundProposalConfiguration,
  type SourceBoundProposalSource,
} from "./source-bound-proposal"

export function createPrintOptimizationProposalCoordinator<
  S extends SourceBoundProposalSource,
  P,
  C extends Readonly<{ aborted: boolean }>,
>(
  configuration: SourceBoundProposalConfiguration<
    PrintOptimizationSettings,
    PrintOptimizationSummary,
    S,
    P,
    C
  >,
) {
  return createSourceBoundProposalCoordinator({
    ...configuration,
    contracts: {
      operationSchema: printOptimizationOperationSchema,
      summarySchema: printOptimizationSummarySchema,
      analysisSchema: printOptimizationAnalysisSchema,
      requestSchema: printOptimizationRequestSchema,
      resultContextMatches: printOptimizationResultContextMatches,
      analyzeTool: "analyze_print_optimization",
      needsSnapshot: (summary) => summary.proposal.status === "improved",
    },
  })
}
