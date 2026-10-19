import { type AssemblyRigidPose, assemblyRigidPoseSchema } from "@vibeshape/domain/assembly"
import type { AssemblyAuthority, AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import {
  type AssemblyInstanceRecord,
  type AssemblyJointRecord,
  assemblyInstanceRecordSchema,
  assemblyJointRecordSchema,
} from "@vibeshape/domain/assembly-mates"
import { composeAssemblyPoses, invertAssemblyPose } from "@vibeshape/domain/assembly-poses"
import type { AssemblyInspection } from "@vibeshape/protocol"

export type AssemblyPoseCapture = Readonly<{
  documentKey: string
  poses: readonly Readonly<{
    instanceId: string
    definitionId: string
    pinRevision: number
    worldFrame: AssemblyRigidPose
  }>[]
}>
class AssemblyAsBuiltFailure extends Error {
  constructor(readonly code: "pose" | "selection" | "kind") {
    super(`Assembly pose capture failed: ${code}.`)
  }
}
function samePose(left: AssemblyRigidPose, right: AssemblyRigidPose) {
  const a = assemblyRigidPoseSchema.parse(left)
  const b = assemblyRigidPoseSchema.parse(right)
  return (
    a.translation.every((value, axis) => Math.abs(value - (b.translation[axis] ?? 0)) < 1e-7) &&
    a.quaternion.every((value, axis) => Math.abs(value - (b.quaternion[axis] ?? 0)) < 1e-10)
  )
}

export function captureAsBuiltPoses(
  assembly: AssemblyAuthority,
  inspection: AssemblyInspection,
  documentKey: string,
): AssemblyPoseCapture {
  const poses = assembly.instances.map((instance) => {
    const definition = assembly.definitions.find(({ id }) => id === instance.definitionId)
    const occurrences = inspection.occurrences.filter(
      ({ instanceId }) => instanceId === instance.id,
    )
    const first = occurrences[0]
    if (!definition || !first || occurrences.length !== definition.sources.length)
      throw new AssemblyAsBuiltFailure("pose")
    const worldFrame = assemblyRigidPoseSchema.parse(
      composeAssemblyPoses(first.geometryFrame, definition.sourceFrame),
    )
    for (const occurrence of occurrences) {
      if (
        occurrence.definitionId !== definition.id ||
        occurrence.pinRevision !== definition.pinRevision ||
        !samePose(
          worldFrame,
          composeAssemblyPoses(occurrence.geometryFrame, definition.sourceFrame),
        )
      )
        throw new AssemblyAsBuiltFailure("pose")
    }
    return {
      instanceId: instance.id,
      definitionId: definition.id,
      pinRevision: definition.pinRevision,
      worldFrame,
    }
  })
  return { documentKey, poses }
}
function capturedMember(
  assembly: AssemblyAuthority,
  capture: AssemblyPoseCapture,
  instanceId: string,
) {
  const instance = assembly.instances.find(({ id }) => id === instanceId)
  const pose = capture.poses.find((pose) => pose.instanceId === instanceId)
  const definition = assembly.definitions.find(({ id }) => id === instance?.definitionId)
  if (
    !instance ||
    !pose ||
    !definition ||
    pose.definitionId !== definition.id ||
    pose.pinRevision !== definition.pinRevision
  )
    throw new AssemblyAsBuiltFailure("pose")
  return { instance, frame: assemblyRigidPoseSchema.parse(pose.worldFrame) }
}
function zeroDrive(kind: AssemblyJointRecord["kind"], general: boolean) {
  if (kind === "fixed" || kind === "ball") return {}
  const axis = [0, 0, 1]
  if (kind === "cylindrical")
    return {
      axis,
      angle: 0,
      angleLimits: { min: -2 * Math.PI, max: 2 * Math.PI },
      rotationDriven: false,
      translation: 0,
      translationLimits: { min: -100000, max: 100000 },
      translationDriven: false,
    }
  return {
    axis,
    value: 0,
    limits:
      kind === "revolute" ? { min: -2 * Math.PI, max: 2 * Math.PI } : { min: -100000, max: 100000 },
    ...(general ? { driven: true } : {}),
  }
}
function freeMember(instance: AssemblyInstanceRecord, frame: AssemblyRigidPose, general: boolean) {
  return assemblyInstanceRecordSchema.parse({
    schemaVersion: general ? 2 : 1,
    id: instance.id,
    definitionId: instance.definitionId,
    name: instance.name,
    grounded: false,
    ...(general ? { initialFrame: frame } : {}),
  })
}
export function asBuiltJointChanges(
  assembly: AssemblyAuthority,
  capture: AssemblyPoseCapture,
  input: {
    parentId: string
    childId: string
    kind: AssemblyJointRecord["kind"]
  },
  uuid: () => string,
): readonly AssemblyMutation[] {
  if (input.parentId === input.childId) throw new AssemblyAsBuiltFailure("selection")
  if (assembly.schemaVersion === 1 && (input.kind === "ball" || input.kind === "cylindrical"))
    throw new AssemblyAsBuiltFailure("kind")
  const parent = capturedMember(assembly, capture, input.parentId)
  const child = capturedMember(assembly, capture, input.childId)
  const sharedFrame = child.frame
  const joint = assemblyJointRecordSchema.parse({
    schemaVersion: assembly.schemaVersion,
    id: uuid(),
    kind: input.kind,
    parentInstanceId: parent.instance.id,
    childInstanceId: child.instance.id,
    parentFrame: composeAssemblyPoses(invertAssemblyPose(parent.frame), sharedFrame),
    childFrame: composeAssemblyPoses(invertAssemblyPose(child.frame), sharedFrame),
    ...zeroDrive(input.kind, assembly.schemaVersion === 2),
  })
  return [
    {
      kind: "instance.update",
      instance: freeMember(child.instance, child.frame, assembly.schemaVersion === 2),
    },
    { kind: "joint.create", joint },
  ]
}
export function rigidGroupChanges(
  assembly: AssemblyAuthority,
  capture: AssemblyPoseCapture,
  anchorId: string,
  memberIds: readonly string[],
  uuid: () => string,
): readonly AssemblyMutation[] {
  const ids = new Set(memberIds)
  if (ids.size !== memberIds.length || ids.size < 2 || !ids.has(anchorId))
    throw new AssemblyAsBuiltFailure("selection")
  return [...ids]
    .filter((id) => id !== anchorId)
    .sort()
    .flatMap((childId) =>
      asBuiltJointChanges(assembly, capture, { parentId: anchorId, childId, kind: "fixed" }, uuid),
    )
}
