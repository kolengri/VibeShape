import { z } from "zod"

export const pictureScenes = ["studio", "wooden-table", "workbench", "outdoor"] as const
export const pictureFinishes = ["matte", "glossy", "translucent", "resin", "metal", "wood"] as const
export const pictureSizes = [
  { width: 1080, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 720, height: 1280 },
] as const
export const pictureRenderSettingsSchema = z
  .object({
    scene: z.enum(pictureScenes).default("studio"),
    quality: z.enum(["draft", "standard", "high"]).default("draft"),
    width: z.number().int().min(64).max(1920).default(1080),
    height: z.number().int().min(64).max(1920).default(1080),
    camera: z.enum(["auto", "current"]).default("auto"),
    finishes: z
      .record(z.string().max(256), z.enum(pictureFinishes))
      .refine((value) => Object.keys(value).length <= 128, "At most 128 finishes are supported.")
      .default({}),
  })
  .strict()
  .refine((value) => value.width * value.height <= 2_073_600, "Picture exceeds the pixel budget.")
export type PictureRenderSettings = z.infer<typeof pictureRenderSettingsSchema>

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000)
const vector = z.tuple([coordinate, coordinate, coordinate])
export const pictureRenderCameraSchema = z
  .strictObject({
    position: vector,
    target: vector,
    up: vector.optional(),
    viewHeightMm: z.number().positive().max(1_000_000).optional(),
  })
  .refine((v) => {
    const d = v.position.map((x, i) => x - (v.target[i] ?? 0))
    const u = v.up ?? [0, 0, 1]
    const dd = d.reduce((a, x) => a + x * x, 0),
      uu = u.reduce((a, x) => a + x * x, 0)
    const dot = d.reduce((a, x, i) => a + x * (u[i] ?? 0), 0)
    return dd > 1e-16 && uu > 1e-16 && dot * dot < 0.99980001 * dd * uu
  }, "Camera direction and up must be independent.")
