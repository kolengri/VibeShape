import { datumPlaneParametersSchema } from "@vibeshape/domain"
import { type BodyReference, bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
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
  booleanFeatureParametersSchema,
  extrusionFeatureParametersSchema,
  extrusionFeatureParametersV3Schema,
  extrusionFeatureParametersV4Schema,
  extrusionFeatureParametersV5Schema,
  revolveFeatureParametersSchema,
  revolveFeatureParametersV5Schema,
  revolveFeatureParametersV6Schema,
} from "@vibeshape/domain/part-design"
import {
  compoundFeatureParametersV2Schema,
  unionFeatureParametersV2Schema,
} from "@vibeshape/domain/part-design-body-combination"
import {
  loftFeatureParametersSchema,
  loftFeatureParametersV2Schema,
  MAX_LOFT_SECTIONS,
} from "@vibeshape/domain/part-design-loft"
import {
  loftFeatureParametersV3Schema,
  MAX_LOFT_V3_DEPENDENCIES,
} from "@vibeshape/domain/part-design-loft-v3"
import {
  mirrorFeatureParametersSchema,
  mirrorFeatureParametersV2Schema,
  mirrorFeatureParametersV3Schema,
} from "@vibeshape/domain/part-design-mirror"
import {
  patternFeatureParametersSchema,
  patternFeatureParametersV2Schema,
} from "@vibeshape/domain/part-design-pattern"
import { shellFeatureParametersV2Schema } from "@vibeshape/domain/part-design-shell"
import {
  splitFeatureParametersSchema,
  splitFeatureParametersV2Schema,
} from "@vibeshape/domain/part-design-split"
import { sweepFeatureParametersSchema } from "@vibeshape/domain/part-design-sweep"
import { threadFeatureParametersSchema } from "@vibeshape/domain/part-design-thread"
import {
  type ReferenceAxis,
  type ReferencePlane,
  referenceFrameDependencyIds,
} from "@vibeshape/domain/reference-frame"
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
  .object({
    ...exactBodyFeature,
    parameters: z.union([mirrorFeatureParametersSchema, mirrorFeatureParametersV2Schema]),
  })
  .strict()
  .superRefine(matchingBodyDependency("Mirror"))
const shell = z
  .object({ ...exactBodyFeature, parameters: shellFeatureParametersV2Schema })
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

const referenceBodyFeature = {
  ...feature,
  dependencies: featureRecordSchema.shape.dependencies.min(1).max(2),
  references: featureRecordSchema.shape.references.max(0),
}
function matchingReferenceDependencies(
  input: { featureId: BodyReference["featureId"]; dependencies: readonly string[] },
  targetBody: BodyReference,
  support: ReferencePlane | ReferenceAxis,
  context: z.RefinementCtx,
) {
  const owners = referenceFrameDependencyIds(targetBody.featureId, support)
  if (
    owners.includes(input.featureId) ||
    owners.length !== input.dependencies.length ||
    owners.some((owner, index) => owner !== input.dependencies[index])
  )
    context.addIssue({
      code: "custom",
      path: ["dependencies"],
      message:
        "Reference-frame features require the target followed by its distinct support owner, with no self-dependency.",
    })
}
const referenceMirror = z
  .object({ ...referenceBodyFeature, parameters: mirrorFeatureParametersV3Schema })
  .strict()
  .superRefine((input, context) =>
    matchingReferenceDependencies(
      input,
      input.parameters.targetBody,
      input.parameters.plane,
      context,
    ),
  )
const referenceSplit = z
  .object({ ...referenceBodyFeature, parameters: splitFeatureParametersV2Schema })
  .strict()
  .superRefine((input, context) =>
    matchingReferenceDependencies(
      input,
      input.parameters.targetBody,
      input.parameters.plane,
      context,
    ),
  )
const referenceBodyPattern = z
  .object({ ...referenceBodyFeature, parameters: patternFeatureParametersV2Schema })
  .strict()
  .superRefine((input, context) =>
    matchingReferenceDependencies(
      input,
      input.parameters.targetBody,
      input.parameters.axis,
      context,
    ),
  )

const thread = z
  .object({ ...exactBodyFeature, parameters: threadFeatureParametersSchema })
  .strict()
  .superRefine(matchingBodyDependency("Thread"))

const multiSketchFeature = {
  ...feature,
  dependencies: featureRecordSchema.shape.dependencies.max(8),
  references: featureRecordSchema.shape.references.max(4096),
}
const loft = z
  .object({
    ...multiSketchFeature,
    dependencies: featureRecordSchema.shape.dependencies.max(MAX_LOFT_V3_DEPENDENCIES),
    parameters: z.union([
      loftFeatureParametersSchema,
      loftFeatureParametersV2Schema,
      loftFeatureParametersV3Schema,
    ]),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      !("outerCorrespondence" in input.parameters) &&
      input.dependencies.length > MAX_LOFT_SECTIONS
    )
      context.addIssue({
        code: "custom",
        path: ["dependencies"],
        message: "Loft v1/v2 permits at most twenty-four producers.",
      })
  })
const sweep = z.object({ ...multiSketchFeature, parameters: sweepFeatureParametersSchema }).strict()

const datumPlane = z
  .object({
    ...feature,
    dependencies: featureRecordSchema.shape.dependencies.max(1),
    references: featureRecordSchema.shape.references.max(1),
    parameters: datumPlaneParametersSchema.extend({
      offset: lengthQuantitySchema.refine(({ value }) => Math.abs(value) <= 1_000_000),
    }),
  })
  .strict()
  .superRefine((input, context) => {
    const support = input.parameters.support
    const matches =
      support.kind === "origin-plane"
        ? input.dependencies.length === 0 && input.references.length === 0
        : input.dependencies.length === 1 &&
          support.reference.featureId !== input.featureId &&
          input.dependencies[0] === support.reference.featureId &&
          input.references.length === 1 &&
          canonicalJson(input.references[0]) === canonicalJson(support.reference)
    if (!matches)
      context.addIssue({
        code: "custom",
        path: ["dependencies"],
        message:
          "Datum Plane requires no inputs for origin support or exactly its face support owner and reference.",
      })
  })

const boolean = z
  .object({
    ...feature,
    dependencies: featureRecordSchema.shape.dependencies.length(2),
    references: featureRecordSchema.shape.references.max(0),
    parameters: booleanFeatureParametersSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.dependencies).size !== 2 || input.dependencies.includes(input.featureId))
      context.addIssue({
        code: "custom",
        path: ["dependencies"],
        message:
          "Boolean subtraction requires distinct target and tool dependencies in that order.",
      })
  })

const bodyCombinationFeature = {
  ...feature,
  dependencies: featureRecordSchema.shape.dependencies.min(1).max(8),
  references: featureRecordSchema.shape.references.max(0),
}
function matchingSelectedDependencies(
  featureId: BodyReference["featureId"],
  dependencies: readonly string[],
  bodies: readonly BodyReference[],
  context: z.RefinementCtx,
) {
  const owners = [...new Set(bodies.map(({ featureId }) => featureId))]
  if (
    owners.length !== dependencies.length ||
    owners.includes(featureId) ||
    owners.some((owner, index) => owner !== dependencies[index])
  )
    context.addIssue({
      code: "custom",
      path: ["dependencies"],
      message:
        "Body combinations must declare each selected producer once in first-occurrence order.",
    })
}
const union = z
  .object({ ...bodyCombinationFeature, parameters: unionFeatureParametersV2Schema })
  .strict()
  .superRefine((input, context) =>
    matchingSelectedDependencies(
      input.featureId,
      input.dependencies,
      input.parameters.bodies,
      context,
    ),
  )
const compound = z
  .object({ ...bodyCombinationFeature, parameters: compoundFeatureParametersV2Schema })
  .strict()
  .superRefine((input, context) =>
    matchingSelectedDependencies(
      input.featureId,
      input.dependencies,
      input.parameters.slots.map(({ targetBody }) => targetBody),
      context,
    ),
  )

export const localCadInputs = {
  create_reference_body_pattern: referenceBodyPattern,
  update_reference_body_pattern: referenceBodyPattern,
  create_reference_split: referenceSplit,
  update_reference_split: referenceSplit,
  create_reference_mirror: referenceMirror,
  update_reference_mirror: referenceMirror,
  create_datum_plane: datumPlane,
  update_datum_plane: datumPlane,
  create_boolean: boolean,
  update_boolean: boolean,
  create_union: union,
  update_union: union,
  create_compound: compound,
  update_compound: compound,
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
  z
    .object({ tool: z.literal("create_reference_body_pattern"), arguments: referenceBodyPattern })
    .strict(),
  z
    .object({ tool: z.literal("update_reference_body_pattern"), arguments: referenceBodyPattern })
    .strict(),
  z.object({ tool: z.literal("create_reference_split"), arguments: referenceSplit }).strict(),
  z.object({ tool: z.literal("update_reference_split"), arguments: referenceSplit }).strict(),
  z.object({ tool: z.literal("create_reference_mirror"), arguments: referenceMirror }).strict(),
  z.object({ tool: z.literal("update_reference_mirror"), arguments: referenceMirror }).strict(),
  z.object({ tool: z.literal("create_datum_plane"), arguments: datumPlane }).strict(),
  z.object({ tool: z.literal("update_datum_plane"), arguments: datumPlane }).strict(),
  z.object({ tool: z.literal("create_boolean"), arguments: boolean }).strict(),
  z.object({ tool: z.literal("update_boolean"), arguments: boolean }).strict(),
  z.object({ tool: z.literal("create_union"), arguments: union }).strict(),
  z.object({ tool: z.literal("update_union"), arguments: union }).strict(),
  z.object({ tool: z.literal("create_compound"), arguments: compound }).strict(),
  z.object({ tool: z.literal("update_compound"), arguments: compound }).strict(),
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
