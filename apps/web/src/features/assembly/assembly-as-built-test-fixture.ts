import { assemblyAuthoritySchema } from "@vibeshape/domain/assembly-authority"
import { composeAssemblyPoses, invertAssemblyPose } from "@vibeshape/domain/assembly-poses"
import { type AssemblyInspection, assemblyRigidPoseWireSchema } from "@vibeshape/protocol"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { captureAsBuiltPoses } from "./assembly-as-built"
import { assemblyPoseFromEuler, newAssemblyInstance } from "./assembly-model"
import { assemblyUiFixture } from "./assembly-test-fixture"

export function asBuiltUiFixture(version: 1 | 2 = 1) {
  const f = assemblyUiFixture()
  const definition = { ...f.definition, sourceFrame: assemblyPoseFromEuler([3, 4, 5], [0, 0, 45]) }
  const frames = [
    assemblyPoseFromEuler([10, 20, 30], [0, 0, 90]),
    assemblyPoseFromEuler([14, 26, 32], [90, 0, 0]),
    assemblyPoseFromEuler([5, 18, 40], [0, 90, 0]),
  ]
  const instances = frames.map((frame, index) =>
    newAssemblyInstance(definition, `Member ${index + 1}`, frame, () => id(510 + index), version),
  )
  const assembly = assemblyAuthoritySchema.parse({
    ...f.assembly,
    schemaVersion: version,
    definitions: [definition],
    instances,
  })
  const body = definition.pinnedModels[0]?.selectedBody
  if (!body) throw new Error("The captured fixture requires a selected body.")
  const inspection: AssemblyInspection = {
    interference: [],
    occurrences: instances.map((instance, index) => {
      const frame = frames[index]
      if (!frame) throw new Error("The fixture requires a world frame.")
      return {
        instanceId: instance.id,
        definitionId: definition.id,
        pinRevision: definition.pinRevision,
        sourceIndex: 0,
        selectedBody: body,
        contentHash: "a".repeat(64),
        representation: "exact-solid",
        geometryFrame: assemblyRigidPoseWireSchema.parse(
          composeAssemblyPoses(frame, invertAssemblyPose(definition.sourceFrame)),
        ),
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        mesh: {
          positions: new Float32Array(),
          normals: new Float32Array(),
          indices: new Uint32Array(),
          triangleFaceIds: new Uint32Array(),
        },
      }
    }),
  }
  return {
    ...f,
    assembly,
    inspection,
    frames,
    capture: captureAsBuiltPoses(assembly, inspection, `${id(1)}:7`),
  }
}
