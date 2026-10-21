import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  documentIdSchema,
  featureIdSchema,
  partIdSchema,
  revisionSchema,
} from "@vibeshape/domain/identifiers"
import {
  type StructuralOptimizationSettings,
  type StructuralOptimizationSummary,
  structuralAlgorithmSummaryMatches,
  structuralFdmSummaryMatches,
  structuralOptimizationSettingsSchema,
  structuralOptimizationSummarySchema,
} from "@vibeshape/domain/lightweighting"
import { z } from "zod"
import { importUploadCommitSchema } from "./imports"

export const LIGHTWEIGHTING_ANALYSIS_TIMEOUT_MS = 4 * 60 * 1000
export const LIGHTWEIGHTING_REQUEST_TIMEOUT_MS = 9 * 60 * 1000

export const lightweightingSourceIdentitySchema = z
  .object({
    partId: partIdSchema,
    featureId: featureIdSchema,
    outputRole: z.string().min(1).max(120),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
const argumentsSchema = z
  .object({
    baseRevision: revisionSchema,
    source: lightweightingSourceIdentitySchema,
    settings: structuralOptimizationSettingsSchema,
  })
  .strict()
export const lightweightingToolInputs = {
  analyze_lightweighting: argumentsSchema,
  request_lightweighting: argumentsSchema.extend({ label: z.string().trim().min(1).max(120) }),
} as const
export const lightweightingToolNames = ["analyze_lightweighting", "request_lightweighting"] as const
export const lightweightingOperations = [
  z
    .object({
      tool: z.literal("analyze_lightweighting"),
      arguments: lightweightingToolInputs.analyze_lightweighting,
    })
    .strict(),
  z
    .object({
      tool: z.literal("request_lightweighting"),
      arguments: lightweightingToolInputs.request_lightweighting,
    })
    .strict(),
] as const
export const lightweightingOperationSchema = z.discriminatedUnion("tool", lightweightingOperations)
export type LightweightingOperation = z.infer<typeof lightweightingOperationSchema>
export type LightweightingSourceIdentity = z.infer<typeof lightweightingSourceIdentitySchema>
export const lightweightingAnalysisSchema = z
  .object({
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    source: lightweightingSourceIdentitySchema,
    summary: structuralOptimizationSummarySchema,
  })
  .strict()
export const lightweightingRequestSchema = lightweightingAnalysisSchema
  .extend({ snapshot: importUploadCommitSchema.nullable() })
  .refine(
    ({ summary, snapshot }) => (summary.status === "improved") === (snapshot !== null),
    "An improved request must identify its manually applied snapshot.",
  )
export type LightweightingAnalysis = z.infer<typeof lightweightingAnalysisSchema>
export type LightweightingRequest = z.infer<typeof lightweightingRequestSchema>
export function lightweightingResultContextMatches(
  operation: { tool: string; arguments: unknown },
  result: { ok: boolean; value?: unknown },
  documentId?: string,
) {
  if (!lightweightingToolNames.some((name) => name === operation.tool) || !result.ok) return null
  const parsed = lightweightingOperationSchema.safeParse(operation)
  if (!parsed.success) return false
  const input = parsed.data.arguments
  const output =
    parsed.data.tool === "analyze_lightweighting"
      ? lightweightingAnalysisSchema.safeParse(result.value)
      : lightweightingRequestSchema.safeParse(result.value)
  if (!output.success) return false
  const value = output.data
  if (
    (documentId !== undefined && value.documentId !== documentId) ||
    value.baseRevision !== input.baseRevision ||
    canonicalJson(value.source) !== canonicalJson(input.source) ||
    value.summary.cellSizeMm !== input.settings.cellSizeMm ||
    value.summary.iterations > input.settings.maxIterations
  )
    return false
  if (!summaryMatchesSettings(value.summary, input.settings)) return false
  if (parsed.data.tool === "request_lightweighting") {
    const request = lightweightingRequestSchema.parse(result.value)
    if (
      request.snapshot &&
      (request.snapshot.documentId !== value.documentId ||
        request.snapshot.baseRevision !== value.baseRevision ||
        request.snapshot.revision <= value.baseRevision)
    )
      return false
  }
  return true
}

function summaryMatchesSettings(
  summary: StructuralOptimizationSummary,
  settings: StructuralOptimizationSettings,
) {
  return [
    structuralAlgorithmSummaryMatches(
      summary.algorithm,
      settings.algorithm,
      settings.cellSizeMm,
      summary.initialCellCount,
      summary.finalCellCount,
      summary.iterations,
    ),
    constraintsMatch(summary, settings),
    objectiveMatches(summary, settings),
    structuralFdmSummaryMatches(summary.fdm, settings.fdm, settings.cellSizeMm),
  ].every(Boolean)
}

function objectiveMatches(
  summary: StructuralOptimizationSummary,
  settings: StructuralOptimizationSettings,
) {
  const objective = settings.objective
  const measured = summary.objective
  if (objective?.kind !== "maximize-stiffness")
    return (
      (measured === undefined || measured.kind === "minimize-mass") &&
      summary.termination !== "target-mass-reached"
    )
  if (measured?.kind !== "maximize-stiffness") return false
  const targetCount = Math.ceil(summary.initialCellCount * objective.retainedMassFraction)
  const reached = summary.finalCellCount === targetCount
  return [
    measured.retainedMassFraction === objective.retainedMassFraction,
    measured.targetCellCount === targetCount,
    summary.finalCellCount >= targetCount,
    closeFraction(measured.targetMassKg / summary.baseline.massKg, objective.retainedMassFraction),
    closeFraction(
      measured.achievedRetainedMassFraction,
      summary.optimized.massKg / summary.baseline.massKg,
    ),
    closeFraction(
      measured.achievedRetainedMassFraction,
      summary.finalCellCount / summary.initialCellCount,
    ),
    measured.targetStatus === (reached ? "reached" : "not-reached"),
    (summary.termination === "target-mass-reached") === reached,
  ].every(Boolean)
}

function closeFraction(actual: number, expected: number) {
  return Math.abs(actual - expected) <= 1e-8
}

function constraintsMatch(
  summary: StructuralOptimizationSummary,
  settings: StructuralOptimizationSettings,
) {
  const stressLimit = settings.material.yieldStrengthMpa / settings.safetyFactor
  if (
    summary.finalCellCount > summary.initialCellCount ||
    (summary.status === "improved") !== summary.finalCellCount < summary.initialCellCount ||
    summary.optimized.volumeMm3 > summary.baseline.volumeMm3 * (1 + 1e-8)
  )
    return false
  return [summary.baseline, summary.optimized].every(
    (metrics) =>
      metrics.cases.length === settings.loadCases.length &&
      metrics.cases.every((item, index) => item.name === settings.loadCases[index]?.name) &&
      [metrics, ...metrics.cases].every(
        (item) =>
          item.maxVonMisesMpa <= stressLimit * (1 + 1e-8) &&
          item.maxDisplacementMm <= settings.maxDisplacementMm * (1 + 1e-8) &&
          item.safetyFactor >= settings.safetyFactor * (1 - 1e-8),
      ),
  )
}
