import { z } from "zod"
import { featureTypeSchema } from "./feature-graph"

const contributionCardinalitySchema = z
  .object({
    min: z.number().int().nonnegative().safe(),
    max: z.number().int().nonnegative().safe(),
  })
  .strict()
  .refine(({ min, max }) => min <= max, "Contribution minimum cannot exceed its maximum.")

export const featureTypeDescriptorSchema = z
  .object({
    schemaVersion: z.literal(0),
    type: featureTypeSchema,
    classification: z.enum(["sketch", "solid", "reference", "analysis"]),
    dependencies: contributionCardinalitySchema,
    references: contributionCardinalitySchema,
  })
  .strict()

export type FeatureTypeDescriptor = Readonly<z.infer<typeof featureTypeDescriptorSchema>>
export type FeatureTypeIdentity = FeatureTypeDescriptor["type"]

export function featureTypeKey(type: FeatureTypeIdentity) {
  return `${type.moduleId}@${type.moduleVersion}:${type.typeId}#${type.schemaVersion}`
}
