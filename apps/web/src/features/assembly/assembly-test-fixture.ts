import { assemblyDefinitionSchema } from "@vibeshape/domain/assembly"
import {
  captureAssemblyDefinition,
  emptyAssemblyAuthority,
} from "@vibeshape/domain/assembly-authority"
import { documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import { authoredTreeFixture, authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { identityAssemblyPose, newAssemblyInstance } from "./assembly-model"

export function assemblyUiFixture() {
  const f = authoredTreeFixture()
  const sources = f.authority.parts.map((part) => {
    const body = part.bodyHistory[0]
    if (!body) throw new Error("The assembly test requires exact source bindings.")
    return {
      name: part.name,
      source: { kind: "part" as const, partId: part.id, body, contentHash: "a".repeat(64) },
    }
  })
  const first = sources[0]
  if (!first) throw new Error("The assembly test requires a source Part.")
  const definition = captureAssemblyDefinition(
    documentSnapshotV4Schema.parse({
      ...f.authority,
      schemaVersion: 4,
      surfaceTextures: [],
      assets: [],
    }),
    assemblyDefinitionSchema.parse({
      schemaVersion: 1,
      id: id(500),
      name: "Bracket",
      sources: [first.source],
      sourceFrame: identityAssemblyPose,
    }),
    1,
  )
  const parent = newAssemblyInstance(definition, "Base", identityAssemblyPose, () => id(501))
  const assembly = { ...emptyAssemblyAuthority(), definitions: [definition], instances: [parent] }
  return { ...f, sources, definition, parent, assembly }
}
