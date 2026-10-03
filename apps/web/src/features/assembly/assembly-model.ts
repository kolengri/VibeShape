import { resolveAuthoredParts } from "@vibeshape/application/authored-parts"
import {
  type AssemblyDefinition,
  type AssemblyInstance,
  type AssemblyJoint,
  type AssemblyRigidPose,
  assemblyDefinitionSchema,
  assemblyInstanceSchema,
  assemblyJointSchema,
  assemblyRigidPoseSchema,
} from "@vibeshape/domain/assembly"
import {
  type AssemblyAuthority,
  type AssemblyMutation,
  assemblyMutationsSchema,
  emptyAssemblyAuthority,
  projectAssemblyAuthority,
} from "@vibeshape/domain/assembly-authority"
import { solveAssemblyKinematics } from "@vibeshape/domain/assembly-kinematics"
import { documentV4CommandSchema } from "@vibeshape/domain/document-v4-command-schemas"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import { browserAuthoredUuid } from "../../document/authored-document-session"
import type { DocumentControllerState } from "../../document/document-controller"
import { sourceAuthorityUpgradeCommands } from "../import/source-authority-upgrade"

export type AssemblyDocumentContext = Readonly<{
  documentId: string
  revision: number
  authorityVersion: 2 | 3 | 4
}>
export const identityAssemblyPose: AssemblyRigidPose = {
  translation: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}
export function assemblyDocumentContext(controller: DocumentControllerState) {
  const authority = controller.authoredSnapshot
  const report = controller.report
  if (
    !authority ||
    authority.schemaVersion === 1 ||
    !report ||
    authority.id !== report.snapshot.id ||
    authority.revision !== report.snapshot.revision
  )
    return null
  return {
    documentId: authority.id,
    revision: authority.revision,
    authorityVersion: authority.schemaVersion,
  } satisfies AssemblyDocumentContext
}
export function activeAssembly(controller: DocumentControllerState): AssemblyAuthority {
  const authority = controller.authoredSnapshot
  return authority?.schemaVersion === 4 ? authority.assembly : emptyAssemblyAuthority()
}
export function assemblyPartSources(controller: DocumentControllerState) {
  const authority = controller.authoredSnapshot
  if (!authority || authority.schemaVersion === 1 || !controller.report) return []
  return (resolveAuthoredParts(authority, controller.report) ?? []).flatMap(({ part, body }) =>
    body
      ? [
          {
            name: part.name,
            source: {
              kind: "part" as const,
              partId: part.id,
              body: {
                schemaVersion: 0 as const,
                featureId: body.featureId,
                outputRole: body.outputRole ?? "result",
              },
              contentHash: body.contentHash,
            },
          },
        ]
      : [],
  )
}
export type AssemblyPartSource = ReturnType<typeof assemblyPartSources>[number]

/** Apply X, then Y, then Z active right-handed rotations, in degrees. */
export function assemblyPoseFromEuler(
  translation: readonly [number, number, number],
  degrees: readonly [number, number, number],
) {
  if (degrees.some((value) => !Number.isFinite(value) || Math.abs(value) > 360))
    throw new Error("Assembly rotations must be finite degrees within -360 and 360.")
  const [x, y, z] = degrees.map((angle) => (angle * Math.PI) / 360)
  const sx = Math.sin(x ?? 0),
    cx = Math.cos(x ?? 0)
  const sy = Math.sin(y ?? 0),
    cy = Math.cos(y ?? 0)
  const sz = Math.sin(z ?? 0),
    cz = Math.cos(z ?? 0)
  return assemblyRigidPoseSchema.parse({
    translation,
    quaternion: [
      sx * cy * cz - cx * sy * sz,
      cx * sy * cz + sx * cy * sz,
      cx * cy * sz - sx * sy * cz,
      cx * cy * cz + sx * sy * sz,
    ],
  })
}
export function assemblyEulerDegrees(pose: AssemblyRigidPose): [number, number, number] {
  const [x, y, z, w] = pose.quaternion
  const sinY = 2 * (w * y - z * x)
  const yAngle = Math.asin(Math.max(-1, Math.min(1, sinY)))
  if (Math.abs(sinY) > 1 - 2e-15)
    return [0, Math.sign(sinY) * 90, (2 * Math.atan2(z, w) * 180) / Math.PI]
  return [
    (Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * 180) / Math.PI,
    (yAngle * 180) / Math.PI,
    (Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 180) / Math.PI,
  ]
}
export function createAssemblyTransaction(
  context: AssemblyDocumentContext,
  input: readonly AssemblyMutation[],
  uuid = browserAuthoredUuid,
) {
  const changes = assemblyMutationsSchema.parse(input)
  let revision = context.revision
  const issuedAt = new Date().toISOString()
  const envelope = () => ({
    commandId: uuid(),
    documentId: context.documentId,
    baseRevision: revision++,
    issuedAt,
    actor: { type: "user" as const, userId: null },
  })
  const commands = [
    ...sourceAuthorityUpgradeCommands(context.authorityVersion, envelope),
    documentV4CommandSchema.parse({
      ...envelope(),
      schemaVersion: 4,
      kind: "org.vibeshape.document.assembly-command",
      payload: { changes },
    }),
  ]
  return { transactionId: draftIdSchema.parse(uuid()), commands, assetBlobs: [] }
}
export function createAssemblyDefinitionChanges(
  source: AssemblyPartSource,
  name: string,
  instanceName: string,
  uuid = browserAuthoredUuid,
): readonly AssemblyMutation[] {
  const definition = assemblyDefinitionSchema.parse({
    schemaVersion: 1,
    id: uuid(),
    name,
    sources: [source.source],
    sourceFrame: identityAssemblyPose,
  })
  return [
    { kind: "definition.create", definition },
    {
      kind: "instance.create",
      instance: newAssemblyInstance(definition, instanceName, identityAssemblyPose, uuid),
    },
  ]
}
export function newAssemblyInstance(
  definition: Pick<AssemblyDefinition, "id">,
  name: string,
  worldFrame: AssemblyRigidPose,
  uuid = browserAuthoredUuid,
): AssemblyInstance {
  return assemblyInstanceSchema.parse({
    schemaVersion: 1,
    id: uuid(),
    definitionId: definition.id,
    name,
    grounded: true,
    worldFrame,
  })
}
export function attachAssemblyChildChanges(
  child: AssemblyInstance,
  joint: AssemblyJoint,
  creating: boolean,
): readonly AssemblyMutation[] {
  const { worldFrame: _frame, ...fields } = child.grounded
    ? child
    : { ...child, worldFrame: undefined }
  const ungrounded = assemblyInstanceSchema.parse({ ...fields, grounded: false })
  const parsedJoint = assemblyJointSchema.parse(joint)
  if (parsedJoint.childInstanceId !== child.id)
    throw new Error("The joint must attach the selected child occurrence.")
  return [
    { kind: creating ? "instance.create" : "instance.update", instance: ungrounded },
    { kind: "joint.create", joint: parsedJoint },
  ]
}
export function groundAssemblyInstanceChanges(
  assembly: AssemblyAuthority,
  instance: AssemblyInstance,
): readonly AssemblyMutation[] {
  const solved = solveAssemblyKinematics(projectAssemblyAuthority(assembly))
  if (!solved.ok) throw new Error(solved.diagnostic.message)
  const pose = solved.instances.find(({ instanceId }) => instanceId === instance.id)
  if (!pose) throw new Error("The selected occurrence has no solved world frame.")
  const joint = assembly.joints.find(({ childInstanceId }) => childInstanceId === instance.id)
  const changes: AssemblyMutation[] = joint ? [{ kind: "joint.remove", jointId: joint.id }] : []
  changes.push({
    kind: "instance.update",
    instance: assemblyInstanceSchema.parse({
      ...instance,
      grounded: true,
      worldFrame: pose.worldFrame,
    }),
  })
  return changes
}
export function allAssemblyInterferencePairs(instances: readonly AssemblyInstance[]) {
  if (instances.length > 32) throw new Error("Inspect all supports at most 32 occurrences.")
  return instances.flatMap((left, index) =>
    instances.slice(index + 1).map((right) => ({
      leftInstanceId: left.id,
      rightInstanceId: right.id,
    })),
  )
}
