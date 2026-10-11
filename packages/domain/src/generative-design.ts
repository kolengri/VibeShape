import { z } from "zod"
import { structuralMaterialSchema } from "./lightweighting"

export const generativeDesignSettingsSchema = z
  .object({
    materials: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(80),
            name: z.string().trim().min(1).max(80),
            material: structuralMaterialSchema,
          })
          .strict(),
      )
      .min(1)
      .max(3)
      .refine((materials) => new Set(materials.map(({ id }) => id)).size === materials.length, {
        message: "Study material IDs must be unique.",
      }),
    retainedMassFractions: z
      .array(z.number().finite().min(0.1).max(1))
      .min(1)
      .max(3)
      .refine((fractions) => new Set(fractions).size === fractions.length, {
        message: "Study retained mass fractions must be unique.",
      }),
  })
  .strict()

export type GenerativeDesignSettings = z.infer<typeof generativeDesignSettingsSchema>
