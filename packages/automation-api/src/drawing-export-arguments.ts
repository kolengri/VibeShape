import { drawingSettingsSchema } from "@vibeshape/domain/drawing"
import { partIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"

export const DRAWING_EXPORT_FORMATS = ["svg", "dxf", "pdf"] as const

/**
 * A derived drawing of the committed revision. Omitted settings use the dialog defaults; `partId`
 * limits the projection to one authored Part with an exact solid body.
 */
export const prepareDrawingExportArgumentsSchema = z.strictObject({
  revision: revisionSchema,
  format: z.enum(DRAWING_EXPORT_FORMATS),
  partId: partIdSchema.optional(),
  settings: drawingSettingsSchema.default(() => drawingSettingsSchema.parse({})),
})
export type PrepareDrawingExportArguments = z.infer<typeof prepareDrawingExportArgumentsSchema>
