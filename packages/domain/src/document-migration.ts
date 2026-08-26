import { canonicalJson } from "./canonical-json"
import { type DocumentEvent, documentEventSchema, replayDocumentEvents } from "./commands"
import {
  type DocumentSnapshot,
  type DocumentSnapshotV1,
  documentSnapshotSchema,
  documentSnapshotV1Schema,
} from "./document"
import {
  createDocumentDependencyGraph,
  deriveLegacyHistory,
  deriveLegacyHistoryWithPreferredOrder,
} from "./document-graph"
import type { HistoryItemRef } from "./document-node"
import { type FeatureRecord, type FeatureRecordV1, featureRecordV1Schema } from "./feature-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"

const MAX_LEGACY_EVENTS = 100_000

export type MigrationProvenance = "current" | "journal-derived" | "snapshot-derived"
export type DocumentMigrationDiagnostic = Readonly<{
  code: string
  message: string
}>
export type DocumentMigrationResult =
  | Readonly<{
      ok: true
      snapshot: DocumentSnapshotV1
      provenance: MigrationProvenance
      diagnostic?: DocumentMigrationDiagnostic
    }>
  | Readonly<{ ok: false; diagnostic: DocumentMigrationDiagnostic }>

type JournalHistoryResult =
  | Readonly<{ ok: true; history: readonly HistoryItemRef[] }>
  | Readonly<{ ok: false; message: string }>

function migrateFeature(feature: FeatureRecord): FeatureRecordV1 | DocumentMigrationDiagnostic {
  const projection = projectFirstPartyFeatureSemanticInputs(feature)
  if (projection.recognized && !projection.ok)
    return { code: "invalid-first-party-feature", message: projection.message }
  const parsed = featureRecordV1Schema.safeParse({
    ...feature,
    schemaVersion: 1,
    semanticInputs: projection.recognized ? projection.inputs : null,
  })
  return parsed.success
    ? parsed.data
    : {
        code: "invalid-migration",
        message: parsed.error.issues[0]?.message ?? "The migrated feature is invalid.",
      }
}

function migrateFeatures(
  features: readonly FeatureRecord[],
):
  | Readonly<{ ok: true; features: readonly FeatureRecordV1[] }>
  | Readonly<{ ok: false; diagnostic: DocumentMigrationDiagnostic }> {
  const migrated: FeatureRecordV1[] = []
  for (const feature of features) {
    const result = migrateFeature(feature)
    if (!("schemaVersion" in result)) return { ok: false, diagnostic: result }
    migrated.push(result)
  }
  return { ok: true, features: migrated }
}

function removeHistoryItem(history: HistoryItemRef[], ref: HistoryItemRef) {
  const index = history.findIndex((item) => item.kind === ref.kind && item.id === ref.id)
  if (index < 0) return false
  history.splice(index, 1)
  return true
}

function updateJournalHistory(history: HistoryItemRef[], event: DocumentEvent) {
  if (event.type === "org.vibeshape.sketch.added") {
    history.push({ kind: "sketch", id: event.sketch.id })
    return true
  }
  if (event.type === "org.vibeshape.feature.added") {
    history.push({ kind: "feature", id: event.feature.id })
    return true
  }
  if (event.type === "org.vibeshape.sketch.removed")
    return removeHistoryItem(history, { kind: "sketch", id: event.sketch.id })
  if (event.type === "org.vibeshape.feature.removed")
    return removeHistoryItem(history, { kind: "feature", id: event.feature.id })
  return true
}

function parseCompleteJournal(events: readonly unknown[], snapshot: DocumentSnapshot) {
  if (events.length === 0 || events.length > MAX_LEGACY_EVENTS) return null
  const parsed: DocumentEvent[] = []
  let previousRevision = 0
  for (const input of events) {
    const event = documentEventSchema.safeParse(input)
    if (
      !event.success ||
      event.data.documentId !== snapshot.id ||
      event.data.baseRevision !== previousRevision ||
      event.data.revision !== previousRevision + 1
    )
      return null
    parsed.push(event.data)
    previousRevision = event.data.revision
  }
  return previousRevision === snapshot.revision ? parsed : null
}

function deriveJournalHistory(
  events: readonly unknown[],
  snapshot: DocumentSnapshot,
): JournalHistoryResult {
  const parsed = parseCompleteJournal(events, snapshot)
  if (!parsed) return { ok: false, message: "The legacy journal is incomplete or invalid." }
  const replayed = replayDocumentEvents(parsed)
  if (!replayed.ok || canonicalJson(replayed.snapshot) !== canonicalJson(snapshot))
    return { ok: false, message: "The legacy journal does not reproduce the selected snapshot." }
  const preferredHistory: HistoryItemRef[] = []
  for (const event of parsed)
    if (!updateJournalHistory(preferredHistory, event))
      return { ok: false, message: "The legacy journal removes an unavailable History item." }
  const stabilized = deriveLegacyHistoryWithPreferredOrder(snapshot, preferredHistory)
  return stabilized.ok
    ? { ok: true, history: stabilized.history }
    : { ok: false, message: stabilized.diagnostic.message }
}

function migrationFailure(diagnostic: DocumentMigrationDiagnostic): DocumentMigrationResult {
  return { ok: false, diagnostic }
}

function migrateLegacySnapshot(
  source: DocumentSnapshot,
  events?: readonly unknown[],
): DocumentMigrationResult {
  const fallback = deriveLegacyHistory(source)
  if (!fallback.ok) return migrationFailure(fallback.diagnostic)
  const journal = events
    ? deriveJournalHistory(events, source)
    : { ok: false as const, message: "The legacy journal was not provided." }
  const features = migrateFeatures(source.features)
  if (!features.ok) return migrationFailure(features.diagnostic)
  const migrated = documentSnapshotV1Schema.safeParse({
    ...source,
    schemaVersion: 1,
    features: features.features,
    history: journal.ok ? journal.history : fallback.history,
  })
  if (!migrated.success)
    return migrationFailure({
      code: "invalid-migration",
      message: migrated.error.issues[0]?.message ?? "The migrated document is invalid.",
    })
  return journal.ok
    ? { ok: true, snapshot: migrated.data, provenance: "journal-derived" }
    : {
        ok: true,
        snapshot: migrated.data,
        provenance: "snapshot-derived",
        diagnostic: {
          code: "legacy-journal-unavailable",
          message: `${journal.message} History was derived from the selected snapshot.`,
        },
      }
}

export function migrateDocumentSnapshot(
  input: unknown,
  events?: readonly unknown[],
): DocumentMigrationResult {
  const current = documentSnapshotV1Schema.safeParse(input)
  if (current.success) {
    const graph = createDocumentDependencyGraph(current.data)
    return graph.ok
      ? { ok: true, snapshot: current.data, provenance: "current" }
      : migrationFailure(graph.diagnostic)
  }
  const legacy = documentSnapshotSchema.safeParse(input)
  return legacy.success
    ? migrateLegacySnapshot(legacy.data, events)
    : migrationFailure({ code: "invalid-snapshot", message: "Document snapshot is invalid." })
}

export function canonicalMigratedSnapshot(input: unknown, events?: readonly unknown[]) {
  const result = migrateDocumentSnapshot(input, events)
  return result.ok ? canonicalJson(result.snapshot) : null
}
