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
  extrusionFeatureParametersV5Schema,
  revolveFeatureParametersSchema,
  revolveFeatureParametersV5Schema,
  revolveFeatureParametersV6Schema,
} from "@vibeshape/domain/part-design"
import { loftFeatureParametersSchema } from "@vibeshape/domain/part-design-loft"
import { mirrorFeatureParametersSchema } from "@vibeshape/domain/part-design-mirror"
import { patternFeatureParametersSchema } from "@vibeshape/domain/part-design-pattern"
import { shellFeatureParametersSchema } from "@vibeshape/domain/part-design-shell"
import { splitFeatureParametersSchema } from "@vibeshape/domain/part-design-split"
import { sweepFeatureParametersSchema } from "@vibeshape/domain/part-design-sweep"
import { threadFeatureParametersSchema } from "@vibeshape/domain/part-design-thread"
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
      extrusionFeatureParametersV5Schema,
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

const exactBodyFeature = {
  ...feature,
  dependencies: featureRecordSchema.shape.dependencies.length(1),
  references: featureRecordSchema.shape.references.max(0),
}
function matchingBodyDependency(operation: string) {
  return (
    input: { dependencies: readonly string[]; parameters: { targetBody: { featureId: string } } },
    context: z.RefinementCtx,
  ) => {
    if (input.parameters.targetBody.featureId !== input.dependencies[0])
      context.addIssue({
        code: "custom",
        path: ["parameters", "targetBody", "featureId"],
        message: `${operation} must target its sole dependency.`,
      })
  }
}
const mirror = z
  .object({ ...exactBodyFeature, parameters: mirrorFeatureParametersSchema })
  .strict()
  .superRefine(matchingBodyDependency("Mirror"))
const shell = z
  .object({ ...exactBodyFeature, parameters: shellFeatureParametersSchema })
  .strict()
  .superRefine(matchingBodyDependency("Shell"))
const split = z
  .object({ ...exactBodyFeature, parameters: splitFeatureParametersSchema })
  .strict()
  .superRefine(matchingBodyDependency("Split"))

const bodyPattern = z
  .object({ ...exactBodyFeature, parameters: patternFeatureParametersSchema })
  .strict()
  .superRefine(matchingBodyDependency("Pattern"))

const thread = z
  .object({ ...exactBodyFeature, parameters: threadFeatureParametersSchema })
  .strict()
  .superRefine(matchingBodyDependency("Thread"))

const multiSketchFeature = {
  ...feature,
  dependencies: featureRecordSchema.shape.dependencies.max(8),
  references: featureRecordSchema.shape.references.max(4096),
}
const loft = z.object({ ...multiSketchFeature, parameters: loftFeatureParametersSchema }).strict()
const sweep = z.object({ ...multiSketchFeature, parameters: sweepFeatureParametersSchema }).strict()

export const localCadInputs = {
  create_sketch: sketch,
  update_sketch: sketch,
  create_extrude: extrude,
  update_extrude: extrude,
  create_revolve: revolve,
  update_revolve: revolve,
  create_hole: hole,
  update_hole: hole,
  create_mirror: mirror,
  update_mirror: mirror,
  create_shell: shell,
  update_shell: shell,
  create_thread: thread,
  update_thread: thread,
  create_body_pattern: bodyPattern,
  update_body_pattern: bodyPattern,
  create_split: split,
  update_split: split,
  create_loft: loft,
  update_loft: loft,
  create_sweep: sweep,
  update_sweep: sweep,
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
  z.object({ tool: z.literal("create_mirror"), arguments: mirror }).strict(),
  z.object({ tool: z.literal("update_mirror"), arguments: mirror }).strict(),
  z.object({ tool: z.literal("create_shell"), arguments: shell }).strict(),
  z.object({ tool: z.literal("update_shell"), arguments: shell }).strict(),
  z.object({ tool: z.literal("create_thread"), arguments: thread }).strict(),
  z.object({ tool: z.literal("update_thread"), arguments: thread }).strict(),
  z.object({ tool: z.literal("create_body_pattern"), arguments: bodyPattern }).strict(),
  z.object({ tool: z.literal("update_body_pattern"), arguments: bodyPattern }).strict(),
  z.object({ tool: z.literal("create_split"), arguments: split }).strict(),
  z.object({ tool: z.literal("update_split"), arguments: split }).strict(),
  z.object({ tool: z.literal("create_loft"), arguments: loft }).strict(),
  z.object({ tool: z.literal("update_loft"), arguments: loft }).strict(),
  z.object({ tool: z.literal("create_sweep"), arguments: sweep }).strict(),
  z.object({ tool: z.literal("update_sweep"), arguments: sweep }).strict(),
] as const
