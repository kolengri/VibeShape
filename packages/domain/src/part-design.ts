import { z } from "zod"
import { featureTypeDescriptorSchema } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { lengthQuantitySchema } from "./units"

const MAX_PRIMITIVE_LENGTH_MM = 1_000_000

const primitiveLengthSchema = lengthQuantitySchema.refine(
  ({ value }) => value > 0 && value <= MAX_PRIMITIVE_LENGTH_MM,
  `Primitive lengths must be greater than zero and at most ${MAX_PRIMITIVE_LENGTH_MM} mm.`,
)

export const boxFeatureParametersSchema = z
  .object({
    width: primitiveLengthSchema,
    depth: primitiveLengthSchema,
    height: primitiveLengthSchema,
    centered: z.boolean(),
  })
  .strict()

export const cylinderFeatureParametersSchema = z
  .object({
    radius: primitiveLengthSchema,
    height: primitiveLengthSchema,
    centered: z.boolean(),
  })
  .strict()

export const boxFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.box",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})

export const cylinderFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.cylinder",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})

export const partDesignFeatureTypeHandlers: readonly TrustedFeatureTypeHandler[] = [
  {
    type: boxFeatureType.type,
    parametersSchema: boxFeatureParametersSchema,
    contentParameters(parameters) {
      const box = boxFeatureParametersSchema.parse(parameters)
      return {
        width: box.width.value,
        depth: box.depth.value,
        height: box.height.value,
        centered: box.centered,
      }
    },
  },
  {
    type: cylinderFeatureType.type,
    parametersSchema: cylinderFeatureParametersSchema,
    contentParameters(parameters) {
      const cylinder = cylinderFeatureParametersSchema.parse(parameters)
      return {
        radius: cylinder.radius.value,
        height: cylinder.height.value,
        centered: cylinder.centered,
      }
    },
  },
]
