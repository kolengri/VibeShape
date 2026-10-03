import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import { partIdSchema } from "./identifiers"
import { authoredItemNameSchema } from "./parts"
import {
  sourceAssetDigestSchema,
  sourceAssetIdSchema,
  sourceAssetOutputIdSchema,
} from "./source-assets"

export const MAX_ASSEMBLY_DEFINITIONS = 256
export const MAX_ASSEMBLY_INSTANCES = 256
export const MAX_ASSEMBLY_JOINTS = 255
export const MAX_ASSEMBLY_SOURCES_PER_DEFINITION = 256
export const MAX_ASSEMBLY_SOURCE_BINDINGS = 4_096
export const MAX_ASSEMBLY_COORDINATE_MM = 100_000
export const MAX_ASSEMBLY_ANGLE_RADIANS = 2 * Math.PI
const MIN_DIRECTION_NORM = 1e-12
const UNIT_NORM_TOLERANCE = 1e-15
const uuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Assembly identities must be lowercase UUIDv7 values.",
  )
export const assemblyDefinitionIdSchema = uuidV7Schema.brand<"AssemblyDefinitionId">()
export const assemblyInstanceIdSchema = uuidV7Schema.brand<"AssemblyInstanceId">()
export const assemblyJointIdSchema = uuidV7Schema.brand<"AssemblyJointId">()
export type AssemblyDefinitionId = z.infer<typeof assemblyDefinitionIdSchema>
export type AssemblyInstanceId = z.infer<typeof assemblyInstanceIdSchema>
export type AssemblyJointId = z.infer<typeof assemblyJointIdSchema>
export type AssemblyVector3 = readonly [number, number, number]
export type AssemblyQuaternion = readonly [number, number, number, number]

const finite = z.number().finite()
const coordinate = finite
  .min(-MAX_ASSEMBLY_COORDINATE_MM)
  .max(MAX_ASSEMBLY_COORDINATE_MM)
  .transform((value) => (value === 0 ? 0 : value))
const translationSchema = z.tuple([coordinate, coordinate, coordinate])
function validateDirection(values: readonly number[], context: z.RefinementCtx) {
  const norm = Math.hypot(...values)
  if (!Number.isFinite(norm) || norm < MIN_DIRECTION_NORM)
    context.addIssue({
      code: "custom",
      message: "A direction must have a finite norm of at least 1e-12.",
    })
}
function canonicalQuaternion(
  value: readonly [number, number, number, number],
): [number, number, number, number] {
  const norm = normalizationNorm(value)
  const normalized = value.map((number) => number / norm)
  const leading =
    [normalized[3], normalized[0], normalized[1], normalized[2]].find(
      (component) => component !== 0,
    ) ?? 1
  const sign = leading < 0 ? -1 : 1
  const component = (number: number) => {
    const canonical = (number / norm) * sign
    return canonical === 0 ? 0 : canonical
  }
  return [component(value[0]), component(value[1]), component(value[2]), component(value[3])]
}
function normalizationNorm(value: readonly number[]) {
  const norm = Math.hypot(...value)
  // Preserve an already normalized value so repeated schema reads do not drift.
  return Math.abs(norm - 1) <= UNIT_NORM_TOLERANCE ? 1 : norm
}
const quaternionSchema = z
  .tuple([finite, finite, finite, finite])
  .superRefine(validateDirection)
  .transform(canonicalQuaternion)
const axisSchema = z
  .tuple([finite, finite, finite])
  .superRefine(validateDirection)
  .transform((axis): [number, number, number] => {
    const norm = normalizationNorm(axis)
    const component = (value: number) => {
      const normalized = value / norm
      return normalized === 0 ? 0 : normalized
    }
    return [component(axis[0]), component(axis[1]), component(axis[2])]
  })

/** Right-handed active rotation, quaternion order XYZW, translation in millimeters. */
export const assemblyRigidPoseSchema = z
  .object({ translation: translationSchema, quaternion: quaternionSchema })
  .strict()
export type AssemblyRigidPose = Readonly<{
  translation: AssemblyVector3
  quaternion: AssemblyQuaternion
}>

export const assemblySourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("part"),
      partId: partIdSchema,
      body: bodyReferenceSchema,
      contentHash: sourceAssetDigestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("asset-output"),
      assetId: sourceAssetIdSchema,
      outputId: sourceAssetOutputIdSchema,
      digest: sourceAssetDigestSchema,
    })
    .strict(),
])
export type AssemblySource = Readonly<z.infer<typeof assemblySourceSchema>>
function sourceKey(source: AssemblySource) {
  return source.kind === "part" ? `part:${source.partId}` : `asset-output:${source.outputId}`
}
export const assemblyDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: assemblyDefinitionIdSchema,
    name: authoredItemNameSchema,
    sources: z.array(assemblySourceSchema).min(1).max(MAX_ASSEMBLY_SOURCES_PER_DEFINITION),
    sourceFrame: assemblyRigidPoseSchema,
  })
  .strict()
  .superRefine((definition, context) => {
    if (new Set(definition.sources.map(sourceKey)).size !== definition.sources.length)
      issue(context, "duplicate-source", "A definition must select each source identity once.", [
        "sources",
      ])
  })
export type AssemblyDefinition = Readonly<
  Omit<z.infer<typeof assemblyDefinitionSchema>, "sources" | "sourceFrame"> & {
    sources: readonly AssemblySource[]
    sourceFrame: AssemblyRigidPose
  }
>

const instanceFields = {
  schemaVersion: z.literal(1),
  id: assemblyInstanceIdSchema,
  definitionId: assemblyDefinitionIdSchema,
  name: authoredItemNameSchema,
}
export const assemblyInstanceSchema = z.discriminatedUnion("grounded", [
  z
    .object({ ...instanceFields, grounded: z.literal(true), worldFrame: assemblyRigidPoseSchema })
    .strict(),
  z.object({ ...instanceFields, grounded: z.literal(false) }).strict(),
])
export type AssemblyInstance = Readonly<z.infer<typeof assemblyInstanceSchema>>

const jointFields = {
  schemaVersion: z.literal(1),
  id: assemblyJointIdSchema,
  parentInstanceId: assemblyInstanceIdSchema,
  childInstanceId: assemblyInstanceIdSchema,
  parentFrame: assemblyRigidPoseSchema,
  childFrame: assemblyRigidPoseSchema,
}
function limitsSchema(bound: number) {
  const value = finite.min(-bound).max(bound)
  return z
    .object({ min: value, max: value })
    .strict()
    .refine((limits) => limits.min <= limits.max, {
      path: ["max"],
      message: "Joint limits must be ordered.",
    })
}
export const assemblyJointSchema = z
  .discriminatedUnion("kind", [
    z.object({ ...jointFields, kind: z.literal("fixed") }).strict(),
    z
      .object({
        ...jointFields,
        kind: z.literal("revolute"),
        axis: axisSchema,
        value: finite.min(-MAX_ASSEMBLY_ANGLE_RADIANS).max(MAX_ASSEMBLY_ANGLE_RADIANS),
        limits: limitsSchema(MAX_ASSEMBLY_ANGLE_RADIANS),
      })
      .strict(),
    z
      .object({
        ...jointFields,
        kind: z.literal("prismatic"),
        axis: axisSchema,
        value: coordinate,
        limits: limitsSchema(MAX_ASSEMBLY_COORDINATE_MM),
      })
      .strict(),
  ])
  .superRefine((joint, context) => {
    if (joint.parentInstanceId === joint.childInstanceId)
      issue(context, "self-joint", "A joint must connect distinct occurrences.", [
        "childInstanceId",
      ])
    if (
      joint.kind !== "fixed" &&
      (joint.value < joint.limits.min || joint.value > joint.limits.max)
    )
      issue(context, "drive-limit", "The joint drive must remain within its closed limits.", [
        "value",
      ])
  })
export type AssemblyJoint = Readonly<z.infer<typeof assemblyJointSchema>>

export const assemblyDiagnosticCodeSchema = z.enum([
  "invalid-assembly",
  "duplicate-id",
  "duplicate-source",
  "identity-reuse",
  "missing-definition",
  "missing-instance",
  "self-joint",
  "multiple-parents",
  "grounded-child",
  "ungrounded-root",
  "cycle",
  "drive-limit",
  "source-budget",
  "world-bounds",
])
export type AssemblyDiagnosticCode = z.infer<typeof assemblyDiagnosticCodeSchema>
function issue(
  context: z.RefinementCtx,
  code: AssemblyDiagnosticCode,
  message: string,
  path: (string | number)[],
) {
  context.addIssue({ code: "custom", params: { assemblyCode: code }, message, path })
}
type AssemblyFields = {
  definitions: readonly AssemblyDefinition[]
  instances: readonly AssemblyInstance[]
  joints: readonly AssemblyJoint[]
}
function uniqueIds(records: readonly { id: string }[], path: string, context: z.RefinementCtx) {
  const seen = new Set<string>()
  for (const [index, record] of records.entries()) {
    if (seen.has(record.id))
      issue(
        context,
        "duplicate-id",
        "Assembly identities must be unique within their collection.",
        [path, index, "id"],
      )
    seen.add(record.id)
  }
  return seen
}
function validateInstances(
  assembly: AssemblyFields,
  definitions: ReadonlySet<string>,
  context: z.RefinementCtx,
) {
  const sourceIds = new Set<string>(
    assembly.definitions.flatMap((definition) =>
      definition.sources.map((source) =>
        source.kind === "part" ? source.partId : source.outputId,
      ),
    ),
  )
  for (const [index, definition] of assembly.definitions.entries()) {
    if (sourceIds.has(definition.id))
      issue(
        context,
        "identity-reuse",
        "A definition needs its own identity, separate from its source.",
        ["definitions", index, "id"],
      )
  }
  for (const [index, instance] of assembly.instances.entries()) {
    if (!definitions.has(instance.definitionId))
      issue(context, "missing-definition", "An occurrence references a missing definition.", [
        "instances",
        index,
        "definitionId",
      ])
    if (sourceIds.has(instance.id))
      issue(
        context,
        "identity-reuse",
        "An occurrence needs its own identity, separate from its source.",
        ["instances", index, "id"],
      )
  }
}
function jointParents(
  assembly: AssemblyFields,
  instances: ReadonlySet<string>,
  context: z.RefinementCtx,
) {
  const parents = new Map<string, string>()
  for (const [index, joint] of assembly.joints.entries()) {
    if (!instances.has(joint.parentInstanceId) || !instances.has(joint.childInstanceId)) {
      issue(context, "missing-instance", "A joint references a missing occurrence.", [
        "joints",
        index,
      ])
      continue
    }
    if (parents.has(joint.childInstanceId))
      issue(
        context,
        "multiple-parents",
        "An occurrence cannot have multiple incoming joints or redundant constraints.",
        ["joints", index, "childInstanceId"],
      )
    parents.set(joint.childInstanceId, joint.parentInstanceId)
  }
  return parents
}
function hasCycle(parents: ReadonlyMap<string, string>) {
  const active = new Set<string>()
  const completed = new Set<string>()
  const visit = (id: string): boolean => {
    if (completed.has(id)) return false
    if (active.has(id)) return true
    active.add(id)
    const parent = parents.get(id)
    const cycle = parent !== undefined && visit(parent)
    active.delete(id)
    completed.add(id)
    return cycle
  }
  return [...parents.keys()].some(visit)
}
function validateGroundedForest(
  assembly: AssemblyFields,
  instances: ReadonlySet<string>,
  context: z.RefinementCtx,
) {
  const parents = jointParents(assembly, instances, context)
  for (const [index, instance] of assembly.instances.entries()) {
    if (instance.grounded && parents.has(instance.id))
      issue(
        context,
        "grounded-child",
        "A grounded occurrence cannot also have an incoming joint.",
        ["instances", index, "grounded"],
      )
    if (!instance.grounded && !parents.has(instance.id))
      issue(
        context,
        "ungrounded-root",
        "Every forest root must be grounded; floating occurrences are unsupported.",
        ["instances", index, "grounded"],
      )
  }
  if (hasCycle(parents))
    issue(context, "cycle", "Assembly joints must form an acyclic directed forest.", ["joints"])
}

export const assemblySchema = z
  .object({
    schemaVersion: z.literal(1),
    definitions: z.array(assemblyDefinitionSchema).max(MAX_ASSEMBLY_DEFINITIONS),
    instances: z.array(assemblyInstanceSchema).max(MAX_ASSEMBLY_INSTANCES),
    joints: z.array(assemblyJointSchema).max(MAX_ASSEMBLY_JOINTS),
  })
  .strict()
  .superRefine((assembly, context) => {
    const definitions = uniqueIds(assembly.definitions, "definitions", context)
    const instances = uniqueIds(assembly.instances, "instances", context)
    uniqueIds(assembly.joints, "joints", context)
    if (
      assembly.definitions.reduce((count, definition) => count + definition.sources.length, 0) >
      MAX_ASSEMBLY_SOURCE_BINDINGS
    )
      issue(context, "source-budget", "Assembly source bindings exceed the document budget.", [
        "definitions",
      ])
    validateInstances(assembly, definitions, context)
    validateGroundedForest(assembly, instances, context)
  })
export type Assembly = Readonly<AssemblyFields & { schemaVersion: 1 }>
