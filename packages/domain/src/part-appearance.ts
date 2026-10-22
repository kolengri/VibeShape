import { z } from "zod"
import { partIdSchema } from "./identifiers"

export const appearancePresetIdSchema = z.enum([
  "aluminum-satin",
  "steel-brushed",
  "stainless-steel",
  "brass",
  "copper",
  "chrome",
  "anodized-black",
  "abs-white",
  "abs-black",
  "abs-grey",
  "polycarbonate-clear",
  "nylon-natural",
])
export type AppearancePresetId = z.infer<typeof appearancePresetIdSchema>

export type AppearanceMaterial = Readonly<{
  /** Display color in sRGB; these presets make no physical material claims. */
  color: string
  roughness: number
  metalness: number
  opacity: number
}>

/** Stable IDs and display data only; hosts own localized labels. */
export const appearancePresets = {
  "aluminum-satin": { color: "#c4c9ce", roughness: 0.46, metalness: 0.82, opacity: 1 },
  "steel-brushed": { color: "#85909b", roughness: 0.54, metalness: 0.86, opacity: 1 },
  "stainless-steel": { color: "#bcc2c7", roughness: 0.28, metalness: 0.9, opacity: 1 },
  brass: { color: "#c6a24a", roughness: 0.32, metalness: 0.86, opacity: 1 },
  copper: { color: "#bd754e", roughness: 0.34, metalness: 0.88, opacity: 1 },
  chrome: { color: "#e0e5eb", roughness: 0.08, metalness: 0.98, opacity: 1 },
  "anodized-black": { color: "#252b32", roughness: 0.4, metalness: 0.72, opacity: 1 },
  "abs-white": { color: "#eceeeb", roughness: 0.62, metalness: 0, opacity: 1 },
  "abs-black": { color: "#282b30", roughness: 0.62, metalness: 0, opacity: 1 },
  "abs-grey": { color: "#8b929a", roughness: 0.62, metalness: 0, opacity: 1 },
  "polycarbonate-clear": { color: "#dce9ed", roughness: 0.12, metalness: 0, opacity: 0.28 },
  "nylon-natural": { color: "#e5dcc0", roughness: 0.78, metalness: 0, opacity: 1 },
} as const satisfies Record<AppearancePresetId, AppearanceMaterial>

export const appearanceColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "An appearance color must use #RRGGBB.")
  .brand<"AppearanceColor">()
export type AppearanceColor = z.infer<typeof appearanceColorSchema>
export const partAppearanceValueSchema = z
  .object({
    presetId: appearancePresetIdSchema.nullable(),
    color: appearanceColorSchema.optional(),
  })
  .strict()
export type PartAppearanceValue = Readonly<z.infer<typeof partAppearanceValueSchema>>
export const partAppearanceSchema = z
  .object({ partId: partIdSchema, appearance: partAppearanceValueSchema })
  .strict()
export type PartAppearance = Readonly<z.infer<typeof partAppearanceSchema>>

export const setPartAppearanceChangeSchema = z
  .object({
    kind: z.literal("part.set-appearance"),
    partId: partIdSchema,
    appearance: partAppearanceValueSchema.nullable(),
  })
  .strict()
export type SetPartAppearanceChange = Readonly<z.infer<typeof setPartAppearanceChangeSchema>>
