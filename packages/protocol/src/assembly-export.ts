import { z } from "zod"
import { inspectAssemblyInputSchema } from "./assembly-inspection"
import { geometryExportFormatSchema } from "./geometry-worker"
import { printPreparationSettingsSchema } from "./print-preparation"

const instanceId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
export const assemblyExportSettingsSchema = z
  .object({
    format: geometryExportFormatSchema,
    instanceIds: z
      .array(instanceId)
      .min(1)
      .max(256)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    printPreparation: printPreparationSettingsSchema.optional(),
  })
  .strict()
  .refine((settings) => settings.printPreparation === undefined || settings.format === "3mf", {
    message: "Assembly print preparation requires 3MF export.",
  })
export type AssemblyExportSettings = z.infer<typeof assemblyExportSettingsSchema>
export const exportAssemblyInputSchema = z
  .object({
    assembly: inspectAssemblyInputSchema.refine((input) => input.interferencePairs.length === 0),
    settings: assemblyExportSettingsSchema,
  })
  .strict()
export type ExportAssemblyInput = z.infer<typeof exportAssemblyInputSchema>
