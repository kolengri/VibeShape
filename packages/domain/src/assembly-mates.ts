import { z } from "zod"
import {
  type AssemblyRigidPose,
  assemblyDefinitionSchema,
  assemblyInstanceIdSchema,
  assemblyInstanceSchema,
  assemblyJointIdSchema,
  assemblyJointSchema,
  assemblyRigidPoseSchema,
  assemblySchema,
  MAX_ASSEMBLY_ANGLE_RADIANS,
  MAX_ASSEMBLY_COORDINATE_MM,
} from "./assembly"
import { bodyReferenceSchema } from "./body-reference"
import { topoRefSchema } from "./topology"

const finite = z.number().finite()
const coordinate = finite.min(-MAX_ASSEMBLY_COORDINATE_MM).max(MAX_ASSEMBLY_COORDINATE_MM)
const vector = z.tuple([coordinate, coordinate, coordinate])
const direction = z
  .tuple([finite, finite, finite])
  .refine(
    (value) => Number.isFinite(Math.hypot(...value)) && Math.hypot(...value) >= 1e-12,
    "Assembly frame directions require a finite norm of at least 1e-12.",
  )
  .transform((value) => {
    const magnitude = Math.hypot(...value),
      norm = Math.abs(magnitude - 1) <= 1e-15 ? 1 : magnitude
    const component = (v: number) => (v === 0 ? 0 : v / norm)
    return [component(value[0]), component(value[1]), component(value[2])] as [
      number,
      number,
      number,
    ]
  })
const limits = (bound: number) =>
  z
    .object({
      min: finite.min(-bound).max(bound),
      max: finite.min(-bound).max(bound),
    })
    .strict()
    .refine((value) => value.min <= value.max, "Joint limits must be ordered.")

/** The binding resolves only against its occurrence's immutable selected source. */
export const assemblyFrameBindingSchema = z
  .object({
    sourceIndex: z.number().int().min(0).max(255),
    pinRevision: z.number().int().positive().safe(),
    body: bodyReferenceSchema,
    reference: topoRefSchema,
    geometry: z.enum([
      "planar-face",
      "cylindrical-face",
      "spherical-face",
      "circular-edge",
      "vertex",
    ]),
    originHint: vector,
    xDirection: direction,
    reversed: z.boolean().default(false),
  })
  .strict()
export type AssemblyFrameBinding = z.infer<typeof assemblyFrameBindingSchema>

const occurrenceFields = assemblyInstanceSchema.options[0].shape
export const assemblyMateInstanceSchema = z.discriminatedUnion("grounded", [
  z.object({ ...occurrenceFields, schemaVersion: z.literal(2) }).strict(),
  z
    .object({
      schemaVersion: z.literal(2),
      id: assemblyInstanceIdSchema,
      definitionId: occurrenceFields.definitionId,
      name: occurrenceFields.name,
      grounded: z.literal(false),
      initialFrame: assemblyRigidPoseSchema,
    })
    .strict(),
])
export const assemblyInstanceRecordSchema = z.union([
  assemblyInstanceSchema,
  assemblyMateInstanceSchema,
])
export type AssemblyInstanceRecord = z.infer<typeof assemblyInstanceRecordSchema>

const fields = {
  schemaVersion: z.literal(2),
  id: assemblyJointIdSchema,
  parentInstanceId: assemblyInstanceIdSchema,
  childInstanceId: assemblyInstanceIdSchema,
  parentFrame: assemblyRigidPoseSchema,
  childFrame: assemblyRigidPoseSchema,
  parentBinding: assemblyFrameBindingSchema.optional(),
  childBinding: assemblyFrameBindingSchema.optional(),
}
const axial = { axis: direction }
export const assemblyMateJointSchema = z
  .discriminatedUnion("kind", [
    z.object({ ...fields, kind: z.literal("fixed") }).strict(),
    z
      .object({
        ...fields,
        ...axial,
        kind: z.literal("revolute"),
        value: finite.min(-MAX_ASSEMBLY_ANGLE_RADIANS).max(MAX_ASSEMBLY_ANGLE_RADIANS),
        limits: limits(MAX_ASSEMBLY_ANGLE_RADIANS),
        driven: z.boolean().default(true),
      })
      .strict(),
    z
      .object({
        ...fields,
        ...axial,
        kind: z.literal("prismatic"),
        value: coordinate,
        limits: limits(MAX_ASSEMBLY_COORDINATE_MM),
        driven: z.boolean().default(true),
      })
      .strict(),
    z
      .object({
        ...fields,
        ...axial,
        kind: z.literal("cylindrical"),
        angle: finite.min(-MAX_ASSEMBLY_ANGLE_RADIANS).max(MAX_ASSEMBLY_ANGLE_RADIANS),
        angleLimits: limits(MAX_ASSEMBLY_ANGLE_RADIANS),
        rotationDriven: z.boolean().default(false),
        translation: coordinate,
        translationLimits: limits(MAX_ASSEMBLY_COORDINATE_MM),
        translationDriven: z.boolean().default(false),
      })
      .strict(),
    z.object({ ...fields, kind: z.literal("ball") }).strict(),
  ])
  .superRefine((joint, context) => {
    if (joint.parentInstanceId === joint.childInstanceId)
      context.addIssue({ code: "custom", message: "A mate must connect distinct occurrences." })
    const drives =
      joint.kind === "revolute" || joint.kind === "prismatic"
        ? [[joint.value, joint.limits] as const]
        : joint.kind === "cylindrical"
          ? ([
              [joint.angle, joint.angleLimits],
              [joint.translation, joint.translationLimits],
            ] as const)
          : []
    if (drives.some(([value, bound]) => value < bound.min || value > bound.max))
      context.addIssue({
        code: "custom",
        message: "A mate coordinate must remain within its closed limits.",
      })
  })
export type AssemblyMateJoint = z.infer<typeof assemblyMateJointSchema>
export const assemblyJointRecordSchema = z.union([assemblyJointSchema, assemblyMateJointSchema])
export type AssemblyJointRecord = z.infer<typeof assemblyJointRecordSchema>

export const assemblyMateGraphSchema = z
  .object({
    schemaVersion: z.literal(2),
    definitions: z.array(assemblyDefinitionSchema).max(256),
    instances: z.array(assemblyMateInstanceSchema).max(256),
    joints: z.array(assemblyMateJointSchema).max(1024),
  })
  .strict()
  .superRefine((assembly, context) => {
    const identities = [...assembly.definitions, ...assembly.instances, ...assembly.joints].map(
      ({ id }) => id,
    )
    const definitions = new Set(assembly.definitions.map(({ id }) => id))
    const instances = new Set(assembly.instances.map(({ id }) => id))
    if (new Set(identities).size !== identities.length)
      context.addIssue({
        code: "custom",
        message: "Assembly identities must be unique across collections.",
      })
    if (assembly.instances.some(({ definitionId }) => !definitions.has(definitionId)))
      context.addIssue({
        code: "custom",
        message: "An occurrence references a missing definition.",
      })
    if (
      assembly.joints.some(
        (joint) => !instances.has(joint.parentInstanceId) || !instances.has(joint.childInstanceId),
      )
    )
      context.addIssue({ code: "custom", message: "A mate references a missing occurrence." })
    if (assembly.definitions.reduce((n, d) => n + d.sources.length, 0) > 4096)
      context.addIssue({
        code: "custom",
        message: "Assembly source bindings exceed the document budget.",
      })
    const sources = new Set<string>(
      assembly.definitions.flatMap(({ sources }) =>
        sources.map((source) => (source.kind === "part" ? source.partId : source.outputId)),
      ),
    )
    if ([...assembly.definitions, ...assembly.instances].some(({ id }) => sources.has(id)))
      context.addIssue({
        code: "custom",
        message: "Assembly records require identities separate from selected sources.",
      })
  })
export type AssemblyMateGraph = z.infer<typeof assemblyMateGraphSchema>
export const assemblyCollectionSchema = z.discriminatedUnion("schemaVersion", [
  assemblySchema,
  assemblyMateGraphSchema,
])

export type AssemblyConstraintDiagnosticCode =
  | "invalid-assembly"
  | "unanchored-component"
  | "topology-missing"
  | "topology-ambiguous"
  | "topology-stale"
  | "unsupported-topology"
  | "conflicting-mates"
  | "did-not-converge"
  | "solver-budget"
  | "drive-limit"
  | "world-bounds"
  | "invalid-solver-result"
export type AssemblyConstraintSolveResult =
  | {
      ok: true
      status: "fully-constrained" | "under-constrained"
      degreesOfFreedom: number
      maximumResidual: number
      redundant: boolean
      redundantJointIds: readonly string[]
      instances: readonly {
        instanceId: AssemblyInstanceRecord["id"]
        definitionId: AssemblyInstanceRecord["definitionId"]
        worldFrame: AssemblyRigidPose
        geometryFrame: AssemblyRigidPose
      }[]
    }
  | {
      ok: false
      code: AssemblyConstraintDiagnosticCode
      message: string
      jointIds: readonly string[]
    }
export type AssemblyConstraintSolvePort = (
  assembly: AssemblyMateGraph,
) => AssemblyConstraintSolveResult | Promise<AssemblyConstraintSolveResult>
