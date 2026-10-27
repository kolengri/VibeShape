import { documentIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { importUploadCommitSchema } from "./imports"
import {
  lightweightingAnalysisSchema,
  lightweightingOperations,
  lightweightingRequestSchema,
  lightweightingResultContextMatches,
  lightweightingToolNames,
} from "./lightweighting-tools"
import { localFailureSchema } from "./local-failure"
import {
  quickLightweightingAnalysisSchema,
  quickLightweightingOperations,
  quickLightweightingRequestSchema,
  quickLightweightingResultContextMatches,
  quickLightweightingToolNames,
} from "./quick-lightweighting-tools"

export const numericalToolNames = [
  ...lightweightingToolNames,
  ...quickLightweightingToolNames,
] as const
export const numericalToolNameSchema = z.enum(numericalToolNames)
export type NumericalToolName = z.infer<typeof numericalToolNameSchema>
export const numericalOperationSchema = z.discriminatedUnion("tool", [
  ...lightweightingOperations,
  ...quickLightweightingOperations,
])
export type NumericalOperation = z.infer<typeof numericalOperationSchema>

function resultOf<Schema extends z.ZodType>(schema: Schema) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: schema }).strict(),
    localFailureSchema,
  ])
}
const numericalToolResults = {
  analyze_lightweighting: resultOf(lightweightingAnalysisSchema),
  request_lightweighting: resultOf(lightweightingRequestSchema),
  analyze_quick_lightweighting: resultOf(quickLightweightingAnalysisSchema),
  request_quick_lightweighting: resultOf(quickLightweightingRequestSchema),
} as const

/** Original numerical results exclude background-job receipts. */
export function numericalToolResultSchema<Tool extends NumericalToolName>(tool: Tool) {
  return numericalToolResults[tool]
}
export const numericalCompletedResultSchema = z.union([
  numericalToolResults.analyze_lightweighting,
  numericalToolResults.request_lightweighting,
  numericalToolResults.analyze_quick_lightweighting,
  numericalToolResults.request_quick_lightweighting,
])
export type NumericalCompletedResult = z.infer<typeof numericalCompletedResultSchema>

export const numericalJobIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Numerical job ID must be a lowercase UUIDv7.",
  )
  .brand<"NumericalJobId">()
export type NumericalJobId = z.infer<typeof numericalJobIdSchema>
const jobContextSchema = z
  .object({
    jobId: numericalJobIdSchema,
    tool: numericalToolNameSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
  })
  .strict()
export const numericalJobReceiptSchema = jobContextSchema.extend({ status: z.literal("running") })
export type NumericalJobReceipt = z.infer<typeof numericalJobReceiptSchema>

function snapshotMatchesJob(snapshot: unknown, job: z.infer<typeof jobContextSchema>) {
  const parsed = importUploadCommitSchema.safeParse(snapshot)
  if (!parsed.success) return false
  return [
    parsed.data.documentId === job.documentId,
    parsed.data.baseRevision === job.baseRevision,
    parsed.data.revision > job.baseRevision,
  ].every(Boolean)
}

export const numericalJobStatusSchema = z
  .discriminatedUnion("status", [
    jobContextSchema.extend({ status: z.literal("running"), result: z.null() }),
    jobContextSchema.extend({ status: z.literal("cancelling"), result: z.null() }),
    jobContextSchema.extend({
      status: z.literal("completed"),
      result: numericalCompletedResultSchema,
    }),
  ])
  .refine((value) => {
    if (value.status !== "completed") return true
    const parsed = numericalToolResultSchema(value.tool).safeParse(value.result)
    if (!parsed.success) return false
    if (!parsed.data.ok) return true
    const result = parsed.data.value
    if (result.documentId !== value.documentId || result.baseRevision !== value.baseRevision)
      return false
    if ("snapshot" in result && result.snapshot) return snapshotMatchesJob(result.snapshot, value)
    return true
  }, "Completed numerical results must match their job tool, document, revision and snapshot.")
export type NumericalJobStatus = z.infer<typeof numericalJobStatusSchema>

const jobInputSchema = z.object({ jobId: numericalJobIdSchema }).strict()
export const numericalJobToolNames = ["get_numerical_job", "cancel_numerical_job"] as const
export const numericalJobToolInputs = {
  get_numerical_job: jobInputSchema,
  cancel_numerical_job: jobInputSchema,
} as const
export const numericalJobOperations = [
  z.object({ tool: z.literal("get_numerical_job"), arguments: jobInputSchema }).strict(),
  z.object({ tool: z.literal("cancel_numerical_job"), arguments: jobInputSchema }).strict(),
] as const
export const numericalJobOperationSchema = z.discriminatedUnion("tool", numericalJobOperations)
export type NumericalJobOperation = z.infer<typeof numericalJobOperationSchema>

export function numericalCompletedResultContextMatches(
  operation: { tool: string; arguments: unknown },
  result: { ok: boolean; value?: unknown },
  documentId?: string,
) {
  const parsed = numericalOperationSchema.safeParse({
    tool: operation.tool,
    arguments: operation.arguments,
  })
  if (!parsed.success || !numericalToolResultSchema(parsed.data.tool).safeParse(result).success)
    return false
  if (!result.ok) return true
  return (
    (lightweightingResultContextMatches(parsed.data, result, documentId) ??
      quickLightweightingResultContextMatches(parsed.data, result, documentId)) === true
  )
}

export function numericalJobResultContextMatches(
  operation: { tool: string; arguments: unknown },
  result: { ok: boolean; value?: unknown },
  documentId?: string,
) {
  if (!result.ok) return null
  const command = { tool: operation.tool, arguments: operation.arguments }
  const numerical = numericalOperationSchema.safeParse(command)
  if (numerical.success) {
    const receipt = numericalJobReceiptSchema.safeParse(result.value)
    if (!receipt.success) return null
    return (
      receipt.data.tool === numerical.data.tool &&
      receipt.data.baseRevision === numerical.data.arguments.baseRevision &&
      (documentId === undefined || receipt.data.documentId === documentId)
    )
  }
  if (!numericalJobToolNames.some((tool) => tool === operation.tool)) return null
  const control = numericalJobOperationSchema.safeParse(command)
  const status = numericalJobStatusSchema.safeParse(result.value)
  return (
    control.success &&
    status.success &&
    status.data.jobId === control.data.arguments.jobId &&
    (documentId === undefined || status.data.documentId === documentId)
  )
}
