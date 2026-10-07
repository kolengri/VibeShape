import { copyCompleteDocumentAuthorityHistory } from "@vibeshape/domain/document-v2-copy"
import type { DocumentId, DraftId } from "@vibeshape/domain/identifiers"
import type { AuthoredVShapeProject } from "@vibeshape/formats/vshape"
import {
  type PortableProjectV2,
  type PortableProjectV3,
  type PortableProjectV4,
  type PortableProjectV5,
  type PortableProjectV6,
  portableProjectV3PayloadSchema,
  portableProjectV4PayloadSchema,
  portableProjectV5PayloadSchema,
  portableProjectV6PayloadSchema,
} from "@vibeshape/persistence"
import { copyPortableProjectV2, portableProjectV2FromArchive } from "./versioned-project-file"

export type BrowserPortableProject =
  | Readonly<{ version: 2; project: PortableProjectV2 }>
  | Readonly<{ version: 3; project: PortableProjectV3 }>
  | Readonly<{ version: 4; project: PortableProjectV4 }>
  | Readonly<{ version: 5; project: PortableProjectV5 }>
  | Readonly<{ version: 6; project: PortableProjectV6 }>

type PortableResult =
  | Readonly<{ ok: true; value: BrowserPortableProject }>
  | Readonly<{ ok: false; diagnostic: Readonly<{ code: string; message: string }> }>

export function portableProjectFromArchive(archive: AuthoredVShapeProject): PortableResult {
  if (
    archive.version !== 3 &&
    archive.version !== 4 &&
    archive.version !== 5 &&
    archive.version !== 6
  ) {
    const converted = portableProjectV2FromArchive(archive)
    return converted.ok
      ? { ok: true, value: { version: 2, project: converted.project } }
      : converted
  }
  const { manifest, ...project } = archive.project
  const value = {
    ...project,
    historyMode: manifest.historyMode,
    promotionRevision: manifest.promotionRevision,
    upgradeRevision: manifest.upgradeRevision,
    ...(archive.version === 4 || archive.version === 5 || archive.version === 6
      ? { textureUpgradeRevision: archive.project.manifest.textureUpgradeRevision }
      : {}),
    ...(archive.version === 5 || archive.version === 6
      ? { sourceUpgradeRevision: archive.project.manifest.sourceUpgradeRevision }
      : {}),
    ...(archive.version === 6
      ? { repairUpgradeRevision: archive.project.manifest.repairUpgradeRevision }
      : {}),
    migrationDiagnostic: manifest.migrationDiagnostic,
    unavailableRecords: manifest.unavailableRecords,
  }
  return archive.version === 6
    ? { ok: true, value: { version: 6, project: portableProjectV6PayloadSchema.parse(value) } }
    : archive.version === 5
      ? { ok: true, value: { version: 5, project: portableProjectV5PayloadSchema.parse(value) } }
      : archive.version === 4
        ? { ok: true, value: { version: 4, project: portableProjectV4PayloadSchema.parse(value) } }
        : { ok: true, value: { version: 3, project: portableProjectV3PayloadSchema.parse(value) } }
}

type CopyInput = {
  source: BrowserPortableProject
  documentId: DocumentId
  name: string
  issuedAt: string
  nextCommandId: () => string
  nextTransactionId: () => DraftId
}

export function copyBrowserPortableProject(input: CopyInput): PortableResult {
  if (input.source.version === 2) {
    const copied = copyPortableProjectV2({ ...input, source: input.source.project })
    return copied.ok ? { ok: true, value: { version: 2, project: copied.project } } : copied
  }
  return copyAuthoredProject(input, input.source.project)
}

function copyAuthoredProject(
  input: CopyInput,
  source: PortableProjectV3 | PortableProjectV4 | PortableProjectV5 | PortableProjectV6,
): PortableResult {
  if (source.historyMode !== "complete" || (source.seed && source.seed.schemaVersion !== 1))
    return {
      ok: false,
      diagnostic: {
        code: "checkpoint-read-only",
        message: "A checkpoint project cannot be opened as a writable copy.",
      },
    }
  const events = [...source.legacyEvents, ...source.versionedEvents]
  const transactions = new Set(
    events.flatMap((event) => (event.transactionId ? [event.transactionId] : [])),
  )
  const copied = copyCompleteDocumentAuthorityHistory({
    sourceLegacyEvents: source.legacyEvents,
    sourceSeed: source.seed,
    sourceSnapshot: source.snapshot,
    sourceEvents: source.versionedEvents,
    documentId: input.documentId,
    commandIds: Array.from({ length: events.length + 1 }, input.nextCommandId),
    transactionIds: Array.from(transactions, (source) => ({
      source,
      target: input.nextTransactionId(),
    })),
    name: input.name,
    issuedAt: input.issuedAt,
    actor: { type: "user", userId: null },
  })
  if (!copied.ok) return copied
  return copiedPortableProject(source, copied)
}

function copiedPortableProject(
  source: PortableProjectV3 | PortableProjectV4 | PortableProjectV5 | PortableProjectV6,
  copied: Extract<ReturnType<typeof copyCompleteDocumentAuthorityHistory>, { ok: true }>,
): PortableResult {
  const payload = {
    snapshot: copied.snapshot,
    seed: copied.seed,
    legacyEvents: copied.legacyEvents,
    versionedEvents: copied.versionedEvents,
    historyMode: "complete",
    promotionRevision: source.promotionRevision,
    upgradeRevision: source.upgradeRevision,
    ...("textureUpgradeRevision" in source
      ? { textureUpgradeRevision: source.textureUpgradeRevision }
      : {}),
    ...("sourceUpgradeRevision" in source
      ? {
          sourceUpgradeRevision: source.sourceUpgradeRevision,
          assetBlobs: source.assetBlobs.map(({ digest, bytes }) => ({
            digest,
            bytes: Uint8Array.from(bytes),
          })),
        }
      : {}),
    ...("repairUpgradeRevision" in source
      ? { repairUpgradeRevision: source.repairUpgradeRevision }
      : {}),
    migrationDiagnostic: null,
    unavailableRecords: [],
  }
  return source.snapshot.schemaVersion === 5
    ? { ok: true, value: { version: 6, project: portableProjectV6PayloadSchema.parse(payload) } }
    : source.snapshot.schemaVersion === 4
      ? { ok: true, value: { version: 5, project: portableProjectV5PayloadSchema.parse(payload) } }
      : source.snapshot.schemaVersion === 3
        ? {
            ok: true,
            value: { version: 4, project: portableProjectV4PayloadSchema.parse(payload) },
          }
        : {
            ok: true,
            value: { version: 3, project: portableProjectV3PayloadSchema.parse(payload) },
          }
}
