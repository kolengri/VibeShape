import type {
  AssemblyLibraryItem,
  AssemblyLibraryVersion,
} from "@vibeshape/domain/assembly-library"
import { assemblyLibraryTagsSchema } from "@vibeshape/domain/assembly-library"
import { authoredItemNameSchema } from "@vibeshape/domain/parts"
import type { AssemblyLibraryVersionRead } from "@vibeshape/persistence/assembly-library-store"
import { z } from "zod"
import type { DocumentControllerState } from "../../document/document-controller"
import { activeAssembly, assemblyPartSources } from "../assembly/assembly-model"

export type LibrarySelection = { item: AssemblyLibraryItem; version: AssemblyLibraryVersion }
export type LibrarySource = { key: string; kind: "part" | "definition"; id: string; name: string }
export function librarySources(controller: DocumentControllerState): LibrarySource[] {
  return [
    ...assemblyPartSources(controller).map(({ name, source }) => ({
      key: `part:${source.partId}`,
      kind: "part" as const,
      id: source.partId,
      name,
    })),
    ...activeAssembly(controller).definitions.map(({ id, name }) => ({
      key: `definition:${id}`,
      kind: "definition" as const,
      id,
      name,
    })),
  ]
}
export function librarySelection(read: AssemblyLibraryVersionRead): LibrarySelection {
  return { item: read.item, version: read.version }
}
const metadataSchema = z.object({ name: authoredItemNameSchema, tags: assemblyLibraryTagsSchema })
export function parseLibraryMetadata(name: string, tags: string) {
  return metadataSchema.safeParse({
    name,
    tags: tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  })
}
export function libraryVersions(item: AssemblyLibraryItem) {
  return Array.from({ length: item.headVersion }, (_, index) => index + 1).reverse()
}
export function libraryDocumentScope(controller: DocumentControllerState) {
  const snapshot = controller.authoredSnapshot ?? controller.report?.snapshot
  return { documentId: snapshot?.id ?? null, revision: snapshot?.revision ?? null }
}
export function libraryScopeMatches(
  captured: ReturnType<typeof libraryDocumentScope>,
  current: ReturnType<typeof libraryDocumentScope>,
  revisionSensitive: boolean,
) {
  return (
    captured.documentId === current.documentId &&
    (!revisionSensitive || captured.revision === current.revision)
  )
}
export function librarySaveState(
  sources: readonly LibrarySource[],
  sourceKey: string,
  publish: boolean,
  selection: LibrarySelection | null,
) {
  const source = sources.find(({ key }) => key === sourceKey)
  const target = publish && selection ? selection.item : null
  if (target)
    return {
      source,
      target,
      name: target.name,
      tags: target.tags,
      formKey: `${sourceKey}:${target.id}:${target.metadataRevision}`,
      disabled: !source,
    }
  return {
    source,
    target: null,
    name: source ? source.name : "",
    tags: [],
    formKey: `${sourceKey}:new`,
    disabled: !source || publish,
  }
}
export function libraryDocumentWritable(controller: DocumentControllerState, blocked: boolean) {
  return (
    !blocked &&
    controller.status === "ready" &&
    controller.report?.mode === "read-write" &&
    controller.saveStatus !== "saving"
  )
}
