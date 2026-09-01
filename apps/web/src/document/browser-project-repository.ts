import type { DocumentId } from "@vibeshape/domain"
import {
  LocalDocumentRepository,
  VersionedLocalDocumentRepository,
  type VibeShapeDatabase,
} from "@vibeshape/persistence"
import { portableProjectV2FromLegacyProject } from "./versioned-project-file"

export class BrowserProjectRepository {
  readonly legacy: LocalDocumentRepository
  readonly versioned: VersionedLocalDocumentRepository

  constructor(database: VibeShapeDatabase) {
    this.legacy = new LocalDocumentRepository(database)
    this.versioned = new VersionedLocalDocumentRepository(database)
  }

  listProjects() {
    return this.versioned.listProjects()
  }

  async exportPortableProjectV2(documentId: DocumentId) {
    const versioned = await this.versioned.exportPortableProjectV2(documentId)
    if (versioned.ok || versioned.diagnostic.code !== "document-not-found") return versioned
    const legacy = await this.legacy.exportPortableProject(documentId)
    if (!legacy.ok) return legacy
    const converted = portableProjectV2FromLegacyProject(legacy.value.snapshot, legacy.value.events)
    return converted.ok
      ? { ok: true as const, value: converted.project }
      : {
          ok: false as const,
          diagnostic: { ...converted.diagnostic, retryable: false },
        }
  }

  importPortableProjectV2(
    input: Parameters<VersionedLocalDocumentRepository["importPortableProjectV2"]>[0],
  ) {
    return this.versioned.importPortableProjectV2(input)
  }

  copyPortableProjectV2(
    input: Parameters<VersionedLocalDocumentRepository["copyPortableProjectV2"]>[0],
  ) {
    return this.versioned.copyPortableProjectV2(input)
  }

  writeProjectThumbnail(
    input: Parameters<VersionedLocalDocumentRepository["writeProjectThumbnail"]>[0],
  ) {
    return this.versioned.writeProjectThumbnail(input)
  }

  copyProjectThumbnail(
    input: Parameters<VersionedLocalDocumentRepository["copyProjectThumbnail"]>[0],
  ) {
    return this.versioned.copyProjectThumbnail(input)
  }

  deleteProject(input: Parameters<VersionedLocalDocumentRepository["deleteProject"]>[0]) {
    return this.versioned.deleteProject(input)
  }
}
