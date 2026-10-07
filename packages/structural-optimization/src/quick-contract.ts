import {
  quickLightweightingSettingsSchema,
  quickLightweightingSummarySchema,
} from "@vibeshape/domain/quick-lightweighting"
import { z } from "zod"
import { structuralMeshSchema } from "./contract"

export type { QuickLightweightingSettings } from "@vibeshape/domain/quick-lightweighting"

export const quickLightweightingMeshSchema = z
  .object({
    vertices: z.array(z.number().finite().min(-100_000).max(100_000)).min(12).max(240_000),
    indices: z.array(z.number().int().nonnegative()).min(12).max(420_000),
  })
  .strict()
  .refine(
    ({ vertices, indices }) =>
      vertices.length % 3 === 0 &&
      indices.length % 3 === 0 &&
      indices.every((index) => index < vertices.length / 3),
    "Meshes require complete XYZ triples and valid triangle indices.",
  )
export { quickLightweightingSettingsSchema }

export const quickLightweightingProgressSchema = z
  .object({
    phase: z.enum(["sampling", "validation"]),
    completed: z.number().int().min(0).max(1_000_000),
    total: z.number().int().positive().max(1_000_000),
  })
  .strict()
  .refine(({ completed, total }) => completed <= total, "Progress cannot exceed its batch total.")
export type QuickLightweightingProgress = z.infer<typeof quickLightweightingProgressSchema>

export const quickLightweightingInputSchema = quickLightweightingSettingsSchema.safeExtend({
  schemaVersion: z.literal(1),
  mesh: structuralMeshSchema.refine(
    ({ vertices, indices }) => vertices.length <= 30_000 && indices.length <= 60_000,
    "The source exceeds the 10,000-vertex or 20,000-triangle quick lightweighting budget.",
  ),
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
