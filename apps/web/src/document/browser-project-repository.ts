import type { DocumentId } from "@vibeshape/domain"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import type { DocumentSnapshotV4 } from "@vibeshape/domain/document-v4"
import type { DocumentSnapshotV5 } from "@vibeshape/domain/document-v5"
import { commandIdSchema } from "@vibeshape/domain/identifiers"
import type { SourceAssetBlob } from "@vibeshape/domain/source-assets"
import {
  LocalDocumentRepository,
  VersionedLocalDocumentRepository,
  type VibeShapeDatabase,
} from "@vibeshape/persistence"
import type { BrowserPortableProject } from "./authored-project-file"
import {
  materializeAssemblySourceAssets,
  materializeDocumentSourceAssets,
} from "./source-assets-rebuild"
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

  materializeSourceAssets(documentId: DocumentId, features: readonly { parameters: unknown }[]) {
    return materializeDocumentSourceAssets(
      this.#database,
      async () => {
        const recovered = await this.versioned.recoverAuthority(documentId)
        if (!recovered.ok) throw new Error(recovered.diagnostic.message)
        return recovered.value.snapshot
      },
      features,
    )
  }

  materializeCapturedSourceAssets(authority: DocumentAuthoritySnapshot) {
    return materializeDocumentSourceAssets(
      this.#database,
      async () => authority,
      authority.features,
    )
  }

  materializeAssemblySourceAssets(
    authority: DocumentSnapshotV4 | DocumentSnapshotV5,
    ownedBlobs: readonly SourceAssetBlob[] = [],
  ) {
    return materializeAssemblySourceAssets(this.#database, authority, ownedBlobs)
  }

  async hasCommandId(input: string) {
    const commandId = commandIdSchema.parse(input)
    const counts = await Promise.all([
      this.#database.events.where("commandId").equals(commandId).count(),
      this.#database.eventsV1.where("commandId").equals(commandId).count(),
    ])
    return counts.some((count) => count > 0)
  }

  listProjects(options?: Parameters<VersionedLocalDocumentRepository["listProjects"]>[0]) {
    return this.versioned.listProjects(options)
  }

  async exportPortableProject(documentId: DocumentId) {
    const recovered = await this.versioned.recoverAuthority(documentId)
    if (recovered.ok && recovered.value.snapshot.schemaVersion !== 1) {
      return this.#exportAuthoredProject(documentId, recovered.value.snapshot.schemaVersion)
    }
    if (!recovered.ok && recovered.diagnostic.code !== "document-not-found") return recovered
    const exported = await this.exportPortableProjectV2(documentId)
    return exported.ok
      ? { ok: true as const, value: { version: 2 as const, project: exported.value } }
      : exported
  }

  async #exportAuthoredProject(documentId: DocumentId, version: 2 | 3 | 4 | 5) {
    const exported =
      version === 5
        ? await this.versioned.exportPortableProjectV6(documentId)
        : version === 4
          ? await this.versioned.exportPortableProjectV5(documentId)
          : version === 3
            ? await this.versioned.exportPortableProjectV4(documentId)
            : await this.versioned.exportPortableProjectV3(documentId)
    if (!exported.ok) return exported
    return "repairUpgradeRevision" in exported.value
      ? { ok: true as const, value: { version: 6 as const, project: exported.value } }
      : "sourceUpgradeRevision" in exported.value
        ? { ok: true as const, value: { version: 5 as const, project: exported.value } }
        : "textureUpgradeRevision" in exported.value
          ? { ok: true as const, value: { version: 4 as const, project: exported.value } }
          : { ok: true as const, value: { version: 3 as const, project: exported.value } }
  }

  copyPortableProject(source: BrowserPortableProject, copiedAt: string) {
    if (source.version === 6)
      return this.versioned.copyPortableProjectV6({ ...source.project, copiedAt })
    if (source.version === 5)
      return this.versioned.copyPortableProjectV5({ ...source.project, copiedAt })
    if (source.version === 4)
      return this.versioned.copyPortableProjectV4({ ...source.project, copiedAt })
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
