type AuthoredDocumentSnapshot = DocumentSnapshotV2 | DocumentSnapshotV3

import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import { type DomainDiagnostic, domainDiagnostic } from "./command-support"
import { createDocumentDependencyGraph } from "./document-graph"
import {
  type DocumentSnapshotV2,
  type DocumentSnapshotV3,
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
  projectDocumentSnapshotV3ToV2,
} from "./document-v2"
import {
  type DocumentV3Command,
  type DocumentV3Event,
  documentV3CommandSchema,
  documentV3EventSchema,
  type replaceSurfaceTextureLayersSchema,
} from "./document-v2-command-schemas"
import {
  applyDocumentV2Command,
  applyDocumentV2ModelEvent,
  reduceDocumentV2Event,
} from "./document-v2-commands"
import { sameOperationEnvelope } from "./document-v2-support"
import { draftIdSchema } from "./identifiers"

export type DocumentV3Result =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV3 }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>
export type DocumentV3CommandResult =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV3; event: DocumentV3Event }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

function invalid(
  message: string,
  code: DomainDiagnostic["code"] = "invalid-event",
): Extract<DocumentV3Result, { ok: false }> {
  return { ok: false, diagnostic: domainDiagnostic(code, message, code === "stale-revision") }
}

function envelopeIssue(snapshot: AuthoredDocumentSnapshot, event: DocumentV3Event) {
  if (snapshot.id !== event.documentId)
    return invalid("The operation targets a different document.", "document-id-mismatch")
  if (snapshot.revision === Number.MAX_SAFE_INTEGER)
    return invalid("The document revision cannot advance safely.", "revision-exhausted")
  if (event.baseRevision !== snapshot.revision || event.revision !== snapshot.revision + 1)
    return invalid("The operation does not extend the current document revision.", "stale-revision")
  return null
}

function content(snapshot: AuthoredDocumentSnapshot) {
  const { revision: _revision, updatedAt: _updatedAt, ...rest } = snapshot
  return rest
}

function replaceLayers(
  snapshot: DocumentSnapshotV3,
  change: z.infer<typeof replaceSurfaceTextureLayersSchema>,
): DocumentV3Result {
  if (!snapshot.features.some((feature) => feature.id === change.featureId))
    return invalid("The textured feature does not exist.")
  const first = snapshot.surfaceTextures.findIndex((layer) => layer.featureId === change.featureId)
  const retained = snapshot.surfaceTextures.filter((layer) => layer.featureId !== change.featureId)
  const insertion = first < 0 ? retained.length : first
  const surfaceTextures = [
    ...retained.slice(0, insertion),
    ...change.layers,
    ...retained.slice(insertion),
  ]
  return { ok: true, snapshot: { ...snapshot, surfaceTextures } }
}

function lift(snapshot: AuthoredDocumentSnapshot): DocumentSnapshotV3 {
  return snapshot.schemaVersion === 3
    ? snapshot
    : { ...snapshot, schemaVersion: 3, surfaceTextures: [] }
}

function historicalTarget(
  current: DocumentSnapshotV3,
  target: AuthoredDocumentSnapshot,
  revision: number,
): boolean {
  return (
    target.id === current.id &&
    target.createdAt === current.createdAt &&
    target.revision === revision &&
    target.revision >= 1 &&
    target.revision < current.revision
  )
}

function restore(
  snapshot: DocumentSnapshotV3,
  event: Extract<DocumentV3Event, { type: "org.vibeshape.document.restored" }>,
  input: unknown,
): DocumentV3Result {
  const target = z.union([documentSnapshotV2Schema, documentSnapshotV3Schema]).safeParse(input)
  if (!target.success || !historicalTarget(snapshot, target.data, event.targetRevision))
    return invalid(
      "The texture restore target must be an earlier authored revision of the same document.",
    )
  for (const candidate of [snapshot, target.data]) {
    const graph = createDocumentDependencyGraph(candidate)
    if (!graph.ok || graph.graph.dependencyModelIssues.length)
      return invalid("Restore requires available feature dependency declarations.")
  }
  return {
    ok: true,
    snapshot: { ...lift(target.data), revision: event.revision, updatedAt: event.issuedAt },
  }
}

function reduceV3Edit(
  snapshot: DocumentSnapshotV3,
  event: DocumentV3Event,
  target: unknown,
): DocumentV3Result {
  if (event.type === "org.vibeshape.document.restored") return restore(snapshot, event, target)
  if (
    event.type === "org.vibeshape.document.metadata-changed" &&
    event.change.kind === "textures.replace-layers"
  )
    return replaceLayers(snapshot, event.change)
  const v2 = reduceDocumentV2Event(projectDocumentSnapshotV3ToV2(snapshot), {
    ...event,
    schemaVersion: 2,
  })
  if (!v2.ok) return v2
  const features = new Set(v2.snapshot.features.map((feature) => feature.id))
  return {
    ok: true,
    snapshot: {
      ...v2.snapshot,
      schemaVersion: 3,
      surfaceTextures: snapshot.surfaceTextures.filter((layer) => features.has(layer.featureId)),
    },
  }
}

function reduceV3Operation(
  snapshot: AuthoredDocumentSnapshot,
  event: DocumentV3Event,
  target: unknown,
): DocumentV3Result {
  if (event.type === "org.vibeshape.document.upgraded-v3") {
    if (snapshot.schemaVersion !== 2)
      return invalid("An already upgraded document cannot be upgraded again.")
    return event.change
      ? replaceLayers(lift(snapshot), event.change)
      : { ok: true, snapshot: lift(snapshot) }
  }
  return snapshot.schemaVersion === 3
    ? reduceV3Edit(snapshot, event, target)
    : invalid("A V3 edit requires an upgraded document.")
}

/** V2 authority is upgraded with its first texture change in one durable event. */
export function reduceDocumentV3Event(
  snapshotInput: unknown,
  eventInput: unknown,
  restoreTarget?: unknown,
): DocumentV3Result {
  const snapshot = z
    .union([documentSnapshotV2Schema, documentSnapshotV3Schema])
    .safeParse(snapshotInput)
  const event = documentV3EventSchema.safeParse(eventInput)
  if (!snapshot.success || !event.success)
    return invalid("The V3 document snapshot or event is invalid.")
  const issue = envelopeIssue(snapshot.data, event.data)
  if (issue) return issue
  const reduced = reduceV3Operation(snapshot.data, event.data, restoreTarget)
  if (!reduced.ok) return reduced
  if (canonicalJson(content(snapshot.data)) === canonicalJson(content(reduced.snapshot)))
    return invalid("The V3 operation is a semantic no-op.", "command-no-op")
  const next = documentSnapshotV3Schema.safeParse({
    ...reduced.snapshot,
    revision: event.data.revision,
    updatedAt: event.data.issuedAt,
  })
  return next.success
    ? { ok: true, snapshot: next.data }
    : invalid("The operation produces invalid texture authority.")
}

const commandOptionsSchema = z
  .object({ transactionId: draftIdSchema.nullable().optional() })
  .strict()

export function applyDocumentV3ModelEvent(
  snapshotInput: unknown,
  modelEvent: unknown,
  allocations: unknown,
): DocumentV3CommandResult {
  const snapshot = documentSnapshotV3Schema.safeParse(snapshotInput)
  if (!snapshot.success)
    return invalid("A V3 model operation requires upgraded authority.", "invalid-command")
  const v2 = applyDocumentV2ModelEvent(
    projectDocumentSnapshotV3ToV2(snapshot.data),
    modelEvent,
    allocations,
  )
  if (!v2.ok) return v2
  const event = documentV3EventSchema.parse({ ...v2.event, schemaVersion: 3 })
  const reduced = reduceDocumentV3Event(snapshot.data, event)
  return reduced.ok ? { ...reduced, event } : reduced
}

function applyV3ModelCommand(
  snapshot: AuthoredDocumentSnapshot,
  command: Extract<DocumentV3Command, { kind: "org.vibeshape.document.model-command" }>,
  transactionId: z.infer<typeof draftIdSchema> | null,
): DocumentV3CommandResult {
  if (snapshot.schemaVersion !== 3 || !sameOperationEnvelope(command, command.payload.command))
    return invalid(
      "The model command requires V3 authority and matching provenance.",
      "invalid-command",
    )
  const applied = applyDocumentV2Command(
    projectDocumentSnapshotV3ToV2(snapshot),
    { ...command, schemaVersion: 2 },
    { transactionId },
  )
  if (!applied.ok) return applied
  const event = documentV3EventSchema.parse({ ...applied.event, schemaVersion: 3 })
  const reduced = reduceDocumentV3Event(snapshot, event)
  return reduced.ok ? { ...reduced, event } : reduced
}

function metadataEventChange(
  snapshot: AuthoredDocumentSnapshot,
  command: Exclude<DocumentV3Command, { kind: "org.vibeshape.document.model-command" }>,
) {
  if (command.kind === "org.vibeshape.document.upgrade-v3")
    return { type: "org.vibeshape.document.upgraded-v3", change: command.payload.change }
  if (snapshot.schemaVersion === 2 && command.payload.kind === "textures.replace-layers")
    return { type: "org.vibeshape.document.upgraded-v3", change: command.payload }
  return { type: "org.vibeshape.document.metadata-changed", change: command.payload }
}

export function applyDocumentV3Command(
  snapshotInput: unknown,
  commandInput: unknown,
  optionsInput: unknown = {},
): DocumentV3CommandResult {
  const snapshot = z
    .union([documentSnapshotV2Schema, documentSnapshotV3Schema])
    .safeParse(snapshotInput)
  const command = documentV3CommandSchema.safeParse(commandInput)
  const options = commandOptionsSchema.safeParse(optionsInput)
  if (!snapshot.success || !command.success || !options.success)
    return invalid("The V3 command or source snapshot is invalid.", "invalid-command")
  const transactionId = options.data.transactionId ?? null
  if (command.data.kind === "org.vibeshape.document.model-command")
    return applyV3ModelCommand(snapshot.data, command.data, transactionId)
  const { kind: _kind, payload: _payload, ...envelope } = command.data
  const parsed = documentV3EventSchema.safeParse({
    ...envelope,
    transactionId,
    revision: envelope.baseRevision + 1,
    ...metadataEventChange(snapshot.data, command.data),
  })
  if (!parsed.success)
    return invalid("The V3 command revision cannot advance safely.", "revision-exhausted")
  const reduced = reduceDocumentV3Event(snapshot.data, parsed.data)
  return reduced.ok ? { ...reduced, event: parsed.data } : reduced
}

export type { DocumentV3Command, DocumentV3Event } from "./document-v2-command-schemas"
