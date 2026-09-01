import {
  copyCompleteVersionedDocumentHistory,
  type DocumentEvent,
  type DocumentId,
  type DocumentSnapshot,
  type DraftId,
  migrateDocumentSnapshot,
} from "@vibeshape/domain"
import type { VersionedVShapeProject } from "@vibeshape/formats/vshape"
import type { PortableProjectV2 } from "@vibeshape/persistence"

type ProjectFileDiagnostic = Readonly<{ code: string; message: string }>

export type PortableProjectConversionResult =
  | Readonly<{ ok: true; project: PortableProjectV2; exportedAt: string }>
  | Readonly<{ ok: false; diagnostic: ProjectFileDiagnostic }>

type PortableProjectResult =
  | Readonly<{ ok: true; project: PortableProjectV2 }>
  | Readonly<{ ok: false; diagnostic: ProjectFileDiagnostic }>

export function portableProjectV2FromLegacyProject(
  snapshot: DocumentSnapshot,
  events: readonly DocumentEvent[],
): PortableProjectResult {
  const migrated = migrateDocumentSnapshot(snapshot, events)
  if (!migrated.ok) return { ok: false, diagnostic: migrated.diagnostic }
  if (migrated.provenance !== "journal-derived" || migrated.diagnostic) {
    return {
      ok: false,
      diagnostic: {
        code: "history-mismatch",
        message: "The legacy project does not contain a complete migration journal.",
      },
    }
  }
  return {
    ok: true,
    project: {
      snapshot: migrated.snapshot,
      seed: migrated.snapshot,
      legacyEvents: events,
      versionedEvents: [],
      historyMode: "complete",
      promotionRevision: migrated.snapshot.revision,
      migrationDiagnostic: null,
      unavailableRecords: [],
    },
  }
}

export function portableProjectV2FromArchive(
  archive: VersionedVShapeProject,
): PortableProjectConversionResult {
  if (archive.version === 2) {
    const { manifest, ...project } = archive.project
    return {
      ok: true,
      project: {
        ...project,
        historyMode: manifest.historyMode,
        promotionRevision: manifest.promotionRevision,
        migrationDiagnostic: manifest.migrationDiagnostic,
        unavailableRecords: manifest.unavailableRecords,
      },
      exportedAt: manifest.exportedAt,
    }
  }

  if (archive.version === 1) {
    const { events, manifest, snapshot } = archive.project
    return {
      ok: true,
      project: {
        snapshot,
        seed: snapshot,
        legacyEvents: events,
        versionedEvents: [],
        historyMode: "complete",
        promotionRevision: snapshot.revision,
        migrationDiagnostic: null,
        unavailableRecords: [],
      },
      exportedAt: manifest.exportedAt,
    }
  }

  const { events, manifest, snapshot } = archive.project
  const project = portableProjectV2FromLegacyProject(snapshot, events)
  return project.ok ? { ...project, exportedAt: manifest.exportedAt } : project
}

export type PortableProjectCopyResult =
  | Readonly<{ ok: true; project: PortableProjectV2 }>
  | Readonly<{ ok: false; diagnostic: ProjectFileDiagnostic }>

export function copyPortableProjectV2(input: {
  source: PortableProjectV2
  documentId: DocumentId
  name: string
  issuedAt: string
  nextCommandId: () => string
  nextTransactionId: () => DraftId
}): PortableProjectCopyResult {
  if (input.source.historyMode !== "complete") {
    return {
      ok: false,
      diagnostic: {
        code: "invalid-input",
        message: "A checkpoint project cannot be copied as a writable local project.",
      },
    }
  }
  const sourceEvents = [...input.source.legacyEvents, ...input.source.versionedEvents]
  const sourceTransactionIds = Array.from(
    new Set(
      sourceEvents.flatMap(({ transactionId }) => (transactionId === null ? [] : [transactionId])),
    ),
  )
  const copied = copyCompleteVersionedDocumentHistory({
    sourceLegacyEvents: input.source.legacyEvents,
    sourceSeed: input.source.seed,
    sourceSnapshot: input.source.snapshot,
    sourceEvents: input.source.versionedEvents,
    documentId: input.documentId,
    commandIds: Array.from({ length: sourceEvents.length + 1 }, input.nextCommandId),
    transactionIds: sourceTransactionIds.map((source) => ({
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
    project: {
      snapshot: copied.snapshot,
      seed: copied.seed,
      legacyEvents: copied.legacyEvents,
      versionedEvents: copied.versionedEvents,
      historyMode: "complete",
      promotionRevision: copied.seed?.revision ?? 0,
      migrationDiagnostic: null,
      unavailableRecords: [],
    },
  }
}
