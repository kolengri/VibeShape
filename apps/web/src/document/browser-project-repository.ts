import type { DocumentId } from "@vibeshape/domain"
import { commandIdSchema } from "@vibeshape/domain/identifiers"
import {
  LocalDocumentRepository,
  VersionedLocalDocumentRepository,
  type VibeShapeDatabase,
} from "@vibeshape/persistence"
import type { BrowserPortableProject } from "./authored-project-file"
import { portableProjectV2FromLegacyProject } from "./versioned-project-file"

export class BrowserProjectRepository {
  readonly #database: VibeShapeDatabase
  readonly legacy: LocalDocumentRepository
  readonly versioned: VersionedLocalDocumentRepository

  constructor(database: VibeShapeDatabase) {
    this.#database = database
    this.legacy = new LocalDocumentRepository(database)
    this.versioned = new VersionedLocalDocumentRepository(database)
  }

  async hasCommandId(input: string) {
    const commandId = commandIdSchema.parse(input)
    const counts = await Promise.all([
      this.#database.events.where("commandId").equals(commandId).count(),
      this.#database.eventsV1.where("commandId").equals(commandId).count(),
    ])
    return counts.some((count) => count > 0)
  }

  listProjects() {
    return this.versioned.listProjects()
  }

  async exportPortableProject(documentId: DocumentId) {
    const recovered = await this.versioned.recoverAuthority(documentId)
    if (recovered.ok && recovered.value.snapshot.schemaVersion === 2) {
      const exported = await this.versioned.exportPortableProjectV3(documentId)
      return exported.ok
        ? { ok: true as const, value: { version: 3 as const, project: exported.value } }
        : exported
    }
    if (!recovered.ok && recovered.diagnostic.code !== "document-not-found") return recovered
    const exported = await this.exportPortableProjectV2(documentId)
    return exported.ok
      ? { ok: true as const, value: { version: 2 as const, project: exported.value } }
      : exported
  }

  copyPortableProject(source: BrowserPortableProject, copiedAt: string) {
    return source.version === 3
      ? this.versioned.copyPortableProjectV3({ ...source.project, copiedAt })
      : this.versioned.copyPortableProjectV2({ ...source.project, copiedAt })
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
