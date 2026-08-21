import type { z } from "zod"
import { canonicalJson } from "./canonical-json"
import {
  domainDiagnostic,
  requireExistingDocumentRevision,
  zodDiagnosticIssues,
} from "./command-support"
import type {
  DocumentCommand,
  DocumentEvent,
  DocumentEventResult,
  DomainDiagnostic,
} from "./commands"
import { documentSnapshotSchema, type DocumentSnapshot } from "./document"
import type { draftIdSchema } from "./identifiers"
import { readExtrusionFeatureParameters } from "./part-design"
import { type SketchRecord, sketchRecordSchema } from "./sketch"

type SketchCommand = Extract<
  DocumentCommand,
  {
    kind: "org.vibeshape.sketch.add" | "org.vibeshape.sketch.update" | "org.vibeshape.sketch.remove"
  }
>
type SketchAddedEvent = Extract<DocumentEvent, { type: "org.vibeshape.sketch.added" }>
type SketchUpdatedEvent = Extract<DocumentEvent, { type: "org.vibeshape.sketch.updated" }>
type SketchRemovedEvent = Extract<DocumentEvent, { type: "org.vibeshape.sketch.removed" }>
type SketchEvent = SketchAddedEvent | SketchUpdatedEvent | SketchRemovedEvent
type TransactionId = z.infer<typeof draftIdSchema> | null

function sketchesEqual(left: SketchRecord, right: SketchRecord) {
  return canonicalJson(left) === canonicalJson(right)
}

function sketchHasExternalDependents(snapshot: DocumentSnapshot, sketchId: string) {
  return snapshot.sketches.some((sketch) =>
    (sketch.externalReferences ?? []).some((reference) => reference.sourceSketchId === sketchId),
  )
}

function invalidSketchCollection(error: z.ZodError): DomainDiagnostic {
  return {
    code: "invalid-sketch",
    message: "The sketch collection is invalid.",
    retryable: false,
    issues: zodDiagnosticIssues(error),
  }
}

function parseSketches(snapshot: DocumentSnapshot, sketches: readonly SketchRecord[]) {
  const parsed = documentSnapshotSchema.safeParse({ ...snapshot, sketches })
  return parsed.success
    ? ({ ok: true, sketches: parsed.data.sketches } as const)
    : ({ ok: false, diagnostic: invalidSketchCollection(parsed.error) } as const)
}

function reduceAddedEvent(
  snapshot: DocumentSnapshot | null,
  event: SketchAddedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )
  if (!current.ok) return current
  if (current.snapshot.sketches.some((sketch) => sketch.id === event.sketch.id)) {
    return {
      ok: false,
      diagnostic: domainDiagnostic("invalid-event", "The added sketch already exists."),
    }
  }
  const next = parseSketches(current.snapshot, [...current.snapshot.sketches, event.sketch])
  return next.ok
    ? {
        ok: true,
        snapshot: {
          ...current.snapshot,
          revision: event.revision,
          sketches: next.sketches,
          updatedAt: event.issuedAt,
        },
      }
    : { ok: false, diagnostic: { ...next.diagnostic, code: "invalid-event" } }
}

function reduceUpdatedEvent(
  snapshot: DocumentSnapshot | null,
  event: SketchUpdatedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )
  if (!current.ok) return current
  const index = current.snapshot.sketches.findIndex(
    (sketch) => sketch.id === event.previousSketch.id,
  )
  const previous = current.snapshot.sketches[index]
  if (
    index < 0 ||
    event.sketch.id !== event.previousSketch.id ||
    !previous ||
    !sketchesEqual(previous, event.previousSketch) ||
    sketchesEqual(event.previousSketch, event.sketch)
  ) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "The sketch update event does not match the current document.",
      ),
    }
  }
  const sketches = [...current.snapshot.sketches]
  sketches[index] = event.sketch
  const next = parseSketches(current.snapshot, sketches)
  return next.ok
    ? {
        ok: true,
        snapshot: {
          ...current.snapshot,
          revision: event.revision,
          sketches: next.sketches,
          updatedAt: event.issuedAt,
        },
      }
    : { ok: false, diagnostic: { ...next.diagnostic, code: "invalid-event" } }
}

function reduceRemovedEvent(
  snapshot: DocumentSnapshot | null,
  event: SketchRemovedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )
  if (!current.ok) return current
  const previous = current.snapshot.sketches.find((sketch) => sketch.id === event.sketch.id)
  if (!previous || !sketchesEqual(previous, event.sketch)) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "The sketch removal event does not match the current document.",
      ),
    }
  }
  if (
    current.snapshot.features.some(
      (feature) => readExtrusionFeatureParameters(feature)?.profile.sketchId === event.sketch.id,
    )
  ) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "A sketch referenced by an extrusion cannot be removed.",
      ),
    }
  }
  if (sketchHasExternalDependents(current.snapshot, event.sketch.id)) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "A sketch referenced by external sketch geometry cannot be removed.",
      ),
    }
  }
  return {
    ok: true,
    snapshot: {
      ...current.snapshot,
      revision: event.revision,
      sketches: current.snapshot.sketches.filter((sketch) => sketch.id !== event.sketch.id),
      updatedAt: event.issuedAt,
    },
  }
}

export function reduceSketchDocumentEvent(
  snapshot: DocumentSnapshot | null,
  event: SketchEvent,
): DocumentEventResult {
  switch (event.type) {
    case "org.vibeshape.sketch.added":
      return reduceAddedEvent(snapshot, event)
    case "org.vibeshape.sketch.updated":
      return reduceUpdatedEvent(snapshot, event)
    case "org.vibeshape.sketch.removed":
      return reduceRemovedEvent(snapshot, event)
  }
}

function eventEnvelope(command: SketchCommand, transactionId: TransactionId) {
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
  command: Extract<SketchCommand, { kind: "org.vibeshape.sketch.add" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireExistingDocumentRevision(
    snapshot,
    command.documentId,
    command.baseRevision,
  )
  if (!current.ok) return current.diagnostic
  if (current.snapshot.sketches.some((sketch) => sketch.id === command.payload.sketch.id)) {
    return domainDiagnostic(
      "sketch-already-exists",
      `Sketch ${command.payload.sketch.id} already exists in the document.`,
    )
  }
  const next = parseSketches(current.snapshot, [
    ...current.snapshot.sketches,
    command.payload.sketch,
  ])
  return next.ok
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.sketch.added",
        sketch: sketchRecordSchema.parse(command.payload.sketch),
      }
    : next.diagnostic
}

function createUpdatedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<SketchCommand, { kind: "org.vibeshape.sketch.update" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireExistingDocumentRevision(
    snapshot,
    command.documentId,
    command.baseRevision,
  )
  if (!current.ok) return current.diagnostic
  const previous = current.snapshot.sketches.find(
    (sketch) => sketch.id === command.payload.sketch.id,
  )
  if (!previous) {
    return domainDiagnostic(
      "sketch-not-found",
      `Sketch ${command.payload.sketch.id} does not exist in the document.`,
    )
  }
  if (sketchesEqual(previous, command.payload.sketch)) {
    return domainDiagnostic("command-no-op", "The sketch already has the requested state.")
  }
  const sketches = current.snapshot.sketches.map((sketch) =>
    sketch.id === command.payload.sketch.id ? command.payload.sketch : sketch,
  )
  const next = parseSketches(current.snapshot, sketches)
  return next.ok
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.sketch.updated",
        previousSketch: sketchRecordSchema.parse(previous),
        sketch: sketchRecordSchema.parse(command.payload.sketch),
      }
    : next.diagnostic
}

function createRemovedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<SketchCommand, { kind: "org.vibeshape.sketch.remove" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireExistingDocumentRevision(
    snapshot,
    command.documentId,
    command.baseRevision,
  )
  if (!current.ok) return current.diagnostic
  const sketch = current.snapshot.sketches.find(
    (candidate) => candidate.id === command.payload.sketchId,
  )
  if (
    sketch &&
    current.snapshot.features.some(
      (feature) => readExtrusionFeatureParameters(feature)?.profile.sketchId === sketch.id,
    )
  ) {
    return domainDiagnostic(
      "sketch-in-use",
      `Sketch ${sketch.id} is referenced by an extrusion feature.`,
    )
  }
  if (sketch && sketchHasExternalDependents(current.snapshot, sketch.id)) {
    return domainDiagnostic(
      "sketch-in-use",
      `Sketch ${sketch.id} is referenced by external sketch geometry.`,
    )
  }
  return sketch
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.sketch.removed",
        sketch: sketchRecordSchema.parse(sketch),
      }
    : domainDiagnostic(
        "sketch-not-found",
        `Sketch ${command.payload.sketchId} does not exist in the document.`,
      )
}

export function createSketchDocumentEvent(
  snapshot: DocumentSnapshot | null,
  command: SketchCommand,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  switch (command.kind) {
    case "org.vibeshape.sketch.add":
      return createAddedEvent(snapshot, command, transactionId)
    case "org.vibeshape.sketch.update":
      return createUpdatedEvent(snapshot, command, transactionId)
    case "org.vibeshape.sketch.remove":
      return createRemovedEvent(snapshot, command, transactionId)
  }
}
