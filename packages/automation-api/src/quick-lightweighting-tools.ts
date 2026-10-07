import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { documentIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import {
  type QuickLightweightingSettings,
  type QuickLightweightingSummary,
  quickLightweightingSettingsSchema,
  quickLightweightingSummarySchema,
  resolveQuickLightweightingSettings,
} from "@vibeshape/domain/quick-lightweighting"
import { z } from "zod"
import { importUploadCommitSchema } from "./imports"
import { lightweightingSourceIdentitySchema } from "./lightweighting-tools"

const argumentsSchema = z
  .object({
    baseRevision: revisionSchema,
    source: lightweightingSourceIdentitySchema,
    settings: quickLightweightingSettingsSchema,
  })
  .strict()
export const quickLightweightingToolInputs = {
  analyze_quick_lightweighting: argumentsSchema,
  request_quick_lightweighting: argumentsSchema.extend({
    label: z.string().trim().min(1).max(120),
  }),
} as const
export const quickLightweightingToolNames = [
  "analyze_quick_lightweighting",
  "request_quick_lightweighting",
] as const
export const quickLightweightingOperations = [
  z
    .object({
      tool: z.literal("analyze_quick_lightweighting"),
      arguments: quickLightweightingToolInputs.analyze_quick_lightweighting,
    })
    .strict(),
  z
    .object({
      tool: z.literal("request_quick_lightweighting"),
      arguments: quickLightweightingToolInputs.request_quick_lightweighting,
    })
    .strict(),
] as const
export const quickLightweightingOperationSchema = z.discriminatedUnion(
  "tool",
  quickLightweightingOperations,
)
export type QuickLightweightingOperation = z.infer<typeof quickLightweightingOperationSchema>
export const quickLightweightingAnalysisSchema = z
  .object({
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    source: lightweightingSourceIdentitySchema,
    summary: quickLightweightingSummarySchema,
  })
  .strict()
export const quickLightweightingRequestSchema = quickLightweightingAnalysisSchema.extend({
  snapshot: importUploadCommitSchema,
})
export type QuickLightweightingAnalysis = z.infer<typeof quickLightweightingAnalysisSchema>
export type QuickLightweightingRequest = z.infer<typeof quickLightweightingRequestSchema>

export function quickLightweightingResultContextMatches(
  operation: { tool: string; arguments: unknown },
  result: { ok: boolean; value?: unknown },
  documentId?: string,
) {
  if (!quickLightweightingToolNames.some((name) => name === operation.tool) || !result.ok)
    return null
  const parsed = quickLightweightingOperationSchema.safeParse(operation)
  if (!parsed.success) return false
  const input = parsed.data.arguments
  const output =
    parsed.data.tool === "analyze_quick_lightweighting"
      ? quickLightweightingAnalysisSchema.safeParse(result.value)
      : quickLightweightingRequestSchema.safeParse(result.value)
  if (!output.success) return false
  const value = output.data
  if (!analysisContextMatches(input, value, documentId)) return false
  if (parsed.data.tool === "request_quick_lightweighting")
    return snapshotContextMatches(quickLightweightingRequestSchema.parse(result.value))
  return true
}

function generatedSettingsMatch(
  settings: QuickLightweightingSettings,
  summary: QuickLightweightingSummary,
) {
  const effective = resolveQuickLightweightingSettings(settings)
  return [
    summary.mode === settings.mode,
    summary.requestedRemovalPercent === settings.removalPercent,
    summary.cellSizeMm === settings.cellSizeMm,
    summary.skinThicknessMm === settings.skinThicknessMm,
    summary.cellType === effective.cellType,
    summary.latticeCellSizeMm === effective.latticeCellSizeMm,
  ].every(Boolean)
}
function analysisContextMatches(
  input: QuickLightweightingOperation["arguments"],
  value: QuickLightweightingAnalysis,
  documentId?: string,
) {
  return [
    documentId === undefined || value.documentId === documentId,
    value.baseRevision === input.baseRevision,
    canonicalJson(value.source) === canonicalJson(input.source),
    generatedSettingsMatch(input.settings, value.summary),
  ].every(Boolean)
}
function snapshotContextMatches(value: QuickLightweightingRequest) {
  return [
    value.snapshot.documentId === value.documentId,
    value.snapshot.baseRevision === value.baseRevision,
    value.snapshot.revision > value.baseRevision,
  ].every(Boolean)
}
