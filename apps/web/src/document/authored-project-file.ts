import { copyCompleteDocumentAuthorityHistory } from "@vibeshape/domain/document-v2-copy"
import type { DocumentId, DraftId } from "@vibeshape/domain/identifiers"
import type { AuthoredVShapeProject } from "@vibeshape/formats/vshape"
import {
  type PortableProjectV2,
  type PortableProjectV3,
  portableProjectV3PayloadSchema,
} from "@vibeshape/persistence"
import { copyPortableProjectV2, portableProjectV2FromArchive } from "./versioned-project-file"

export type BrowserPortableProject =
  | Readonly<{ version: 2; project: PortableProjectV2 }>
  | Readonly<{ version: 3; project: PortableProjectV3 }>

type PortableResult =
  | Readonly<{ ok: true; value: BrowserPortableProject }>
  | Readonly<{ ok: false; diagnostic: Readonly<{ code: string; message: string }> }>

export function portableProjectFromArchive(archive: AuthoredVShapeProject): PortableResult {
  if (archive.version !== 3) {
    const converted = portableProjectV2FromArchive(archive)
    return converted.ok
      ? { ok: true, value: { version: 2, project: converted.project } }
      : converted
  }
  const { manifest, ...project } = archive.project
  return {
    ok: true,
    value: {
      version: 3,
      project: portableProjectV3PayloadSchema.parse({
        ...project,
        historyMode: manifest.historyMode,
        promotionRevision: manifest.promotionRevision,
        upgradeRevision: manifest.upgradeRevision,
        migrationDiagnostic: manifest.migrationDiagnostic,
        unavailableRecords: manifest.unavailableRecords,
      }),
    },
  }
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

function copyAuthoredProject(input: CopyInput, source: PortableProjectV3): PortableResult {
  if (source.historyMode !== "complete" || source.seed?.schemaVersion === 2)
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
  return {
    ok: true,
    value: {
      version: 3,
      project: portableProjectV3PayloadSchema.parse({
        snapshot: copied.snapshot,
        seed: copied.seed,
        legacyEvents: copied.legacyEvents,
        versionedEvents: copied.versionedEvents,
        historyMode: "complete",
        promotionRevision: source.promotionRevision,
        upgradeRevision: source.upgradeRevision,
        migrationDiagnostic: null,
        unavailableRecords: [],
      }),
    },
  }
}
