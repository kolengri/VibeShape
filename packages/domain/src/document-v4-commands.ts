import { z } from "zod"
import {
  applyCapturedAssemblyMutations,
  captureAssemblyMutations,
  emptyAssemblyAuthority,
  validateCapturedAssemblySources,
} from "./assembly-authority"
import { mergeCapturedAssemblyAssets } from "./assembly-pinned-insertion"
import { canonicalJson } from "./canonical-json"
import { type DomainDiagnostic, domainDiagnostic } from "./command-support"
import { createDocumentDependencyGraph } from "./document-graph"
import { type DocumentSnapshotV2, documentSnapshotV2Schema } from "./document-v2-schema"
import { sameOperationEnvelope } from "./document-v2-support"
import {
  applyDocumentV3Command,
  applyDocumentV3ModelEvent,
  reduceDocumentV3Event,
} from "./document-v3-commands"
import { type DocumentSnapshotV3, documentSnapshotV3Schema } from "./document-v3-schema"
import {
  type DocumentSnapshotV4,
  documentSnapshotV4Schema,
  projectDocumentSnapshotV4ToV3,
} from "./document-v4"
import {
  type DocumentV4Event,
  documentV4CommandSchema,
  documentV4EventSchema,
} from "./document-v4-command-schemas"
import { draftIdSchema } from "./identifiers"

export type DocumentV4Result =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV4 }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>
export type DocumentV4CommandResult =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV4; event: DocumentV4Event }>
  | Extract<DocumentV4Result, { ok: false }>

function invalid(
  message: string,
  code: DomainDiagnostic["code"] = "invalid-event",
): Extract<DocumentV4Result, { ok: false }> {
  return { ok: false, diagnostic: domainDiagnostic(code, message, code === "stale-revision") }
}
function content(snapshot: DocumentSnapshotV4) {
  const { revision: _revision, updatedAt: _updatedAt, ...value } = snapshot
  return value
}

function validateEnvelope(base: { id: string; revision: number }, event: DocumentV4Event) {
  if (base.id !== event.documentId)
    return invalid("The V4 event targets another document.", "document-id-mismatch")
  if (base.revision === Number.MAX_SAFE_INTEGER)
    return invalid("The revision cannot advance safely.", "revision-exhausted")
  if (base.revision !== event.baseRevision || event.revision !== base.revision + 1)
    return invalid("The V4 event does not extend its source revision.", "stale-revision")
  return null
}

function reduceAuthored(
  current: DocumentSnapshotV4,
  event: Extract<DocumentV4Event, { type: "org.vibeshape.document.authored-changed" }>,
): DocumentV4Result {
  if (
    !sameOperationEnvelope(event, event.authoredEvent) ||
    event.revision !== event.authoredEvent.revision ||
    event.transactionId !== event.authoredEvent.transactionId
  )
    return invalid("The authored event must share the V4 event provenance and revision.")
  if (
    event.authoredEvent.type === "org.vibeshape.document.restored" ||
    event.authoredEvent.type === "org.vibeshape.document.upgraded-v2" ||
    event.authoredEvent.type === "org.vibeshape.document.upgraded-v3"
  )
    return invalid("V4 restore and upgrade must preserve the whole authority.")
  const reduced = reduceDocumentV3Event(projectDocumentSnapshotV4ToV3(current), {
    ...event.authoredEvent,
    schemaVersion: 3,
  })
  return reduced.ok
    ? {
        ok: true,
        snapshot: {
          ...reduced.snapshot,
          schemaVersion: 4,
          assets: current.assets,
          assembly: current.assembly,
        },
      }
    : reduced
}

function historicalTarget(
  current: DocumentSnapshotV4,
  target: DocumentSnapshotV4,
  revision: number,
) {
  return (
    target.id === current.id &&
    target.createdAt === current.createdAt &&
    target.revision === revision &&
    target.revision < current.revision
  )
}
function restorable(snapshot: DocumentSnapshotV4) {
  const graph = createDocumentDependencyGraph(projectDocumentSnapshotV4ToV3(snapshot))
  return graph.ok && graph.graph.dependencyModelIssues.length === 0
}
function reduceRestore(
  current: DocumentSnapshotV4,
  event: Extract<DocumentV4Event, { type: "org.vibeshape.document.restored" }>,
  targetInput: unknown,
): DocumentV4Result {
  const target = z
    .union([documentSnapshotV2Schema, documentSnapshotV3Schema, documentSnapshotV4Schema])
    .safeParse(targetInput)
  if (!target.success || !historicalTarget(current, lift(target.data), event.targetRevision))
    return invalid("A V4 restore requires an earlier V4 revision of the same document.")
  if (!restorable(current) || !restorable(lift(target.data)))
    return invalid("V4 restore requires available feature dependency declarations.")
  if (canonicalJson(content(current)) === canonicalJson(content(lift(target.data))))
    return invalid("The V4 restore is a semantic no-op.", "command-no-op")
  return { ok: true, snapshot: lift(target.data) }
}
function reduceContent(
  current: DocumentSnapshotV4,
  event: DocumentV4Event,
  targetInput: unknown,
): DocumentV4Result {
  switch (event.type) {
    case "org.vibeshape.document.upgraded-v4":
      return invalid("An already upgraded document cannot be upgraded again.")
    case "org.vibeshape.document.source-assets-added":
      return { ok: true, snapshot: { ...current, assets: [...current.assets, ...event.assets] } }
    case "org.vibeshape.document.assembly-changed": {
      try {
        validateCapturedAssemblySources(current, current.assembly, event.changes)
        return {
          ok: true,
          snapshot: {
            ...current,
            assets: mergeCapturedAssemblyAssets(current, event.changes),
            assembly: applyCapturedAssemblyMutations(current.assembly, event.changes),
          },
        }
      } catch (error) {
        return invalid(error instanceof Error ? error.message : "The assembly mutation is invalid.")
      }
    }
    case "org.vibeshape.document.authored-changed":
      return reduceAuthored(current, event)
    case "org.vibeshape.document.restored":
      return reduceRestore(current, event, targetInput)
  }
}

/** Older event versions cannot mutate V4; translated authored changes carry the full V4 envelope. */
export function reduceDocumentV4Event(
  snapshotInput: unknown,
  eventInput: unknown,
  targetInput?: unknown,
): DocumentV4Result {
  const event = documentV4EventSchema.safeParse(eventInput)
  if (!event.success) return invalid("The V4 event is invalid.")
  const base =
    event.data.type === "org.vibeshape.document.upgraded-v4"
      ? documentSnapshotV3Schema.safeParse(snapshotInput)
      : documentSnapshotV4Schema.safeParse(snapshotInput)
  if (!base.success) return invalid("The V4 event does not match its source authority version.")
  const envelope = validateEnvelope(base.data, event.data)
  if (envelope) return envelope
  const reduced: DocumentV4Result =
    event.data.type === "org.vibeshape.document.upgraded-v4"
      ? {
          ok: true,
          snapshot: {
            ...base.data,
            schemaVersion: 4,
            assets: event.data.assets,
            assembly: emptyAssemblyAuthority(),
          },
        }
      : reduceContent(documentSnapshotV4Schema.parse(base.data), event.data, targetInput)
  if (!reduced.ok) return reduced
  const parsed = documentSnapshotV4Schema.safeParse({
    ...reduced.snapshot,
    revision: event.data.revision,
    updatedAt: event.data.issuedAt,
  })
  return parsed.success
    ? { ok: true, snapshot: parsed.data }
    : invalid("The V4 event violates document or source asset invariants.")
}

const optionsSchema = z.object({ transactionId: draftIdSchema.nullable().optional() }).strict()
export function applyDocumentV4Command(
  snapshot: unknown,
  input: unknown,
  optionsInput: unknown = {},
): DocumentV4CommandResult {
  const command = documentV4CommandSchema.safeParse(input)
  const options = optionsSchema.safeParse(optionsInput)
  if (!command.success || !options.success)
    return invalid("The V4 command is invalid.", "invalid-command")
  const { kind, payload, ...envelope } = command.data
  let captured: object
  try {
    if (kind === "org.vibeshape.document.upgrade-v4")
      captured = { type: "org.vibeshape.document.upgraded-v4", assets: [] }
    else if (kind === "org.vibeshape.document.add-source-assets")
      captured = { type: "org.vibeshape.document.source-assets-added", assets: payload.assets }
    else {
      const source = documentSnapshotV4Schema.parse(snapshot)
      captured = {
        type: "org.vibeshape.document.assembly-changed",
        changes: captureAssemblyMutations(source, source.assembly, payload.changes),
      }
    }
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "Assembly sources cannot be captured.",
      "invalid-command",
    )
  }
  const event = documentV4EventSchema.safeParse({
    ...envelope,
    transactionId: options.data.transactionId ?? null,
    revision: envelope.baseRevision + 1,
    ...captured,
  })
  if (!event.success)
    return invalid("The V4 event cannot advance its revision safely.", "revision-exhausted")
  const reduced = reduceDocumentV4Event(snapshot, event.data)
  return reduced.ok ? { ...reduced, event: event.data } : reduced
}

function lift(
  target: DocumentSnapshotV2 | DocumentSnapshotV3 | DocumentSnapshotV4,
): DocumentSnapshotV4 {
  if (target.schemaVersion === 4) return target
  return {
    ...target,
    schemaVersion: 4,
    surfaceTextures: target.schemaVersion === 3 ? target.surfaceTextures : [],
    assets: [],
    assembly: emptyAssemblyAuthority(),
  }
}
export function applyDocumentV4AuthoredCommand(
  snapshot: unknown,
  command: unknown,
  options: unknown = {},
): DocumentV4CommandResult {
  const current = documentSnapshotV4Schema.safeParse(snapshot)
  if (!current.success)
    return invalid("A V4 authored command requires source authority.", "invalid-command")
  const authored = applyDocumentV3Command(
    projectDocumentSnapshotV4ToV3(current.data),
    command,
    options,
  )
  return wrapAuthored(current.data, authored)
}
export function applyDocumentV4ModelEvent(
  snapshot: unknown,
  modelEvent: unknown,
  allocations: unknown,
): DocumentV4CommandResult {
  const current = documentSnapshotV4Schema.safeParse(snapshot)
  if (!current.success)
    return invalid("A V4 model operation requires source authority.", "invalid-command")
  return wrapAuthored(
    current.data,
    applyDocumentV3ModelEvent(projectDocumentSnapshotV4ToV3(current.data), modelEvent, allocations),
  )
}
function wrapAuthored(
  current: DocumentSnapshotV4,
  authored: ReturnType<typeof applyDocumentV3Command>,
): DocumentV4CommandResult {
  if (!authored.ok) return authored
  const { commandId, documentId, baseRevision, revision, issuedAt, actor, transactionId } =
    authored.event
  const event = documentV4EventSchema.parse({
    schemaVersion: 4,
    commandId,
    documentId,
    baseRevision,
    revision,
    issuedAt,
    actor,
    transactionId,
    type: "org.vibeshape.document.authored-changed",
    authoredEvent: authored.event,
  })
  const reduced = reduceDocumentV4Event(current, event)
  return reduced.ok ? { ...reduced, event } : reduced
}
