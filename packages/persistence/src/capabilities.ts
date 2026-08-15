import { isFunction } from "is-what"
import { z } from "zod"

export const storageCapabilityReportSchema = z
  .object({
    schemaVersion: z.literal(0),
    indexedDb: z.boolean(),
    opfs: z.boolean(),
    persistentStorage: z.boolean(),
    fileSystemAccess: z.boolean(),
    usageBytes: z.number().int().nonnegative().nullable(),
    quotaBytes: z.number().int().nonnegative().nullable(),
  })
  .strict()

export function selectSaveAsMethod(environment: object) {
  return "showSaveFilePicker" in environment
    ? ("file-system-access" as const)
    : ("download" as const)
}

export function decideUpdateActivation(openDirtyDocumentCount: number) {
  return openDirtyDocumentCount > 0 ? ("defer" as const) : ("activate" as const)
}

export function shouldRequestPersistentStorage(input: {
  hasSavedProject: boolean
  userGesture: boolean
}) {
  return input.hasSavedProject && input.userGesture
}

export async function openOriginPrivateFileSystem(
  environment: Window & typeof globalThis,
): Promise<FileSystemDirectoryHandle | null> {
  const getDirectory = environment.navigator.storage?.getDirectory
  if (!isFunction(getDirectory)) return null
  try {
    return await getDirectory.call(environment.navigator.storage)
  } catch {
    return null
  }
}

export async function inspectStorageCapabilities(environment: Window & typeof globalThis) {
  const [estimate, persisted, opfsRoot] = await Promise.all([
    environment.navigator.storage?.estimate().catch(() => undefined),
    environment.navigator.storage?.persisted().catch(() => false),
    openOriginPrivateFileSystem(environment),
  ])
  return storageCapabilityReportSchema.parse({
    schemaVersion: 0,
    indexedDb: "indexedDB" in environment,
    opfs: opfsRoot !== null,
    persistentStorage: persisted ?? false,
    fileSystemAccess: "showSaveFilePicker" in environment,
    usageBytes: estimate?.usage ?? null,
    quotaBytes: estimate?.quota ?? null,
  })
}
