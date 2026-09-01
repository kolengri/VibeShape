import { z } from "zod"
import { type DomainDiagnostic, zodDiagnosticIssues } from "./command-support"
import {
  applyDocumentCommand,
  type DocumentCommand,
  type DocumentCommandOptions,
  type DocumentEvent,
  documentCommandSchema,
  documentEventSchema,
  reduceDocumentEvent,
} from "./commands"
import {
  type DocumentSnapshot,
  type DocumentSnapshotV1,
  documentSnapshotSchema,
  documentSnapshotV1Schema,
} from "./document"
import type { HistoryItemRef } from "./document-node"
import type { FeatureRecord, FeatureRecordV1 } from "./feature-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import {
  applyInsertFeatureInHistoryCommand,
  applyInsertSketchInHistoryCommand,
  featureInsertedInHistoryEventSchema,
  insertFeatureInHistoryCommandSchema,
  insertSketchInHistoryCommandSchema,
  reduceHistoryDocumentEvent,
  sketchInsertedInHistoryEventSchema,
} from "./history-document-commands"
import { draftIdSchema } from "./identifiers"
import {
  applyVersionedDestructiveCommand,
  reduceVersionedDestructiveEvent,
} from "./versioned-destructive-commands"

export const versionedDocumentCommandSchema = z.union([
  documentCommandSchema,
  insertSketchInHistoryCommandSchema,
  insertFeatureInHistoryCommandSchema,
])
export const versionedDocumentEventSchema = z.union([
  documentEventSchema,
  sketchInsertedInHistoryEventSchema,
  featureInsertedInHistoryEventSchema,
])

export type VersionedDocumentCommand = Readonly<z.infer<typeof versionedDocumentCommandSchema>>
export type VersionedDocumentEvent = Readonly<z.infer<typeof versionedDocumentEventSchema>>
export type VersionedDocumentEventResult =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV1 }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>
export type VersionedDocumentCommandResult =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV1; event: VersionedDocumentEvent }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

const versionedCommandOptionsSchema = z
  .object({ transactionId: draftIdSchema.nullable().optional() })
  .strict()

type BoundaryKind = "command" | "event"
type BoundaryFailure = Readonly<{ ok: false; diagnostic: DomainDiagnostic }>
type TransformationResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; message: string; issues: DomainDiagnostic["issues"] }>

function failure(
  code: DomainDiagnostic["code"],
  message: string,
  issues: DomainDiagnostic["issues"] = [],
): { ok: false; diagnostic: DomainDiagnostic } {
  return { ok: false, diagnostic: { code, message, retryable: false, issues } }
}

function invalid(kind: BoundaryKind, error: z.ZodError) {
  return failure(
    kind === "command" ? "invalid-command" : "invalid-event",
    `The versioned document ${kind} is invalid.`,
    zodDiagnosticIssues(error),
  )
}

function transformationFailure(
  kind: BoundaryKind,
  result: Readonly<{ ok: false; message: string; issues: DomainDiagnostic["issues"] }>,
) {
  return failure(
    kind === "command" ? "invalid-command" : "invalid-event",
    result.message,
    result.issues,
  )
}

function parseSnapshot(snapshot: DocumentSnapshotV1, kind: BoundaryKind) {
  const parsed = documentSnapshotV1Schema.safeParse(snapshot)
  return parsed.success ? ({ ok: true, value: parsed.data } as const) : invalid(kind, parsed.error)
}

function projectSnapshot(snapshot: DocumentSnapshotV1): TransformationResult<DocumentSnapshot> {
  const sketchesById = new Map(snapshot.sketches.map((sketch) => [sketch.id, sketch]))
  const featuresById = new Map(snapshot.features.map((feature) => [feature.id, feature]))
  const sketches = snapshot.history.flatMap((item) => {
    const sketch = item.kind === "sketch" ? sketchesById.get(item.id) : undefined
    return sketch ? [sketch] : []
  })
  const features = snapshot.history.flatMap((item) => {
    const feature = item.kind === "feature" ? featuresById.get(item.id) : undefined
    return feature ? [feature] : []
  })
  const { history: _history, ...withoutHistory } = snapshot
  const parsed = documentSnapshotSchema.safeParse({
    ...withoutHistory,
    schemaVersion: 0,
    sketches,
    features: features.map(({ semanticInputs: _semanticInputs, ...feature }) => ({
      ...feature,
      schemaVersion: 0,
    })),
  })
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        message: "The versioned document cannot be projected to the legacy reducer.",
        issues: zodDiagnosticIssues(parsed.error),
      }
}

function historyAfterLegacyEvent(
  history: readonly HistoryItemRef[],
  event: DocumentEvent,
): readonly HistoryItemRef[] {
  const removed =
    event.type === "org.vibeshape.sketch.removed"
      ? ({ kind: "sketch", id: event.sketch.id } as const)
      : event.type === "org.vibeshape.feature.removed" ||
          event.type === "org.vibeshape.feature.removed-preserving-model-reference-intent"
        ? ({ kind: "feature", id: event.feature.id } as const)
        : null
  return removed
    ? history.filter((item) => item.kind !== removed.kind || item.id !== removed.id)
    : history
}

function liftFeatures(
  features: DocumentSnapshot["features"],
  previous: DocumentSnapshotV1,
): TransformationResult<readonly FeatureRecordV1[]> {
  const previousById = new Map(previous.features.map((feature) => [feature.id, feature]))
  const lifted: FeatureRecordV1[] = []
  for (const feature of features) {
    const projection = projectFirstPartyFeatureSemanticInputs(feature)
    if (projection.recognized && !projection.ok)
      return {
        ok: false,
        message: projection.message,
        issues: [{ path: `features.${lifted.length}.parameters`, message: projection.message }],
      }
    const semanticInputs = projection.recognized
      ? projection.inputs
      : previousById.get(feature.id)?.semanticInputs
    if (semanticInputs === undefined)
      return {
        ok: false,
        message: "A new extension feature requires an explicit semantic-input declaration.",
        issues: [
          {
            path: `features.${lifted.length}.semanticInputs`,
            message: "The semantic-input declaration is unavailable.",
          },
        ],
      }
    lifted.push({
      ...feature,
      schemaVersion: 1,
      semanticInputs: semanticInputs ? [...semanticInputs] : semanticInputs,
    })
  }
  return { ok: true, value: lifted }
}

function liftSnapshot(
  snapshot: DocumentSnapshot,
  previous: DocumentSnapshotV1,
  event: DocumentEvent,
): TransformationResult<DocumentSnapshotV1> {
  const features = liftFeatures(snapshot.features, previous)
  if (!features.ok) return features
  const parsed = documentSnapshotV1Schema.safeParse({
    ...snapshot,
    schemaVersion: 1,
    features: features.value,
    history: historyAfterLegacyEvent(previous.history, event),
  })
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        message: "The legacy reduction cannot be lifted to a valid versioned document.",
        issues: zodDiagnosticIssues(parsed.error),
      }
}

function createV1Snapshot(snapshot: DocumentSnapshot): TransformationResult<DocumentSnapshotV1> {
  const parsed = documentSnapshotV1Schema.safeParse({
    ...snapshot,
    schemaVersion: 1,
    history: [],
    features: [],
  })
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        message: "Document creation did not produce a valid versioned document.",
        issues: zodDiagnosticIssues(parsed.error),
      }
}

function documentNotFound() {
  return failure("document-not-found", "The document does not exist.")
}

function legacyAddFailure(kind: BoundaryKind) {
  return failure(
    kind === "command" ? "invalid-command" : "invalid-event",
    `Legacy add ${kind}s require explicit History insertion intent.`,
  )
}

function unsafeFeatureUpdate(
  snapshot: DocumentSnapshotV1,
  featureId: string,
  nextFeature: FeatureRecord,
) {
  const current = snapshot.features.find(({ id }) => id === featureId)
  return current
    ? !projectFirstPartyFeatureSemanticInputs(current).recognized ||
        !projectFirstPartyFeatureSemanticInputs(nextFeature).recognized
    : false
}

function invalidOptions(error: z.ZodError) {
  const issues = zodDiagnosticIssues(error).map((issue) => ({
    ...issue,
    path: issue.path ? `options.${issue.path}` : "options",
  }))
  return failure("invalid-command", "The versioned command options are invalid.", issues)
}

function legacyCommandGuard(
  snapshot: DocumentSnapshotV1 | null,
  command: DocumentCommand,
): BoundaryFailure | null {
  if (command.kind === "org.vibeshape.sketch.add" || command.kind === "org.vibeshape.feature.add")
    return legacyAddFailure("command")
  if (
    command.kind === "org.vibeshape.feature.update" &&
    snapshot &&
    unsafeFeatureUpdate(snapshot, command.payload.feature.id, command.payload.feature)
  )
    return failure("invalid-command", "Unknown extension feature updates are unsafe.")
  return null
}

function legacyEventGuard(
  snapshot: DocumentSnapshotV1 | null,
  event: DocumentEvent,
): BoundaryFailure | null {
  if (event.type === "org.vibeshape.sketch.added" || event.type === "org.vibeshape.feature.added")
    return legacyAddFailure("event")
  if (
    event.type === "org.vibeshape.feature.updated" &&
    snapshot &&
    unsafeFeatureUpdate(snapshot, event.feature.id, event.feature)
  )
    return failure("invalid-event", "Unknown extension feature updates are unsafe.")
  return null
}

function projectOptionalSnapshot(
  snapshot: DocumentSnapshotV1 | null,
): TransformationResult<DocumentSnapshot | null> {
  return snapshot ? projectSnapshot(snapshot) : { ok: true, value: null }
}

function liftOptionalSnapshot(
  snapshot: DocumentSnapshotV1 | null,
  reduced: DocumentSnapshot,
  event: DocumentEvent,
) {
  return snapshot ? liftSnapshot(reduced, snapshot, event) : createV1Snapshot(reduced)
}

function applyLegacyCommand(
  snapshot: DocumentSnapshotV1 | null,
  command: DocumentCommand,
  options: DocumentCommandOptions,
): VersionedDocumentCommandResult {
  const guard = legacyCommandGuard(snapshot, command)
  if (guard) return guard
  if (snapshot) {
    const destructive = applyVersionedDestructiveCommand(snapshot, command, options)
    if (destructive) return destructive
  }
  const projected = projectOptionalSnapshot(snapshot)
  if (!projected.ok) return transformationFailure("command", projected)
  const result = applyDocumentCommand(projected.value, command, options)
  if (!result.ok) return result
  const lifted = liftOptionalSnapshot(snapshot, result.snapshot, result.event)
  return lifted.ok
    ? { ok: true, snapshot: lifted.value, event: result.event }
    : transformationFailure("command", lifted)
}

function applyHistoryCommand(
  snapshot: DocumentSnapshotV1 | null,
  command: VersionedDocumentCommand,
  options: DocumentCommandOptions,
): VersionedDocumentCommandResult | null {
  if (command.kind === "org.vibeshape.history.insert-sketch")
    return snapshot
      ? applyInsertSketchInHistoryCommand(snapshot, command, options)
      : documentNotFound()
  if (command.kind === "org.vibeshape.history.insert-feature")
    return snapshot
      ? applyInsertFeatureInHistoryCommand(snapshot, command, options)
      : documentNotFound()
  return null
}

export function applyVersionedDocumentCommand(
  snapshot: DocumentSnapshotV1 | null,
  input: unknown,
  options?: DocumentCommandOptions,
): VersionedDocumentCommandResult
export function applyVersionedDocumentCommand(
  snapshot: DocumentSnapshotV1 | null,
  input: unknown,
  options: unknown = {},
): VersionedDocumentCommandResult {
  const current = snapshot ? parseSnapshot(snapshot, "command") : null
  if (current && !current.ok) return current
  const parsed = versionedDocumentCommandSchema.safeParse(input)
  if (!parsed.success) return invalid("command", parsed.error)
  const parsedOptions = versionedCommandOptionsSchema.safeParse(options)
  if (!parsedOptions.success) return invalidOptions(parsedOptions.error)
  const normalizedOptions = { transactionId: parsedOptions.data.transactionId ?? null }
  const routed = applyHistoryCommand(current?.value ?? null, parsed.data, normalizedOptions)
  return (
    routed ??
    applyLegacyCommand(current?.value ?? null, parsed.data as DocumentCommand, normalizedOptions)
  )
}

function reduceLegacyEvent(
  snapshot: DocumentSnapshotV1 | null,
  event: DocumentEvent,
): VersionedDocumentEventResult {
  const guard = legacyEventGuard(snapshot, event)
  if (guard) return guard
  if (snapshot) {
    const destructive = reduceVersionedDestructiveEvent(snapshot, event)
    if (destructive) return destructive
  }
  const projected = projectOptionalSnapshot(snapshot)
  if (!projected.ok) return transformationFailure("event", projected)
  const reduced = reduceDocumentEvent(projected.value, event)
  if (!reduced.ok) return reduced
  const lifted = liftOptionalSnapshot(snapshot, reduced.snapshot, event)
  return lifted.ok ? { ok: true, snapshot: lifted.value } : transformationFailure("event", lifted)
}

export function reduceVersionedDocumentEvent(
  snapshot: DocumentSnapshotV1 | null,
  input: unknown,
): VersionedDocumentEventResult {
  const current = snapshot ? parseSnapshot(snapshot, "event") : null
  if (current && !current.ok) return current
  const parsed = versionedDocumentEventSchema.safeParse(input)
  if (!parsed.success) return invalid("event", parsed.error)
  if (
    parsed.data.type === "org.vibeshape.history.sketch-inserted" ||
    parsed.data.type === "org.vibeshape.history.feature-inserted"
  )
    return current ? reduceHistoryDocumentEvent(current.value, parsed.data) : documentNotFound()
  return reduceLegacyEvent(current?.value ?? null, parsed.data)
}

export function replayVersionedDocumentEvents(
  inputs: readonly unknown[],
): VersionedDocumentEventResult
export function replayVersionedDocumentEvents(
  seed: DocumentSnapshotV1 | null,
  inputs: readonly unknown[],
): VersionedDocumentEventResult
export function replayVersionedDocumentEvents(
  seedOrInputs: DocumentSnapshotV1 | null | readonly unknown[],
  suffix?: readonly unknown[],
): VersionedDocumentEventResult {
  const inputs = suffix ?? (seedOrInputs as readonly unknown[])
  let snapshot = suffix ? (seedOrInputs as DocumentSnapshotV1 | null) : null
  for (const input of inputs) {
    const result = reduceVersionedDocumentEvent(snapshot, input)
    if (!result.ok) return result
    snapshot = result.snapshot
  }
  return snapshot ? { ok: true, snapshot } : documentNotFound()
}
