import { bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import {
  commandIdSchema,
  draftIdSchema,
  featureIdSchema,
  revisionSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import {
  extrusionFeatureParametersSchema,
  extrusionFeatureParametersV3Schema,
  extrusionFeatureParametersV4Schema,
  revolveFeatureParametersSchema,
  revolveFeatureParametersV5Schema,
  revolveFeatureParametersV6Schema,
} from "@vibeshape/domain/part-design"
import { sketchRecordSchema } from "@vibeshape/domain/sketch"
import { lengthQuantitySchema } from "@vibeshape/domain/units"
import { z } from "zod"

const command = {
  draftId: draftIdSchema,
  baseRevision: revisionSchema,
  commandId: commandIdSchema,
}
const feature = {
  ...command,
  featureId: featureIdSchema,
  label: featureRecordSchema.shape.label,
  dependencies: featureRecordSchema.shape.dependencies.max(3),
  references: featureRecordSchema.shape.references.max(1),
  suppressed: z.boolean(),
}
const sketch = z.object({ ...command, sketch: sketchRecordSchema }).strict()
const extrude = z
  .object({
    ...feature,
    parameters: z.union([
      extrusionFeatureParametersSchema,
      extrusionFeatureParametersV3Schema,
      extrusionFeatureParametersV4Schema,
    ]),
  })
  .strict()
const revolve = z
  .object({
    ...feature,
    parameters: z.union([
      revolveFeatureParametersSchema,
      revolveFeatureParametersV5Schema,
      revolveFeatureParametersV6Schema,
    ]),
  })
  .strict()
const holeParameters = z.discriminatedUnion("extent", [
  z
    .object({
      sketchId: sketchIdSchema,
      pointIds: z.array(sketchEntityIdSchema).min(1).max(256),
      diameter: lengthQuantitySchema.refine(({ value }) => value > 0 && value <= 1_000_000),
      direction: z.enum(["forward", "reverse"]),
      extent: z.literal("blind"),
      depth: lengthQuantitySchema.refine(({ value }) => value > 0 && value <= 1_000_000),
    })
    .strict()
    .superRefine((parameters, context) => {
      if (new Set(parameters.pointIds).size !== parameters.pointIds.length)
        context.addIssue({
          code: "custom",
          path: ["pointIds"],
          message: "Point IDs must be distinct.",
        })
    }),
  z
    .object({
      sketchId: sketchIdSchema,
      pointIds: z.array(sketchEntityIdSchema).min(1).max(256),
      diameter: lengthQuantitySchema.refine(({ value }) => value > 0 && value <= 1_000_000),
      direction: z.enum(["forward", "reverse"]),
      extent: z.literal("through-all"),
    })
    .strict()
    .superRefine((parameters, context) => {
      if (new Set(parameters.pointIds).size !== parameters.pointIds.length)
        context.addIssue({
          code: "custom",
          path: ["pointIds"],
          message: "Point IDs must be distinct.",
        })
    }),
])
const holeBodyParameters = z.discriminatedUnion("extent", [
  holeParameters.options[0].safeExtend({ targetBody: bodyReferenceSchema }),
  holeParameters.options[1].safeExtend({ targetBody: bodyReferenceSchema }),
])
const hole = z
  .object({
    ...feature,
    dependencies: featureRecordSchema.shape.dependencies.min(1).max(2),
    references: featureRecordSchema.shape.references.max(1),
    parameters: z.union([holeParameters, holeBodyParameters]),
  })
  .strict()

export const localCadInputs = {
  create_sketch: sketch,
  update_sketch: sketch,
  create_extrude: extrude,
  update_extrude: extrude,
  create_revolve: revolve,
  update_revolve: revolve,
  create_hole: hole,
  update_hole: hole,
} as const

export const localCadOperations = [
  z.object({ tool: z.literal("create_sketch"), arguments: sketch }).strict(),
  z.object({ tool: z.literal("update_sketch"), arguments: sketch }).strict(),
  z.object({ tool: z.literal("create_extrude"), arguments: extrude }).strict(),
  z.object({ tool: z.literal("update_extrude"), arguments: extrude }).strict(),
  z.object({ tool: z.literal("create_revolve"), arguments: revolve }).strict(),
  z.object({ tool: z.literal("update_revolve"), arguments: revolve }).strict(),
  z.object({ tool: z.literal("create_hole"), arguments: hole }).strict(),
  z.object({ tool: z.literal("update_hole"), arguments: hole }).strict(),
] as const
