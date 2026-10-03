import type { ZodError } from "zod"
import {
  type Assembly,
  type AssemblyDefinition,
  type AssemblyDefinitionId,
  type AssemblyDiagnosticCode,
  type AssemblyInstance,
  type AssemblyInstanceId,
  type AssemblyJoint,
  type AssemblyQuaternion,
  type AssemblyRigidPose,
  type AssemblyVector3,
  assemblyDiagnosticCodeSchema,
  assemblyRigidPoseSchema,
  assemblySchema,
  MAX_ASSEMBLY_COORDINATE_MM,
} from "./assembly"

export type AssemblyOccurrencePose = Readonly<{
  instanceId: AssemblyInstanceId
  definitionId: AssemblyDefinitionId
  worldFrame: AssemblyRigidPose
  geometryFrame: AssemblyRigidPose
}>
export type AssemblyKinematicsResult =
  | Readonly<{
      ok: true
      instances: readonly AssemblyOccurrencePose[]
      evaluationOrder: readonly AssemblyInstanceId[]
    }>
  | Readonly<{
      ok: false
      diagnostic: Readonly<{
        code: AssemblyDiagnosticCode
        message: string
        issues: readonly Readonly<{ path: string; message: string }>[]
      }>
    }>
type AssemblyKinematicsFailure = Extract<AssemblyKinematicsResult, { ok: false }>
type EvaluationEntry = Readonly<{ id: AssemblyInstanceId; frame: AssemblyRigidPose }>

const identity: AssemblyRigidPose = { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] }
const WORLD_BOUND_ROUNDOFF_MM = 1e-9
function multiplyQuaternion(
  left: AssemblyQuaternion,
  right: AssemblyQuaternion,
): [number, number, number, number] {
  const [x, y, z, w] = left
  const [a, b, c, d] = right
  return [
    w * a + x * d + y * c - z * b,
    w * b - x * c + y * d + z * a,
    w * c + x * b - y * a + z * d,
    w * d - x * a - y * b - z * c,
  ]
}
function rotate(vector: AssemblyVector3, quaternion: AssemblyQuaternion): [number, number, number] {
  const [x, y, z, w] = quaternion
  const [a, b, c] = vector
  const tx = 2 * (y * c - z * b)
  const ty = 2 * (z * a - x * c)
  const tz = 2 * (x * b - y * a)
  return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx]
}
function compose(left: AssemblyRigidPose, right: AssemblyRigidPose): AssemblyRigidPose {
  const translated = rotate(right.translation, left.quaternion)
  const quaternion = multiplyQuaternion(left.quaternion, right.quaternion)
  const norm = Math.hypot(...quaternion)
  return {
    translation: [
      left.translation[0] + translated[0],
      left.translation[1] + translated[1],
      left.translation[2] + translated[2],
    ],
    quaternion: [
      quaternion[0] / norm,
      quaternion[1] / norm,
      quaternion[2] / norm,
      quaternion[3] / norm,
    ],
  }
}
function inverse(pose: AssemblyRigidPose): AssemblyRigidPose {
  const [x, y, z, w] = pose.quaternion
  const quaternion: AssemblyQuaternion = [-x, -y, -z, w]
  return {
    translation: rotate(
      [-pose.translation[0], -pose.translation[1], -pose.translation[2]],
      quaternion,
    ),
    quaternion,
  }
}
function jointDrive(joint: AssemblyJoint): AssemblyRigidPose {
  if (joint.kind === "fixed") return identity
  const [x, y, z] = joint.axis
  if (joint.kind === "prismatic")
    return {
      translation: [x * joint.value, y * joint.value, z * joint.value],
      quaternion: identity.quaternion,
    }
  const sine = Math.sin(joint.value / 2)
  return {
    translation: identity.translation,
    quaternion: [x * sine, y * sine, z * sine, Math.cos(joint.value / 2)],
  }
}
function childPose(parent: AssemblyRigidPose, joint: AssemblyJoint) {
  return compose(
    compose(compose(parent, joint.parentFrame), jointDrive(joint)),
    inverse(joint.childFrame),
  )
}
function schemaFailure(error: ZodError): AssemblyKinematicsResult {
  const first = error.issues[0]
  const code = assemblyDiagnosticCodeSchema.safeParse(
    first?.code === "custom" ? first.params?.assemblyCode : undefined,
  )
  return {
    ok: false,
    diagnostic: {
      code: code.success ? code.data : "invalid-assembly",
      message: first?.message ?? "The assembly is invalid.",
      issues: error.issues
        .slice(0, 16)
        .map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
    },
  }
}
function boundedPose(
  pose: AssemblyRigidPose,
  instanceId: AssemblyInstanceId,
  field: string,
): AssemblyRigidPose | AssemblyKinematicsFailure {
  const parsed = assemblyRigidPoseSchema.safeParse({
    ...pose,
    translation: pose.translation.map((value) => {
      const magnitude = Math.abs(value)
      if (
        magnitude > MAX_ASSEMBLY_COORDINATE_MM &&
        magnitude - MAX_ASSEMBLY_COORDINATE_MM <= WORLD_BOUND_ROUNDOFF_MM
      )
        return Math.sign(value) * MAX_ASSEMBLY_COORDINATE_MM
      return value
    }),
  })
  if (parsed.success) return parsed.data
  return {
    ok: false,
    diagnostic: {
      code: "world-bounds",
      message: "A composed assembly frame exceeds its finite world coordinate budget.",
      issues: [
        {
          path: `instances.${instanceId}.${field}`,
          message: `World frame origins must remain within +/-${MAX_ASSEMBLY_COORDINATE_MM} mm.`,
        },
      ],
    },
  }
}
function evaluationForest(assembly: Assembly) {
  const children = new Map<AssemblyInstanceId, AssemblyJoint[]>()
  for (const joint of assembly.joints) {
    const entries = children.get(joint.parentInstanceId) ?? []
    entries.push(joint)
    children.set(joint.parentInstanceId, entries)
  }
  for (const entries of children.values())
    entries.sort((a, b) => compareIds(a.childInstanceId, b.childInstanceId))
  const queue: EvaluationEntry[] = assembly.instances
    .filter((instance) => instance.grounded)
    .sort((a, b) => compareIds(a.id, b.id))
    .map((instance) => ({ id: instance.id, frame: instance.worldFrame }))
  return { queue, children }
}
function evaluateOccurrence(
  entry: EvaluationEntry,
  instances: ReadonlyMap<AssemblyInstanceId, AssemblyInstance>,
  definitions: ReadonlyMap<AssemblyDefinitionId, AssemblyDefinition>,
): AssemblyOccurrencePose | AssemblyKinematicsFailure {
  const instance = instances.get(entry.id)
  const definition = instance && definitions.get(instance.definitionId)
  if (!instance || !definition)
    throw new Error("Validated assembly identities must remain available.")
  const worldFrame = boundedPose(entry.frame, entry.id, "worldFrame")
  if ("ok" in worldFrame) return worldFrame
  const geometryFrame = boundedPose(
    compose(worldFrame, inverse(definition.sourceFrame)),
    entry.id,
    "geometryFrame",
  )
  if ("ok" in geometryFrame) return geometryFrame
  return { instanceId: entry.id, definitionId: definition.id, worldFrame, geometryFrame }
}
function solveValidated(assembly: Assembly): AssemblyKinematicsResult {
  const definitions = new Map(assembly.definitions.map((definition) => [definition.id, definition]))
  const instances = new Map(assembly.instances.map((instance) => [instance.id, instance]))
  const { queue, children } = evaluationForest(assembly)
  const poses = new Map<AssemblyInstanceId, AssemblyOccurrencePose>()
  const evaluationOrder: AssemblyInstanceId[] = []
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const entry = queue[cursor]
    if (!entry) continue
    const pose = evaluateOccurrence(entry, instances, definitions)
    if ("ok" in pose) return pose
    poses.set(entry.id, pose)
    evaluationOrder.push(entry.id)
    for (const joint of children.get(entry.id) ?? [])
      queue.push({ id: joint.childInstanceId, frame: childPose(pose.worldFrame, joint) })
  }
  return {
    ok: true,
    instances: [...poses.values()].sort((a, b) => compareIds(a.instanceId, b.instanceId)),
    evaluationOrder,
  }
}

function compareIds(left: string, right: string) {
  return left < right ? -1 : Number(left > right)
}

/** Solves a static grounded forest; source availability and native geometry extents are separate. */
export function solveAssemblyKinematics(raw: unknown): AssemblyKinematicsResult {
  const parsed = assemblySchema.safeParse(raw)
  return parsed.success ? solveValidated(parsed.data) : schemaFailure(parsed.error)
}
