import {
  quickLightweightingSettingsSchema,
  quickLightweightingSummarySchema,
} from "@vibeshape/domain/quick-lightweighting"
import { z } from "zod"
import { structuralMeshSchema } from "./contract"

export type { QuickLightweightingSettings } from "@vibeshape/domain/quick-lightweighting"

export const quickLightweightingMeshSchema = structuralMeshSchema
export { quickLightweightingSettingsSchema }

export const quickLightweightingProgressSchema = z
  .object({
    phase: z.enum(["sampling", "validation"]),
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  })
  .strict()
  .refine(({ completed, total }) => completed <= total, "Progress cannot exceed its batch total.")
export type QuickLightweightingProgress = z.infer<typeof quickLightweightingProgressSchema>

export const quickLightweightingInputSchema = quickLightweightingSettingsSchema.safeExtend({
  schemaVersion: z.literal(1),
  mesh: structuralMeshSchema,
})
export const quickLightweightingResultSchema = quickLightweightingSummarySchema.safeExtend({
  mesh: quickLightweightingMeshSchema,
})
export const quickLightweightingResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: quickLightweightingResultSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string().min(1).max(80), message: z.string().max(1_024) }).strict(),
    })
    .strict(),
])
export type QuickLightweightingInput = z.infer<typeof quickLightweightingInputSchema>
export type QuickLightweightingResult = z.infer<typeof quickLightweightingResultSchema>
export type QuickLightweightingResponse = z.infer<typeof quickLightweightingResponseSchema>
