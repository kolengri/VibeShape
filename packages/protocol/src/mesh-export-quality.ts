import { z } from "zod"

/** Absolute millimeter chord error and angular deflection in radians for exact-solid exports. */
export const meshExportQualitySchema = z.strictObject({
  chordTolerance: z.number().finite().min(0.005).max(1),
  angularTolerance: z.number().finite().min(0.01).max(0.5),
})
export type MeshExportQuality = z.infer<typeof meshExportQualitySchema>

export const meshExportQualityPresets = {
  coarse: { chordTolerance: 0.2, angularTolerance: 0.3 },
  fine: { chordTolerance: 0.01, angularTolerance: 0.05 },
} as const satisfies Readonly<Record<string, MeshExportQuality>>
