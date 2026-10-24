import {
  writeVShapeV2,
  writeVShapeV3,
  writeVShapeV4,
  writeVShapeV5,
  writeVShapeV6,
  writeVShapeV7,
} from "@vibeshape/formats/vshape"
import { VibeShapeDatabase } from "@vibeshape/persistence"
import type { BrowserPortableProject } from "./authored-project-file"
import { BrowserProjectRepository } from "./browser-project-repository"
import {
  type ProjectBackupRequest,
  type ProjectBackupResult,
  type ProjectBackupStage,
  projectBackupRequestSchema,
  projectBackupResponseSchema,
} from "./project-backup-contract"

async function encodeProjectBackup(
  portable: BrowserPortableProject,
  expected: Pick<ProjectBackupRequest, "documentId" | "revision">,
  onProgress: (stage: ProjectBackupStage) => void,
): Promise<ProjectBackupResult> {
  const { snapshot } = portable.project
  if (snapshot.id !== expected.documentId || snapshot.revision !== expected.revision)
    return {
      ok: false,
      diagnostic: {
        code: "project-action-blocked",
        message: "The project changed before its backup could be captured.",
      },
    }
  const writers = {
    2: writeVShapeV2,
    3: writeVShapeV3,
    4: writeVShapeV4,
    5: writeVShapeV5,
    6: writeVShapeV6,
    7: writeVShapeV7,
  }
  onProgress("building-archive")
  const archived = await writers[portable.version]({
    ...portable.project,
    exportedAt: new Date().toISOString(),
    createdBy: { application: "VibeShape", version: "0.0.0", build: null },
    engine: null,
  })
  return archived.ok
    ? projectBackupResponseSchema.parse({
        ok: true,
        file: archived.value,
        documentId: snapshot.id,
        revision: snapshot.revision,
        documentName: snapshot.name,
      })
    : archived
}

export async function exportSavedProjectBackup(
  input: unknown,
  onProgress: (stage: ProjectBackupStage) => void = () => {},
): Promise<ProjectBackupResult> {
  const request = projectBackupRequestSchema.parse(input)
  const database = new VibeShapeDatabase(request.databaseName)
  try {
    onProgress("reading-project")
    const portable = await new BrowserProjectRepository(database).exportPortableProject(
      request.documentId,
    )
    return portable.ok ? await encodeProjectBackup(portable.value, request, onProgress) : portable
  } finally {
    database.close()
  }
}
