import { assemblyDefinitionIdSchema } from "@vibeshape/domain/assembly"
import {
  captureAssemblyDefinition,
  pinnedAssemblyDefinitionSchema,
} from "@vibeshape/domain/assembly-authority"
import {
  assemblyLibraryTagsSchema,
  assemblyLibraryVersionNumberSchema,
} from "@vibeshape/domain/assembly-library"
import { authoredItemNameSchema } from "@vibeshape/domain/parts"
import {
  AssemblyLibraryDatabase,
  LocalAssemblyLibraryRepository,
} from "@vibeshape/persistence/assembly-library-store"
import { z } from "zod"
import {
  activeAssembly,
  assemblyDocumentContext,
  assemblyPartSources,
  createAssemblyTransaction,
  identityAssemblyPose,
  newAssemblyInstance,
} from "../features/assembly/assembly-model"
import { browserAuthoredUuid } from "./authored-document-session"
import {
  commitAuthoredTransaction,
  type DocumentMutationResult,
  getDocumentControllerState,
  getProjectActionBlock,
  verifyActiveFrozenDefinition,
} from "./document-controller"

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const metadata = { name: authoredItemNameSchema, tags: assemblyLibraryTagsSchema }
const librarySelection = { itemId: uuid, version: assemblyLibraryVersionNumberSchema }
const saveSchema = z
  .object({
    source: z.object({ kind: z.enum(["part", "definition"]), id: uuid }).strict(),
    itemId: uuid.optional(),
    expectedMetadataRevision: z.number().int().positive().nullable(),
    ...metadata,
  })
  .strict()
const insertSchema = z
  .object({
    ...librarySelection,
    mode: z.enum(["copy", "reference"]),
    definitionName: authoredItemNameSchema,
    instanceName: authoredItemNameSchema,
  })
  .strict()
const relinkSchema = z.object({ ...librarySelection, definitionId: uuid }).strict()
const metadataSchema = z
  .object({ itemId: uuid, expectedMetadataRevision: z.number().int().positive(), ...metadata })
  .strict()
let repository: LocalAssemblyLibraryRepository | undefined
function localLibrary() {
  repository ??= new LocalAssemblyLibraryRepository(new AssemblyLibraryDatabase())
  return repository
}
function failure(error: unknown): Extract<DocumentMutationResult, { ok: false }> {
  return {
    ok: false as const,
    diagnostic: {
      code: "persistence-failed",
      sourceCode: "library-operation-failed",
      message: error instanceof Error ? error.message : "The local library operation failed.",
      retryable: false,
    },
  }
}
async function safely<T>(action: () => Promise<T>): Promise<T | ReturnType<typeof failure>> {
  try {
    return await action()
  } catch (error) {
    return failure(error)
  }
}
function writableDocument() {
  const controller = getDocumentControllerState()
  const context = assemblyDocumentContext(controller)
  if (!context || getProjectActionBlock())
    throw new Error("The document is unavailable for a library operation.")
  return { controller, context }
}

export function listLocalLibraryItems(query: string) {
  return safely(() => localLibrary().listItems({ query, limit: 200 }))
}
export function readLocalLibraryVersion(itemId: string, version?: number) {
  return safely(() =>
    localLibrary().readVersion({ itemId, ...(version === undefined ? {} : { version }) }),
  )
}
export function updateLocalLibraryMetadata(input: z.input<typeof metadataSchema>) {
  return safely(() =>
    localLibrary().updateMetadata({
      ...metadataSchema.parse(input),
      updatedAt: new Date().toISOString(),
    }),
  )
}
function captureLibrarySource(
  controller: ReturnType<typeof getDocumentControllerState>,
  request: z.output<typeof saveSchema>,
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
  return captureAssemblyDefinition(
    {
      ...authority,
      schemaVersion: 4,
      surfaceTextures: authority.schemaVersion === 2 ? [] : authority.surfaceTextures,
      assets: authority.schemaVersion === 4 ? authority.assets : [],
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

export function saveActiveLibraryDefinition(input: z.input<typeof saveSchema>) {
  return safely(async () => {
    const request = saveSchema.parse(input)
    const { controller } = writableDocument()
    const definition = captureLibrarySource(controller, request)
    const { libraryBinding: _binding, ...unbound } = definition
    const sourceAssets = await verifyActiveFrozenDefinition(unbound)
    const blobs = new Map(
      sourceAssets.map(({ asset, bytes }) => [
        asset.digest,
        { digest: asset.digest, bytes: bytes.slice() },
      ]),
    )
    return localLibrary().publishVersion({
      itemId: request.itemId ?? browserAuthoredUuid(),
      expectedMetadataRevision: request.expectedMetadataRevision,
      name: request.name,
      tags: request.tags,
      definition: unbound,
      blobs: [...blobs.values()],
      createdAt: new Date().toISOString(),
    })
  })
}

export async function insertLocalLibraryVersion(
  input: z.input<typeof insertSchema>,
): Promise<DocumentMutationResult> {
  return safely(async () => {
    const request = insertSchema.parse(input)
    const { context } = writableDocument()
    const read = await localLibrary().readVersion({
      itemId: request.itemId,
      version: request.version,
    })
    if (!read.ok) throw new Error(read.diagnostic.message)
    const { libraryBinding: _binding, ...saved } = read.value.version.definition
    const definition = pinnedAssemblyDefinitionSchema.parse({
      ...saved,
      id: browserAuthoredUuid(),
      pinRevision: 1,
      name: request.definitionName,
      ...(request.mode === "reference"
        ? { libraryBinding: { itemId: request.itemId, version: request.version } }
        : {}),
    })
    const transaction = createAssemblyTransaction(context, [
      { kind: "definition.insert-pinned", definition },
      {
        kind: "instance.create",
        instance: newAssemblyInstance(definition, request.instanceName, identityAssemblyPose),
      },
    ])
    return commitAuthoredTransaction(context.revision, {
      ...transaction,
      assetBlobs: read.value.blobs,
    })
  })
}
export async function relinkActiveLibraryDefinition(
  input: z.input<typeof relinkSchema>,
): Promise<DocumentMutationResult> {
  return safely(async () => {
    const request = relinkSchema.parse(input)
    const { controller, context } = writableDocument()
    const current = activeAssembly(controller).definitions.find(
      ({ id }) => id === request.definitionId,
    )
    if (!current?.libraryBinding)
      throw new Error("The selected definition is not a library reference.")
    const read = await localLibrary().readVersion({
      itemId: request.itemId,
      version: request.version,
    })
    if (!read.ok) throw new Error(read.diagnostic.message)
    const definition = pinnedAssemblyDefinitionSchema.parse({
      ...read.value.version.definition,
      id: current.id,
      pinRevision: current.pinRevision + 1,
      name: current.name,
      libraryBinding: { itemId: request.itemId, version: request.version },
    })
    const transaction = createAssemblyTransaction(context, [
      { kind: "definition.relink-pinned", definition },
    ])
    return commitAuthoredTransaction(context.revision, {
      ...transaction,
      assetBlobs: read.value.blobs,
    })
  })
}
export async function detachActiveLibraryDefinition(
  definitionId: string,
): Promise<DocumentMutationResult> {
  return safely(async () => {
    const { context } = writableDocument()
    const transaction = createAssemblyTransaction(context, [
      {
        kind: "definition.detach-library",
        definitionId: assemblyDefinitionIdSchema.parse(definitionId),
      },
    ])
    return commitAuthoredTransaction(context.revision, transaction)
  })
}
