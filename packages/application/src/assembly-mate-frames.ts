import {
  type AssemblyRigidPose,
  type AssemblyVector3,
  assemblyRigidPoseSchema,
} from "@vibeshape/domain/assembly"
import type { PinnedAssemblyDefinition } from "@vibeshape/domain/assembly-authority"
import type {
  AssemblyConstraintSolveResult,
  AssemblyFrameBinding,
  AssemblyMateGraph,
} from "@vibeshape/domain/assembly-mates"
import { composeAssemblyPoses, invertAssemblyPose } from "@vibeshape/domain/assembly-poses"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import { sameBodyReference } from "@vibeshape/domain/part-operation"
import { resolveTopologyReference } from "@vibeshape/domain/topology"
import type { TopologyCandidate } from "@vibeshape/protocol"
import { projectTopologyCandidate } from "./topology-candidate-projection"

export type AssemblyMateSourceGeometry = Readonly<{
  definitionId: string
  sourceIndex: number
  selectedBody: BodyReference
  representation: "exact-solid" | "triangle-mesh"
  candidates: readonly TopologyCandidate[]
}>
type Failure = Extract<AssemblyConstraintSolveResult, { ok: false }>
class BindingFailure extends Error {
  constructor(
    readonly code: Failure["code"],
    message: string,
  ) {
    super(message)
  }
}
function fail(code: Failure["code"], message: string): never {
  throw new BindingFailure(code, message)
}
function dot(a: AssemblyVector3, b: AssemblyVector3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function subtract(a: AssemblyVector3, b: AssemblyVector3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function addScaled(
  a: AssemblyVector3,
  b: AssemblyVector3,
  scale: number,
): [number, number, number] {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale]
}

function orientedPose(
  origin: AssemblyVector3,
  z: AssemblyVector3,
  xHint: AssemblyVector3,
): AssemblyRigidPose {
  const projected = addScaled(xHint, z, -dot(xHint, z)),
    length = Math.hypot(...projected)
  if (length < 1e-12)
    fail(
      "unsupported-topology",
      "The authored X direction must not be parallel to the selected joint axis.",
    )
  const x: [number, number, number] = [
      projected[0] / length,
      projected[1] / length,
      projected[2] / length,
    ],
    y: [number, number, number] = [
      z[1] * x[2] - z[2] * x[1],
      z[2] * x[0] - z[0] * x[2],
      z[0] * x[1] - z[1] * x[0],
    ]
  const m00 = x[0],
    m01 = y[0],
    m02 = z[0],
    m10 = x[1],
    m11 = y[1],
    m12 = z[1],
    m20 = x[2],
    m21 = y[2],
    m22 = z[2],
    trace = m00 + m11 + m22
  let quaternion: number[]
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1)
    quaternion = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    quaternion = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    quaternion = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    quaternion = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]
  }
  return assemblyRigidPoseSchema.parse({ translation: origin, quaternion })
}
const frameRecipes: Partial<
  Record<
    NonNullable<TopologyCandidate["referenceGeometry"]>["kind"],
    AssemblyFrameBinding["geometry"]
  >
> = {
  "plane-face": "planar-face",
  "cylinder-face": "cylindrical-face",
  "sphere-face": "spherical-face",
  "circle-edge": "circular-edge",
  "arc-edge": "circular-edge",
  vertex: "vertex",
}
function analyticalOriginAxis(
  geometry: NonNullable<TopologyCandidate["referenceGeometry"]>,
  hint: AssemblyVector3,
): { origin: AssemblyVector3; z: AssemblyVector3 } {
  switch (geometry.kind) {
    case "plane-face":
      return {
        origin: addScaled(
          hint,
          geometry.normal,
          -dot(subtract(hint, geometry.origin), geometry.normal),
        ),
        z: geometry.normal,
      }
    case "cylinder-face":
      return {
        origin: addScaled(
          geometry.origin,
          geometry.axis,
          dot(subtract(hint, geometry.origin), geometry.axis),
        ),
        z: geometry.axis,
      }
    case "circle-edge":
    case "arc-edge":
      return { origin: geometry.center, z: geometry.normal }
    case "sphere-face":
      return { origin: geometry.center, z: [0, 0, 1] }
    case "vertex":
      return { origin: geometry.position, z: [0, 0, 1] }
    default:
      return fail(
        "unsupported-topology",
        "The selected topology has no analytical joint frame recipe.",
      )
  }
}
function geometryFrame(
  binding: AssemblyFrameBinding,
  candidate: TopologyCandidate,
): AssemblyRigidPose {
  const geometry = candidate.referenceGeometry
  if (!geometry)
    fail("unsupported-topology", "The selected topology has no exact analytical frame evidence.")
  if (frameRecipes[geometry.kind] !== binding.geometry)
    fail("unsupported-topology", "The selected topology does not match its authored frame recipe.")
  const { origin, z } = analyticalOriginAxis(geometry, binding.originHint)
  return orientedPose(origin, binding.reversed ? [-z[0], -z[1], -z[2]] : z, binding.xDirection)
}
function pinnedDefinition(
  assembly: AssemblyMateGraph,
  definitions: readonly PinnedAssemblyDefinition[],
  instanceId: string,
  binding: AssemblyFrameBinding,
) {
  const instance = assembly.instances.find(({ id }) => id === instanceId),
    definition = definitions.find(({ id }) => id === instance?.definitionId)
  const pinned = definition?.pinnedModels.find((p) => p.sourceIndex === binding.sourceIndex)
  if (
    !definition ||
    !pinned ||
    definition.pinRevision !== binding.pinRevision ||
    !sameBodyReference(pinned.selectedBody, binding.body) ||
    binding.reference.featureId !== binding.body.featureId
  )
    fail(
      "topology-stale",
      "The joint frame binding no longer matches its immutable definition pin.",
    )
  return definition
}
function resolveFrame(
  assembly: AssemblyMateGraph,
  definitions: readonly PinnedAssemblyDefinition[],
  sources: readonly AssemblyMateSourceGeometry[],
  instanceId: string,
  binding: AssemblyFrameBinding,
  offset: AssemblyRigidPose,
) {
  const definition = pinnedDefinition(assembly, definitions, instanceId, binding)
  const source = sources.find(
    (s) =>
      s.definitionId === definition.id &&
      s.sourceIndex === binding.sourceIndex &&
      sameBodyReference(s.selectedBody, binding.body),
  )
  if (!source) fail("topology-missing", "The joint frame's frozen source geometry is unavailable.")
  if (source.representation !== "exact-solid")
    fail("unsupported-topology", "Topology-bound joint frames require an exact source body.")
  const candidates = source.candidates.map(projectTopologyCandidate)
  const resolution = resolveTopologyReference(binding.reference, candidates)
  if (resolution.status !== "resolved")
    fail(
      resolution.status === "ambiguous" ? "topology-ambiguous" : "topology-missing",
      "The joint topology reference must resolve uniquely; reselect the intended geometry.",
    )
  const candidate = source.candidates.find((c) => c.candidateId === resolution.candidateId)
  if (!candidate) fail("topology-missing", "The resolved analytical topology is unavailable.")
  return assemblyRigidPoseSchema.parse(
    composeAssemblyPoses(
      composeAssemblyPoses(
        invertAssemblyPose(definition.sourceFrame),
        geometryFrame(binding, candidate),
      ),
      offset,
    ),
  )
}

/** Produces disposable numeric frames; persisted references and offsets remain unchanged. */
export function resolveAssemblyMateFrames(
  assembly: AssemblyMateGraph,
  definitions: readonly PinnedAssemblyDefinition[],
  sources: readonly AssemblyMateSourceGeometry[],
): { ok: true; assembly: AssemblyMateGraph } | Failure {
  let jointId: string | undefined
  try {
    const joints = assembly.joints.map((joint) => {
      jointId = joint.id
      const { parentBinding, childBinding, ...numeric } = joint
      return {
        ...numeric,
        parentFrame: parentBinding
          ? resolveFrame(
              assembly,
              definitions,
              sources,
              joint.parentInstanceId,
              parentBinding,
              joint.parentFrame,
            )
          : joint.parentFrame,
        childFrame: childBinding
          ? resolveFrame(
              assembly,
              definitions,
              sources,
              joint.childInstanceId,
              childBinding,
              joint.childFrame,
            )
          : joint.childFrame,
      }
    })
    return { ok: true, assembly: { ...assembly, joints } }
  } catch (error) {
    return {
      ok: false,
      code: error instanceof BindingFailure ? error.code : "unsupported-topology",
      message: error instanceof Error ? error.message : "Joint frame resolution failed.",
      jointIds: jointId ? [jointId] : [],
    }
  }
}
