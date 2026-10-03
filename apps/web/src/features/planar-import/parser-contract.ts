import { preparedPlanarImportSchema } from "@vibeshape/domain/planar-import-authoring"
import {
  geometryImportDiagnosticSchema,
  geometryImportInputSchema,
} from "@vibeshape/formats/import"
import { z } from "zod"

const point = z.tuple([
  z.number().finite().min(-100000).max(100000),
  z.number().finite().min(-100000).max(100000),
])
export const planarParserRequestSchema = z
  .object({
    schemaVersion: z.literal(0),
    input: z.union([geometryImportInputSchema.options[2], geometryImportInputSchema.options[3]]),
  })
  .strict()
export const planarParserResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      schemaVersion: z.literal(0),
      ok: z.literal(true),
      prepared: preparedPlanarImportSchema,
      bounds: z
        .object({ min: point, max: point })
        .strict()
        .refine(({ min, max }) => min[0] <= max[0] && min[1] <= max[1]),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(0),
      ok: z.literal(false),
      diagnostic: geometryImportDiagnosticSchema,
    })
    .strict(),
])
export type PlanarParserRequest = z.infer<typeof planarParserRequestSchema>
export type PlanarInspection = Extract<z.infer<typeof planarParserResponseSchema>, { ok: true }>
