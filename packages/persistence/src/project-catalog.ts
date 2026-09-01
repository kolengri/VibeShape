import type { DocumentId } from "@vibeshape/domain"
import type { VibeShapeDatabase } from "./database"
import { persistenceInvariantError } from "./diagnostics"
import {
  type LocalProjectSummary,
  localProjectSummarySchema,
  type ProjectRecord,
  type ProjectRecordV1,
  projectRecordSchema,
  projectRecordV1Schema,
  projectThumbnailRecordSchema,
} from "./schemas"

export const MAX_LOCAL_PROJECTS = 4_096
const MAX_LOCAL_PROJECT_THUMBNAIL_BYTES = 16 * 1024 * 1024

export type ProjectCatalogRecord = ProjectRecord | ProjectRecordV1

function parseProjectCatalogRecord(record: unknown, version: 0 | 1): ProjectCatalogRecord {
  const parsed =
    version === 1 ? projectRecordV1Schema.safeParse(record) : projectRecordSchema.safeParse(record)
  if (!parsed.success)
    throw persistenceInvariantError(
      "corrupt-history",
      "The local project index contains an invalid record.",
    )
  return parsed.data
}

export async function requireAuthoritativeProject(
  database: VibeShapeDatabase,
  documentId: DocumentId,
) {
  const versioned = await database.projectsV1.get(documentId)
  if (versioned) return parseProjectCatalogRecord(versioned, 1)
  const legacy = await database.projects.get(documentId)
  if (legacy) return parseProjectCatalogRecord(legacy, 0)
  throw persistenceInvariantError("document-not-found", "The local project does not exist.")
}

export async function authoritativeProjectCatalog(database: VibeShapeDatabase) {
  const [legacyRecords, versionedRecords] = await Promise.all([
    database.projects.limit(MAX_LOCAL_PROJECTS + 1).toArray(),
    database.projectsV1.limit(MAX_LOCAL_PROJECTS + 1).toArray(),
  ])
  if (legacyRecords.length > MAX_LOCAL_PROJECTS || versionedRecords.length > MAX_LOCAL_PROJECTS)
    throw persistenceInvariantError(
      "corrupt-history",
      "The local project index exceeds the supported project limit.",
    )
  const projects = new Map<string, ProjectCatalogRecord>()
  for (const record of legacyRecords) {
    const project = parseProjectCatalogRecord(record, 0)
    projects.set(project.documentId, project)
  }
  for (const record of versionedRecords) {
    const project = parseProjectCatalogRecord(record, 1)
    projects.set(project.documentId, project)
  }
  if (projects.size > MAX_LOCAL_PROJECTS)
    throw persistenceInvariantError(
      "corrupt-history",
      "The local project index exceeds the supported project limit.",
    )
  return [...projects.values()]
}

async function currentProjectThumbnails(
  database: VibeShapeDatabase,
  projects: readonly ProjectCatalogRecord[],
) {
  try {
    const records = await database.projectThumbnails.limit(MAX_LOCAL_PROJECTS + 1).toArray()
    if (records.length > MAX_LOCAL_PROJECTS) return new Map<string, null>()
    const projectsById = new Map(projects.map((project) => [project.documentId, project]))
    const thumbnails = new Map<string, ReturnType<typeof projectThumbnailRecordSchema.parse>>()
    let totalBytes = 0
    for (const record of records) {
      const thumbnail = projectThumbnailRecordSchema.safeParse(record)
      if (!thumbnail.success) return new Map<string, null>()
      const project = projectsById.get(thumbnail.data.documentId)
      if (!project || thumbnail.data.revision !== project.headRevision) continue
      totalBytes += thumbnail.data.bytes.byteLength
      if (totalBytes > MAX_LOCAL_PROJECT_THUMBNAIL_BYTES) return new Map<string, null>()
      thumbnails.set(thumbnail.data.documentId, thumbnail.data)
    }
    return thumbnails
  } catch {
    // Derived previews fail open so semantic project access remains available.
    return new Map<string, null>()
  }
}

export async function summarizeProjects(
  database: VibeShapeDatabase,
  projects: readonly ProjectCatalogRecord[],
): Promise<readonly LocalProjectSummary[]> {
  const thumbnails = await currentProjectThumbnails(database, projects)
  const summaries = projects.map((project) => {
    const thumbnail = thumbnails.get(project.documentId)
    return localProjectSummarySchema.parse({
      documentId: project.documentId,
      name: project.name,
      headRevision: project.headRevision,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      lastExternalBackupAt: project.lastExternalBackupAt,
      thumbnail: thumbnail
        ? {
            revision: thumbnail.revision,
            mediaType: thumbnail.mediaType,
            bytes: thumbnail.bytes,
            generatedAt: thumbnail.generatedAt,
          }
        : null,
    })
  })
  summaries.sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.documentId.localeCompare(right.documentId),
  )
  return summaries
}
