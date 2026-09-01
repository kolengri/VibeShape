import { canonicalJson } from "./canonical-json"
import {
  documentGraphDiagnostic,
  domainDiagnostic,
  unavailableDependencyModelDiagnostic,
  zodDiagnosticIssues,
} from "./command-support"
import type {
  DocumentCommand,
  DocumentCommandOptions,
  DocumentEvent,
  DomainDiagnostic,
} from "./commands"
import { type DocumentSnapshotV1, documentSnapshotV1Schema } from "./document"
import { createDocumentDependencyGraph } from "./document-graph"
import type { DocumentNodeRef } from "./document-node"
import { type FeatureRecord, type FeatureRecordV1, featureRecordSchema } from "./feature-graph"
import {
  orphanModelReferencesToFeature,
  preservableModelReferenceSketchIds,
  unsupportedPreservingIntentBlockers,
} from "./feature-removal-intent"

type DestructiveCommand = Extract<
  DocumentCommand,
  {
    kind:
      | "org.vibeshape.sketch.remove"
      | "org.vibeshape.feature.remove"
      | "org.vibeshape.feature.remove-preserving-model-reference-intent"
  }
>
type DestructiveEvent = Extract<
  DocumentEvent,
  {
    type:
      | "org.vibeshape.sketch.removed"
      | "org.vibeshape.feature.removed"
      | "org.vibeshape.feature.removed-preserving-model-reference-intent"
  }
>
type VersionedDestructiveCommandResult =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV1; event: DestructiveEvent }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>
type VersionedDestructiveEventResult =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV1 }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

function failure(diagnostic: DomainDiagnostic) {
  return { ok: false, diagnostic } as const
}

function revisionDiagnostic(
  snapshot: DocumentSnapshotV1,
  input: Readonly<{ documentId: string; baseRevision: number; revision?: number }>,
) {
  if (snapshot.id !== input.documentId)
    return domainDiagnostic("document-id-mismatch", "The operation targets a different document.")
  if (input.baseRevision === Number.MAX_SAFE_INTEGER)
    return domainDiagnostic("revision-exhausted", "The document revision cannot advance safely.")
  if (
    snapshot.revision !== input.baseRevision ||
    (input.revision !== undefined && input.revision !== input.baseRevision + 1)
  )
    return domainDiagnostic(
      "stale-revision",
      "The operation does not extend the current document revision.",
      true,
    )
  return null
}

function completeGraph(snapshot: DocumentSnapshotV1, invalidEvent: boolean) {
  const graph = createDocumentDependencyGraph(snapshot)
  if (!graph.ok) return failure(documentGraphDiagnostic(graph.diagnostic, invalidEvent))
  if (graph.graph.dependencyModelIssues.length > 0)
    return failure(
      unavailableDependencyModelDiagnostic(graph.graph.dependencyModelIssues, invalidEvent),
    )
  return { ok: true, graph: graph.graph } as const
}

function dependencyBlockers(
  snapshot: DocumentSnapshotV1,
  target: DocumentNodeRef,
  preserveModelReferenceIntent: boolean,
  invalidEvent: boolean,
): VersionedDestructiveEventResult | null {
  const authority = completeGraph(snapshot, invalidEvent)
  if (!authority.ok) return authority
  const blockers = authority.graph.deletionBlockersFor(target)
  const preservable =
    preserveModelReferenceIntent && target.kind === "feature"
      ? preservableModelReferenceSketchIds(snapshot.sketches, target.id)
      : new Set<string>()
  const unsupported = unsupportedPreservingIntentBlockers(blockers, preservable)
  if (unsupported.length === 0) return null
  const noun = target.kind === "sketch" ? "Sketch" : "Feature"
  return failure({
    code: invalidEvent
      ? "invalid-event"
      : target.kind === "sketch"
        ? "sketch-in-use"
        : "feature-in-use",
    message: `${noun} ${target.id} has document dependents.`,
    retryable: false,
    issues: unsupported.slice(0, 8).map((blocker) => ({
      path: blocker.ownerPath,
      message: `Remove or retarget the ${blocker.relation} dependency before deleting the ${target.kind}.`,
    })),
  })
}

function legacyFeature(feature: FeatureRecordV1): FeatureRecord {
  const { semanticInputs: _semanticInputs, ...record } = feature
  return featureRecordSchema.parse({ ...record, schemaVersion: 0 })
}

function eventEnvelope(command: DestructiveCommand, options: DocumentCommandOptions) {
  return {
    schemaVersion: 1 as const,
    commandId: command.commandId,
    transactionId: options.transactionId ?? null,
    documentId: command.documentId,
    baseRevision: command.baseRevision,
    revision: command.baseRevision + 1,
    issuedAt: command.issuedAt,
    actor: command.actor,
  }
}

function createDestructiveEvent(
  snapshot: DocumentSnapshotV1,
  command: DestructiveCommand,
  options: DocumentCommandOptions,
): DestructiveEvent | DomainDiagnostic {
  const revision = revisionDiagnostic(snapshot, command)
  if (revision) return revision
  if (command.kind === "org.vibeshape.sketch.remove") {
    const sketch = snapshot.sketches.find(({ id }) => id === command.payload.sketchId)
    return sketch
      ? { ...eventEnvelope(command, options), type: "org.vibeshape.sketch.removed", sketch }
      : domainDiagnostic("sketch-not-found", "The sketch does not exist in the document.")
  }
  const feature = snapshot.features.find(({ id }) => id === command.payload.featureId)
  if (!feature)
    return domainDiagnostic("feature-not-found", "The feature does not exist in the document.")
  return {
    ...eventEnvelope(command, options),
    type:
      command.kind === "org.vibeshape.feature.remove"
        ? "org.vibeshape.feature.removed"
        : "org.vibeshape.feature.removed-preserving-model-reference-intent",
    feature: legacyFeature(feature),
  }
}

function eventTarget(event: DestructiveEvent): DocumentNodeRef {
  return event.type === "org.vibeshape.sketch.removed"
    ? { kind: "sketch", id: event.sketch.id }
    : { kind: "feature", id: event.feature.id }
}

function eventMatchesSnapshot(snapshot: DocumentSnapshotV1, event: DestructiveEvent) {
  if (event.type === "org.vibeshape.sketch.removed") {
    const sketch = snapshot.sketches.find(({ id }) => id === event.sketch.id)
    return sketch ? canonicalJson(sketch) === canonicalJson(event.sketch) : false
  }
  const feature = snapshot.features.find(({ id }) => id === event.feature.id)
  return feature ? canonicalJson(legacyFeature(feature)) === canonicalJson(event.feature) : false
}

function reducedSnapshot(snapshot: DocumentSnapshotV1, event: DestructiveEvent) {
  const target = eventTarget(event)
  const sketches =
    event.type === "org.vibeshape.sketch.removed"
      ? snapshot.sketches.filter(({ id }) => id !== event.sketch.id)
      : event.type === "org.vibeshape.feature.removed-preserving-model-reference-intent"
        ? snapshot.sketches.map((sketch) =>
            orphanModelReferencesToFeature(sketch, event.feature.id),
          )
        : snapshot.sketches
  const features =
    target.kind === "feature"
      ? snapshot.features.filter(({ id }) => id !== target.id)
      : snapshot.features
  return documentSnapshotV1Schema.safeParse({
    ...snapshot,
    revision: event.revision,
    sketches,
    features,
    history: snapshot.history.filter((item) => item.kind !== target.kind || item.id !== target.id),
    updatedAt: event.issuedAt,
  })
}

function reduceParsedDestructiveEvent(
  snapshot: DocumentSnapshotV1,
  event: DestructiveEvent,
  invalidEvent: boolean,
): VersionedDestructiveEventResult {
  const revision = revisionDiagnostic(snapshot, event)
  if (revision) return failure(revision)
  if (!eventMatchesSnapshot(snapshot, event))
    return failure(
      domainDiagnostic(
        invalidEvent ? "invalid-event" : "invalid-command",
        "The removal does not match the current document.",
      ),
    )
  const target = eventTarget(event)
  const blockers = dependencyBlockers(
    snapshot,
    target,
    event.type === "org.vibeshape.feature.removed-preserving-model-reference-intent",
    invalidEvent,
  )
  if (blockers) return blockers
  const parsed = reducedSnapshot(snapshot, event)
  return parsed.success
    ? { ok: true, snapshot: parsed.data }
    : failure({
        code: invalidEvent ? "invalid-event" : "invalid-command",
        message: "The removal produces an invalid versioned document.",
        retryable: false,
        issues: zodDiagnosticIssues(parsed.error),
      })
}

export function applyVersionedDestructiveCommand(
  snapshot: DocumentSnapshotV1,
  command: DocumentCommand,
  options: DocumentCommandOptions,
): VersionedDestructiveCommandResult | null {
  if (
    command.kind !== "org.vibeshape.sketch.remove" &&
    command.kind !== "org.vibeshape.feature.remove" &&
    command.kind !== "org.vibeshape.feature.remove-preserving-model-reference-intent"
  )
    return null
  const event = createDestructiveEvent(snapshot, command, options)
  if ("code" in event) return failure(event)
  const reduced = reduceParsedDestructiveEvent(snapshot, event, false)
  return reduced.ok ? { ...reduced, event } : reduced
}

export function reduceVersionedDestructiveEvent(
  snapshot: DocumentSnapshotV1,
  event: DocumentEvent,
): VersionedDestructiveEventResult | null {
  if (
    event.type !== "org.vibeshape.sketch.removed" &&
    event.type !== "org.vibeshape.feature.removed" &&
    event.type !== "org.vibeshape.feature.removed-preserving-model-reference-intent"
  )
    return null
  return reduceParsedDestructiveEvent(snapshot, event, true)
}
