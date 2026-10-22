import { expect, it, mock } from "bun:test"
import type { VibeShapeDatabase } from "./database"
import { VersionedLocalDocumentRepository } from "./versioned-repository"

const at = "2026-10-22T00:00:00Z"
const project = {
  schemaVersion: 0,
  documentId: "0195b5ac-b250-7a2c-8c33-000000000001",
  name: "Bracket",
  headRevision: 3,
  latestSnapshotRevision: 3,
  cleanCloseRevision: 3,
  createdAt: at,
  updatedAt: at,
  lastExternalBackupAt: null,
}
const thumbnail = {
  schemaVersion: 0,
  documentId: project.documentId,
  revision: 3,
  mediaType: "image/svg+xml",
  bytes: new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" role="img"><g stroke="#123456" stroke-width="1" stroke-linejoin="round"><polygon points="0.00,0.00 10.00,0.00 0.00,10.00" fill="rgb(100 120 140)"/></g></svg>',
  ),
  generatedAt: at,
}

function fixture() {
  const readThumbnails = mock(async () => [thumbnail])
  const database = {
    projects: { limit: () => ({ toArray: async () => [project] }) },
    projectsV1: { limit: () => ({ toArray: async () => [] }) },
    projectThumbnails: { limit: () => ({ toArray: readThumbnails }) },
  } as unknown as VibeShapeDatabase
  return { repository: new VersionedLocalDocumentRepository(database), readThumbnails }
}

it("lists project metadata without reading or validating thumbnail bytes", async () => {
  const { repository, readThumbnails } = fixture()
  const result = await repository.listProjects({ includeThumbnails: false })
  expect(result).toMatchObject({
    ok: true,
    value: [{ documentId: project.documentId, name: "Bracket", headRevision: 3, thumbnail: null }],
  })
  expect(readThumbnails).not.toHaveBeenCalled()
})

it("keeps current thumbnails in the default project library listing", async () => {
  const { repository, readThumbnails } = fixture()
  expect(await repository.listProjects()).toMatchObject({
    ok: true,
    value: [
      {
        documentId: project.documentId,
        thumbnail: { mediaType: "image/svg+xml", bytes: thumbnail.bytes },
      },
    ],
  })
  expect(readThumbnails).toHaveBeenCalledTimes(1)
})
