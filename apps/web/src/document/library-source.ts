import { captureAssemblyDefinition } from "@vibeshape/domain/assembly-authority"
import { projectDocumentSnapshotV5ToV4 } from "@vibeshape/domain/document-v5"
import { projectDocumentSnapshotV6ToV5 } from "@vibeshape/domain/document-v6"
import {
  activeAssembly,
  assemblyPartSources,
  identityAssemblyPose,
} from "../features/assembly/assembly-model"
import { browserAuthoredUuid } from "./authored-document-session"
import type { getDocumentControllerState } from "./document-controller"

export function captureLibrarySource(
  controller: ReturnType<typeof getDocumentControllerState>,
  request: Readonly<{ source: { kind: "part" | "definition"; id: string }; name: string }>,
) {
  if (request.source.kind === "definition") {
    const saved = activeAssembly(controller).definitions.find(({ id }) => id === request.source.id)
    if (!saved) throw new Error("The selected frozen definition is unavailable.")
    return saved
  }
  const authority = controller.authoredSnapshot
  if (!authority || authority.schemaVersion === 1)
    throw new Error("Authored source authority is unavailable.")
  const part = assemblyPartSources(controller).find(
    ({ source }) => source.partId === request.source.id,
  )
  if (!part) throw new Error("The selected Part has no available body.")
  const previous =
    authority.schemaVersion === 6 ? projectDocumentSnapshotV6ToV5(authority) : authority
  const source = previous.schemaVersion === 5 ? projectDocumentSnapshotV5ToV4(previous) : previous
  return captureAssemblyDefinition(
    {
      ...source,
      schemaVersion: 4,
      surfaceTextures: source.schemaVersion === 2 ? [] : source.surfaceTextures,
      assets: source.schemaVersion === 4 ? source.assets : [],
    },
    {
      schemaVersion: 1,
      id: browserAuthoredUuid(),
      name: request.name,
      sources: [part.source],
      sourceFrame: identityAssemblyPose,
    },
  )
}
