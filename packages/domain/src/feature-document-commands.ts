import type { z } from "zod"
import {
  domainDiagnostic,
  featureMutationDiagnostic,
  requireExistingDocumentRevision,
} from "./command-support"
import type {
  DocumentCommand,
  DocumentEvent,
  DocumentEventResult,
  DomainDiagnostic,
} from "./commands"
import type { DocumentSnapshot } from "./document"
import {
  addFeature,
  featureRecordsEqual,
  removeFeature,
  setFeatureSuppressed,
  updateFeature,
} from "./feature-collection"
import { type FeatureRecord, featureRecordSchema } from "./feature-graph"
import type { draftIdSchema } from "./identifiers"

type FeatureCommand = Extract<
  DocumentCommand,
  {
    kind:
      | "org.vibeshape.feature.add"
      | "org.vibeshape.feature.update"
      | "org.vibeshape.feature.remove"
      | "org.vibeshape.feature.set-suppressed"
  }
>
type FeatureAddedEvent = Extract<DocumentEvent, { type: "org.vibeshape.feature.added" }>
type FeatureUpdatedEvent = Extract<DocumentEvent, { type: "org.vibeshape.feature.updated" }>
type FeatureRemovedEvent = Extract<DocumentEvent, { type: "org.vibeshape.feature.removed" }>
type FeatureSuppressionChangedEvent = Extract<
  DocumentEvent,
  { type: "org.vibeshape.feature.suppression-changed" }
>
type FeatureEvent =
  | FeatureAddedEvent
  | FeatureUpdatedEvent
  | FeatureRemovedEvent
  | FeatureSuppressionChangedEvent
type TransactionId = z.infer<typeof draftIdSchema> | null

function featureSupportsSketch(snapshot: DocumentSnapshot, featureId: FeatureRecord["id"]) {
  return snapshot.sketches.some(({ support }) => support?.reference.featureId === featureId)
}

function reduceAddedEvent(
  snapshot: DocumentSnapshot | null,
  event: FeatureAddedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )

  if (!current.ok) return current

  const mutation = addFeature(current.snapshot.features, event.feature)

  return mutation.ok
    ? {
        ok: true,
        snapshot: {
          ...current.snapshot,
          revision: event.revision,
          features: mutation.features,
          updatedAt: event.issuedAt,
        },
      }
    : { ok: false, diagnostic: featureMutationDiagnostic(mutation.diagnostic, true) }
}

function reduceUpdatedEvent(
  snapshot: DocumentSnapshot | null,
  event: FeatureUpdatedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )

  if (!current.ok) return current

  const previous = current.snapshot.features.find(
    (feature) => feature.id === event.previousFeature.id,
  )
  if (
    event.feature.id !== event.previousFeature.id ||
    !previous ||
    !featureRecordsEqual(previous, event.previousFeature) ||
    featureRecordsEqual(event.previousFeature, event.feature)
  ) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "The feature update event does not match the current document.",
      ),
    }
  }

  const mutation = updateFeature(current.snapshot.features, event.feature)

  return mutation.ok
    ? {
        ok: true,
        snapshot: {
          ...current.snapshot,
          revision: event.revision,
          features: mutation.features,
          updatedAt: event.issuedAt,
        },
      }
    : { ok: false, diagnostic: featureMutationDiagnostic(mutation.diagnostic, true) }
}

function reduceRemovedEvent(
  snapshot: DocumentSnapshot | null,
  event: FeatureRemovedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )

  if (!current.ok) return current

  const feature = current.snapshot.features.find((candidate) => candidate.id === event.feature.id)
  if (!feature || !featureRecordsEqual(feature, event.feature)) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "The feature removal event does not match the current document.",
      ),
    }
  }
  if (featureSupportsSketch(current.snapshot, event.feature.id)) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "A feature supporting an existing sketch cannot be removed.",
      ),
    }
  }

  const mutation = removeFeature(current.snapshot.features, event.feature.id)

  return mutation.ok
    ? {
        ok: true,
        snapshot: {
          ...current.snapshot,
          revision: event.revision,
          features: mutation.features,
          updatedAt: event.issuedAt,
        },
      }
    : { ok: false, diagnostic: featureMutationDiagnostic(mutation.diagnostic, true) }
}

function reduceSuppressionChangedEvent(
  snapshot: DocumentSnapshot | null,
  event: FeatureSuppressionChangedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )

  if (!current.ok) return current

  const feature = current.snapshot.features.find((candidate) => candidate.id === event.featureId)
  if (
    !feature ||
    feature.suppressed !== event.previousSuppressed ||
    event.previousSuppressed === event.suppressed
  ) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "The feature suppression event does not match the current document.",
      ),
    }
  }

  const mutation = setFeatureSuppressed(
    current.snapshot.features,
    event.featureId,
    event.suppressed,
  )

  return mutation.ok
    ? {
        ok: true,
        snapshot: {
          ...current.snapshot,
          revision: event.revision,
          features: mutation.features,
          updatedAt: event.issuedAt,
        },
      }
    : { ok: false, diagnostic: featureMutationDiagnostic(mutation.diagnostic, true) }
}

export function reduceFeatureDocumentEvent(
  snapshot: DocumentSnapshot | null,
  event: FeatureEvent,
): DocumentEventResult {
  switch (event.type) {
    case "org.vibeshape.feature.added":
      return reduceAddedEvent(snapshot, event)
    case "org.vibeshape.feature.updated":
      return reduceUpdatedEvent(snapshot, event)
    case "org.vibeshape.feature.removed":
      return reduceRemovedEvent(snapshot, event)
    case "org.vibeshape.feature.suppression-changed":
      return reduceSuppressionChangedEvent(snapshot, event)
  }
}

function eventEnvelope(command: FeatureCommand, transactionId: TransactionId) {
  return {
    schemaVersion: 1 as const,
    commandId: command.commandId,
    transactionId,
    documentId: command.documentId,
    baseRevision: command.baseRevision,
    revision: command.baseRevision + 1,
    issuedAt: command.issuedAt,
    actor: command.actor,
  }
}

function createAddedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<FeatureCommand, { kind: "org.vibeshape.feature.add" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireExistingDocumentRevision(
    snapshot,
    command.documentId,
    command.baseRevision,
  )

  if (!current.ok) return current.diagnostic

  const mutation = addFeature(current.snapshot.features, command.payload.feature)

  return mutation.ok
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.feature.added",
        feature: command.payload.feature,
      }
    : featureMutationDiagnostic(mutation.diagnostic)
}

function createUpdatedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<FeatureCommand, { kind: "org.vibeshape.feature.update" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireExistingDocumentRevision(
    snapshot,
    command.documentId,
    command.baseRevision,
  )

  if (!current.ok) return current.diagnostic

  const previous = current.snapshot.features.find(
    (feature) => feature.id === command.payload.feature.id,
  )
  if (!previous) {
    return domainDiagnostic(
      "feature-not-found",
      `Feature ${command.payload.feature.id} does not exist in the document.`,
    )
  }
  if (featureRecordsEqual(previous, command.payload.feature)) {
    return domainDiagnostic("command-no-op", "The feature already has the requested state.")
  }

  const mutation = updateFeature(current.snapshot.features, command.payload.feature)

  return mutation.ok
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.feature.updated",
        previousFeature: featureRecordSchema.parse(previous),
        feature: command.payload.feature,
      }
    : featureMutationDiagnostic(mutation.diagnostic)
}

function createRemovedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<FeatureCommand, { kind: "org.vibeshape.feature.remove" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireExistingDocumentRevision(
    snapshot,
    command.documentId,
    command.baseRevision,
  )

  if (!current.ok) return current.diagnostic

  const feature = current.snapshot.features.find(
    (candidate) => candidate.id === command.payload.featureId,
  )
  if (!feature) {
    return domainDiagnostic(
      "feature-not-found",
      `Feature ${command.payload.featureId} does not exist in the document.`,
    )
  }
  if (featureSupportsSketch(current.snapshot, command.payload.featureId)) {
    return domainDiagnostic(
      "feature-in-use",
      `Feature ${command.payload.featureId} supports an existing sketch.`,
    )
  }

  const mutation = removeFeature(current.snapshot.features, command.payload.featureId)

  return mutation.ok
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.feature.removed",
        feature: featureRecordSchema.parse(feature),
      }
    : featureMutationDiagnostic(mutation.diagnostic)
}

function createSuppressionChangedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<FeatureCommand, { kind: "org.vibeshape.feature.set-suppressed" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireExistingDocumentRevision(
    snapshot,
    command.documentId,
    command.baseRevision,
  )

  if (!current.ok) return current.diagnostic

  const feature: FeatureRecord | undefined = current.snapshot.features.find(
    (candidate) => candidate.id === command.payload.featureId,
  )
  if (!feature) {
    return domainDiagnostic(
      "feature-not-found",
      `Feature ${command.payload.featureId} does not exist in the document.`,
    )
  }
  if (feature.suppressed === command.payload.suppressed) {
    return domainDiagnostic(
      "command-no-op",
      "The feature already has the requested suppression state.",
    )
  }

  const mutation = setFeatureSuppressed(
    current.snapshot.features,
    command.payload.featureId,
    command.payload.suppressed,
  )

  return mutation.ok
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.feature.suppression-changed",
        featureId: command.payload.featureId,
        previousSuppressed: feature.suppressed,
        suppressed: command.payload.suppressed,
      }
    : featureMutationDiagnostic(mutation.diagnostic)
}

export function createFeatureDocumentEvent(
  snapshot: DocumentSnapshot | null,
  command: FeatureCommand,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  switch (command.kind) {
    case "org.vibeshape.feature.add":
      return createAddedEvent(snapshot, command, transactionId)
    case "org.vibeshape.feature.update":
      return createUpdatedEvent(snapshot, command, transactionId)
    case "org.vibeshape.feature.remove":
      return createRemovedEvent(snapshot, command, transactionId)
    case "org.vibeshape.feature.set-suppressed":
      return createSuppressionChangedEvent(snapshot, command, transactionId)
  }
}
