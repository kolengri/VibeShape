import { z } from "zod"

export const quickLightweightingSettingsSchema = z
  .object({
    mode: z.enum(["preserve-exterior", "open-organic"]),
    removalPercent: z.number().finite().gt(0).lt(100),
    cellSizeMm: z.number().finite().positive(),
    skinThicknessMm: z.number().finite().nonnegative(),
    cellType: z.enum(["gyroid", "schwarz-p", "schwarz-d"]).optional(),
    latticeCellSizeMm: z.number().finite().positive().optional(),
  })
  .strict()
  .refine(
    ({ mode, skinThicknessMm, cellSizeMm }) =>
      mode !== "preserve-exterior" || skinThicknessMm >= 2 * cellSizeMm,
    { message: "A preserved exterior requires a skin at least two sampling cells thick." },
  )
  .refine(
    ({ latticeCellSizeMm, cellSizeMm, cellType }) => {
      const samples =
        (latticeCellSizeMm ?? (cellType === "schwarz-d" ? 12 : 6) * cellSizeMm) / cellSizeMm
      return samples >= 6 - 1e-8
    },
    { message: "A lattice cell requires at least six sampling cells." },
  )

/** Measured geometry evidence, without structural or manufacturing certification. */
export const quickLightweightingSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["preserve-exterior", "open-organic"]),
    requestedRemovalPercent: z.number().finite().gt(0).lt(100),
    removedPercent: z.number().finite().gt(0).lt(100),
    sourceVolumeMm3: z.number().finite().positive(),
    resultVolumeMm3: z.number().finite().positive(),
    cellSizeMm: z.number().finite().positive(),
    skinThicknessMm: z.number().finite().nonnegative(),
    cellType: z.enum(["gyroid", "schwarz-p", "schwarz-d"]),
    latticeCellSizeMm: z.number().finite().positive(),
    warnings: z.array(z.string().min(1).max(1_024)).max(20),
  })
  .strict()
  .refine(
    (summary) =>
      summary.resultVolumeMm3 < summary.sourceVolumeMm3 &&
      Math.abs(
        summary.removedPercent - 100 * (1 - summary.resultVolumeMm3 / summary.sourceVolumeMm3),
      ) <= 1e-6 &&
      summary.latticeCellSizeMm / summary.cellSizeMm >= 6 - 1e-8,
    {
      message:
        "Removal must match measured volumes; a lattice cell requires at least six sampling cells.",
    },
  )

export type QuickLightweightingSettings = z.infer<typeof quickLightweightingSettingsSchema>
export type QuickLightweightingSummary = z.infer<typeof quickLightweightingSummarySchema>

export function resolveQuickLightweightingSettings(settings: QuickLightweightingSettings) {
  return {
    ...settings,
    cellType: settings.cellType ?? "gyroid",
    latticeCellSizeMm:
      settings.latticeCellSizeMm ??
      (settings.cellType === "schwarz-d" ? 12 : 6) * settings.cellSizeMm,
  }
}
