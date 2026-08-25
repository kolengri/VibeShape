import { z } from "zod"
import {
  type DomainDiagnostic,
  domainDiagnostic as diagnostic,
  documentGraphDiagnostic,
  requireExistingDocumentRevision,
  unavailableDependencyModelDiagnostic,
  zodDiagnosticIssues,
} from "./command-support"
import {
  type DocumentSnapshot,
  defaultDocumentDisplayUnits,
  documentDisplayUnitsSchema,
  documentNameInputSchema,
  documentNameSchema,
} from "./document"
import { createDocumentDependencyGraphFromSnapshot } from "./document-graph"
import { createFeatureDocumentEvent, reduceFeatureDocumentEvent } from "./feature-document-commands"
import { featureRecordSchema } from "./feature-graph"
import {
  commandIdSchema,
  documentIdSchema,
  draftIdSchema,
  featureIdSchema,
  revisionSchema,
  sessionIdSchema,
  sketchIdSchema,
  technicalIdentifierSchema,
  timestampSchema,
  variableIdSchema,
} from "./identifiers"
import { sketchRecordSchema } from "./sketch"
import { createSketchDocumentEvent, reduceSketchDocumentEvent } from "./sketch-document-commands"
import {
  createVariableDocumentEvent,
  reduceVariableDocumentEvent,
} from "./variable-document-commands"
import {
  variableDefinitionSchema,
  variableDefinitionsSchema,
  variableExpressionSchema,
  variableNameSchema,
} from "./variables"

const sha256Pattern = /^[0-9a-f]{64}$/

const userActorSchema = z
  .object({
    type: z.literal("user"),
    userId: technicalIdentifierSchema.nullable(),
  })
  .strict()

const mcpActorSchema = z
  .object({
    type: z.literal("mcp"),
    clientId: technicalIdentifierSchema,
    sessionId: sessionIdSchema,
  })
  .strict()

const extensionActorSchema = z
  .object({
    type: z.literal("extension"),
    extensionId: technicalIdentifierSchema,
    integrity: z.string().regex(sha256Pattern, "Extension integrity must be a SHA-256 digest."),
  })
  .strict()

const systemActorSchema = z
  .object({
    type: z.literal("system"),
    source: technicalIdentifierSchema,
  })
  .strict()

export const commandActorSchema = z.discriminatedUnion("type", [
  userActorSchema,
  mcpActorSchema,
  extensionActorSchema,
  systemActorSchema,
])

const commandEnvelopeSchema = z
  .object({
    commandId: commandIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()

const createDocumentCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.create"),
  schemaVersion: z.literal(1),
  payload: z.object({ name: documentNameInputSchema }).strict(),
})

const renameDocumentCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.rename"),
  schemaVersion: z.literal(1),
  payload: z.object({ name: documentNameInputSchema }).strict(),
})

const setDocumentDisplayUnitsCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.set-display-units"),
  schemaVersion: z.literal(1),
  payload: z.object({ displayUnits: documentDisplayUnitsSchema }).strict(),
})

const addVariableCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.variable.add"),
  schemaVersion: z.literal(1),
  payload: z.object({ variable: variableDefinitionSchema }).strict(),
})

const setVariableExpressionCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.variable.set-expression"),
  schemaVersion: z.literal(1),
  payload: z
    .object({ variableId: variableIdSchema, expression: variableExpressionSchema })
    .strict(),
})

const renameVariableCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.variable.rename"),
  schemaVersion: z.literal(1),
  payload: z.object({ variableId: variableIdSchema, name: variableNameSchema }).strict(),
})

const removeVariableCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.variable.remove"),
  schemaVersion: z.literal(1),
  payload: z.object({ variableId: variableIdSchema }).strict(),
})

const replaceVariableTableCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.variable.replace-table"),
  schemaVersion: z.literal(1),
  payload: z.object({ variables: variableDefinitionsSchema }).strict(),
})

const addSketchCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.sketch.add"),
  schemaVersion: z.literal(1),
  payload: z.object({ sketch: sketchRecordSchema }).strict(),
})

const updateSketchCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.sketch.update"),
  schemaVersion: z.literal(1),
  payload: z.object({ sketch: sketchRecordSchema }).strict(),
})

const removeSketchCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.sketch.remove"),
  schemaVersion: z.literal(1),
  payload: z.object({ sketchId: sketchIdSchema }).strict(),
})

const addFeatureCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.feature.add"),
  schemaVersion: z.literal(1),
  payload: z.object({ feature: featureRecordSchema }).strict(),
})

const updateFeatureCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.feature.update"),
  schemaVersion: z.literal(1),
  payload: z.object({ feature: featureRecordSchema }).strict(),
})

const removeFeatureCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.feature.remove"),
  schemaVersion: z.literal(1),
  payload: z.object({ featureId: featureIdSchema }).strict(),
})

const setFeatureSuppressedCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.feature.set-suppressed"),
  schemaVersion: z.literal(1),
  payload: z.object({ featureId: featureIdSchema, suppressed: z.boolean() }).strict(),
})

export const documentCommandSchema = z.discriminatedUnion("kind", [
  createDocumentCommandSchema,
  renameDocumentCommandSchema,
  setDocumentDisplayUnitsCommandSchema,
  addVariableCommandSchema,
  setVariableExpressionCommandSchema,
  renameVariableCommandSchema,
  removeVariableCommandSchema,
  replaceVariableTableCommandSchema,
  addSketchCommandSchema,
  updateSketchCommandSchema,
  removeSketchCommandSchema,
  addFeatureCommandSchema,
  updateFeatureCommandSchema,
  removeFeatureCommandSchema,
  setFeatureSuppressedCommandSchema,
])

const eventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: commandIdSchema,
    transactionId: draftIdSchema.nullable(),
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()

const documentCreatedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.created"),
  name: documentNameSchema,
})

const documentRenamedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.renamed"),
  previousName: documentNameSchema,
  name: documentNameSchema,
})

const documentDisplayUnitsChangedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.display-units-changed"),
  previousDisplayUnits: documentDisplayUnitsSchema,
  displayUnits: documentDisplayUnitsSchema,
})

const variableAddedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.variable.added"),
  variable: variableDefinitionSchema,
})

const variableExpressionChangedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.variable.expression-changed"),
  variableId: variableIdSchema,
  previousExpression: variableExpressionSchema,
  expression: variableExpressionSchema,
})

const variableRenamedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.variable.renamed"),
  variableId: variableIdSchema,
  previousName: variableNameSchema,
  name: variableNameSchema,
})

const variableRemovedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.variable.removed"),
  variable: variableDefinitionSchema,
})

const variableTableReplacedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.variable.table-replaced"),
  previousVariables: variableDefinitionsSchema,
  variables: variableDefinitionsSchema,
})

const sketchAddedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.sketch.added"),
  sketch: sketchRecordSchema,
})

const sketchUpdatedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.sketch.updated"),
  previousSketch: sketchRecordSchema,
  sketch: sketchRecordSchema,
})

const sketchRemovedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.sketch.removed"),
  sketch: sketchRecordSchema,
})

const featureAddedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.feature.added"),
  feature: featureRecordSchema,
})

const featureUpdatedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.feature.updated"),
  previousFeature: featureRecordSchema,
  feature: featureRecordSchema,
})

const featureRemovedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.feature.removed"),
  feature: featureRecordSchema,
})

const featureSuppressionChangedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.feature.suppression-changed"),
  featureId: featureIdSchema,
  previousSuppressed: z.boolean(),
  suppressed: z.boolean(),
})

export const documentEventSchema = z.discriminatedUnion("type", [
  documentCreatedEventSchema,
  documentRenamedEventSchema,
  documentDisplayUnitsChangedEventSchema,
  variableAddedEventSchema,
  variableExpressionChangedEventSchema,
  variableRenamedEventSchema,
  variableRemovedEventSchema,
  variableTableReplacedEventSchema,
  sketchAddedEventSchema,
  sketchUpdatedEventSchema,
  sketchRemovedEventSchema,
  featureAddedEventSchema,
  featureUpdatedEventSchema,
  featureRemovedEventSchema,
  featureSuppressionChangedEventSchema,
])

export type { DomainDiagnostic } from "./command-support"
export { domainDiagnosticCodeSchema } from "./command-support"

export type CommandActor = Readonly<z.infer<typeof commandActorSchema>>
export type DocumentCommand = Readonly<z.infer<typeof documentCommandSchema>>
export type DocumentEvent = Readonly<z.infer<typeof documentEventSchema>>

type VariableCommand = Extract<
  DocumentCommand,
  {
    kind:
      | "org.vibeshape.variable.add"
      | "org.vibeshape.variable.remove"
      | "org.vibeshape.variable.rename"
      | "org.vibeshape.variable.replace-table"
      | "org.vibeshape.variable.set-expression"
  }
>
type VariableEvent = Extract<
  DocumentEvent,
  {
    type:
      | "org.vibeshape.variable.added"
      | "org.vibeshape.variable.expression-changed"
      | "org.vibeshape.variable.removed"
      | "org.vibeshape.variable.renamed"
      | "org.vibeshape.variable.table-replaced"
  }
>

type SketchCommand = Extract<
  DocumentCommand,
  {
    kind: "org.vibeshape.sketch.add" | "org.vibeshape.sketch.update" | "org.vibeshape.sketch.remove"
  }
>
type SketchEvent = Extract<
  DocumentEvent,
  {
    type:
      | "org.vibeshape.sketch.added"
      | "org.vibeshape.sketch.updated"
      | "org.vibeshape.sketch.removed"
  }
>
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
type FeatureEvent = Extract<
  DocumentEvent,
  {
    type:
      | "org.vibeshape.feature.added"
      | "org.vibeshape.feature.updated"
      | "org.vibeshape.feature.removed"
      | "org.vibeshape.feature.suppression-changed"
  }
>

const variableCommandKinds = new Set<DocumentCommand["kind"]>([
  "org.vibeshape.variable.add",
  "org.vibeshape.variable.remove",
  "org.vibeshape.variable.rename",
  "org.vibeshape.variable.replace-table",
  "org.vibeshape.variable.set-expression",
])
const variableEventTypes = new Set<DocumentEvent["type"]>([
  "org.vibeshape.variable.added",
  "org.vibeshape.variable.expression-changed",
  "org.vibeshape.variable.removed",
  "org.vibeshape.variable.renamed",
  "org.vibeshape.variable.table-replaced",
])
const sketchCommandKinds = new Set<DocumentCommand["kind"]>([
  "org.vibeshape.sketch.add",
  "org.vibeshape.sketch.update",
  "org.vibeshape.sketch.remove",
])
const sketchEventTypes = new Set<DocumentEvent["type"]>([
  "org.vibeshape.sketch.added",
  "org.vibeshape.sketch.updated",
  "org.vibeshape.sketch.removed",
])
const featureCommandKinds = new Set<DocumentCommand["kind"]>([
  "org.vibeshape.feature.add",
  "org.vibeshape.feature.update",
  "org.vibeshape.feature.remove",
  "org.vibeshape.feature.set-suppressed",
])
const featureEventTypes = new Set<DocumentEvent["type"]>([
  "org.vibeshape.feature.added",
  "org.vibeshape.feature.updated",
  "org.vibeshape.feature.removed",
  "org.vibeshape.feature.suppression-changed",
])

function isVariableCommand(command: DocumentCommand): command is VariableCommand {
  return variableCommandKinds.has(command.kind)
}

function isVariableEvent(event: DocumentEvent): event is VariableEvent {
  return variableEventTypes.has(event.type)
}

function isSketchCommand(command: DocumentCommand): command is SketchCommand {
  return sketchCommandKinds.has(command.kind)
}

function isSketchEvent(event: DocumentEvent): event is SketchEvent {
  return sketchEventTypes.has(event.type)
}

function isFeatureCommand(command: DocumentCommand): command is FeatureCommand {
  return featureCommandKinds.has(command.kind)
}

function isFeatureEvent(event: DocumentEvent): event is FeatureEvent {
  return featureEventTypes.has(event.type)
}

type DocumentCreatedEvent = Extract<DocumentEvent, { type: "org.vibeshape.document.created" }>
type DocumentRenamedEvent = Extract<DocumentEvent, { type: "org.vibeshape.document.renamed" }>
type DocumentDisplayUnitsChangedEvent = Extract<
  DocumentEvent,
  { type: "org.vibeshape.document.display-units-changed" }
>

export type DocumentCommandResult =
  | { ok: true; snapshot: DocumentSnapshot; event: DocumentEvent }
  | { ok: false; diagnostic: DomainDiagnostic }

export type DocumentCommandOptions = Readonly<{
  transactionId?: z.infer<typeof draftIdSchema> | null
}>

export type DocumentEventResult =
  | { ok: true; snapshot: DocumentSnapshot }
  | { ok: false; diagnostic: DomainDiagnostic }

export function commandActorsEqual(left: CommandActor, right: CommandActor) {
  if (left.type !== right.type) {
    return false
  }

  switch (left.type) {
    case "user":
      return right.type === "user" && left.userId === right.userId
    case "mcp":
      return (
        right.type === "mcp" &&
        left.clientId === right.clientId &&
        left.sessionId === right.sessionId
      )
    case "extension":
      return (
        right.type === "extension" &&
        left.extensionId === right.extensionId &&
        left.integrity === right.integrity
      )
    case "system":
      return right.type === "system" && left.source === right.source
  }
}

function invalidInputDiagnostic(
  code: "invalid-command" | "invalid-event",
  error: z.ZodError,
): DomainDiagnostic {
  return {
    code,
    message:
      code === "invalid-command"
        ? "The document command is invalid."
        : "The document event is invalid.",
    retryable: false,
    issues: zodDiagnosticIssues(error),
  }
}

function reduceCreatedEvent(
  snapshot: DocumentSnapshot | null,
  event: DocumentCreatedEvent,
): DocumentEventResult {
  if (snapshot) {
    return {
      ok: false,
      diagnostic: diagnostic("document-already-exists", "The document already exists."),
    }
  }

  if (event.baseRevision !== 0 || event.revision !== 1) {
    return {
      ok: false,
      diagnostic: diagnostic(
        "stale-revision",
        "Document creation must advance revision 0 to revision 1.",
        true,
      ),
    }
  }

  return {
    ok: true,
    snapshot: {
      schemaVersion: 0,
      id: event.documentId,
      revision: event.revision,
      name: event.name,
      displayUnits: defaultDocumentDisplayUnits,
      variables: [],
      sketches: [],
      features: [],
      createdAt: event.issuedAt,
      updatedAt: event.issuedAt,
    },
  }
}

function reduceDisplayUnitsChangedEvent(
  snapshot: DocumentSnapshot | null,
  event: DocumentDisplayUnitsChangedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )
  if (!current.ok) return current
  const existing = current.snapshot.displayUnits
  if (
    existing.length !== event.previousDisplayUnits.length ||
    existing.angle !== event.previousDisplayUnits.angle
  ) {
    return {
      ok: false,
      diagnostic: diagnostic(
        "invalid-event",
        "The display-unit event does not match the current document preferences.",
      ),
    }
  }
  return {
    ok: true,
    snapshot: {
      ...current.snapshot,
      revision: event.revision,
      displayUnits: event.displayUnits,
      updatedAt: event.issuedAt,
    },
  }
}

function reduceRenamedEvent(
  snapshot: DocumentSnapshot | null,
  event: DocumentRenamedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )

  if (!current.ok) return current

  if (current.snapshot.name !== event.previousName) {
    return {
      ok: false,
      diagnostic: diagnostic(
        "invalid-event",
        "The rename event does not match the current document name.",
      ),
    }
  }

  return {
    ok: true,
    snapshot: {
      ...current.snapshot,
      revision: event.revision,
      name: event.name,
      updatedAt: event.issuedAt,
    },
  }
}

function reduceParsedEvent(
  snapshot: DocumentSnapshot | null,
  event: DocumentEvent,
): DocumentEventResult {
  if (isVariableEvent(event)) return reduceVariableDocumentEvent(snapshot, event)
  if (isSketchEvent(event)) return reduceSketchDocumentEvent(snapshot, event)
  if (isFeatureEvent(event)) return reduceFeatureDocumentEvent(snapshot, event)

  switch (event.type) {
    case "org.vibeshape.document.created":
      return reduceCreatedEvent(snapshot, event)
    case "org.vibeshape.document.renamed":
      return reduceRenamedEvent(snapshot, event)
    case "org.vibeshape.document.display-units-changed":
      return reduceDisplayUnitsChangedEvent(snapshot, event)
  }
}

function validateReducedDocument(
  result: DocumentEventResult,
  invalidEvent: boolean,
): DocumentEventResult {
  if (!result.ok) return result
  const graph = createDocumentDependencyGraphFromSnapshot(result.snapshot)
  return graph.ok
    ? result
    : { ok: false, diagnostic: documentGraphDiagnostic(graph.diagnostic, invalidEvent) }
}

function validateDestructiveEventDependencyModel(
  snapshot: DocumentSnapshot | null,
  event: DocumentEvent,
): Extract<DocumentEventResult, { ok: false }> | undefined {
  if (
    !snapshot ||
    (event.type !== "org.vibeshape.sketch.removed" &&
      event.type !== "org.vibeshape.feature.removed")
  ) {
    return
  }
  const graph = createDocumentDependencyGraphFromSnapshot(snapshot)
  if (!graph.ok) {
    return { ok: false, diagnostic: documentGraphDiagnostic(graph.diagnostic, true) }
  }
  if (graph.graph.dependencyModelIssues.length === 0) return
  return {
    ok: false,
    diagnostic: unavailableDependencyModelDiagnostic(graph.graph.dependencyModelIssues, true),
  }
}

function createDocumentDisplayUnitsChangedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<DocumentCommand, { kind: "org.vibeshape.document.set-display-units" }>,
  transactionId: z.infer<typeof draftIdSchema> | null,
): DocumentEvent | DomainDiagnostic {
  const current = requireExistingDocumentRevision(
    snapshot,
    command.documentId,
    command.baseRevision,
  )
  if (!current.ok) return current.diagnostic
  const previousDisplayUnits = current.snapshot.displayUnits
  const displayUnits = command.payload.displayUnits
  if (
    previousDisplayUnits.length === displayUnits.length &&
    previousDisplayUnits.angle === displayUnits.angle
  ) {
    return diagnostic("command-no-op", "The document already uses these display units.")
  }
  return {
    schemaVersion: 1,
    type: "org.vibeshape.document.display-units-changed",
    commandId: command.commandId,
    transactionId,
    documentId: command.documentId,
    baseRevision: command.baseRevision,
    revision: command.baseRevision + 1,
    issuedAt: command.issuedAt,
    actor: command.actor,
    previousDisplayUnits,
    displayUnits,
  }
}

function createDocumentCreatedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<DocumentCommand, { kind: "org.vibeshape.document.create" }>,
  transactionId: z.infer<typeof draftIdSchema> | null,
): DocumentEvent | DomainDiagnostic {
  if (snapshot) {
    return diagnostic("document-already-exists", "The document already exists.")
  }

  if (command.baseRevision !== 0) {
    return diagnostic("stale-revision", "Document creation requires base revision 0.", true)
  }

  return {
    schemaVersion: 1,
    type: "org.vibeshape.document.created",
    commandId: command.commandId,
    transactionId,
    documentId: command.documentId,
    baseRevision: command.baseRevision,
    revision: 1,
    issuedAt: command.issuedAt,
    actor: command.actor,
    name: command.payload.name,
  }
}

function createDocumentRenamedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<DocumentCommand, { kind: "org.vibeshape.document.rename" }>,
  transactionId: z.infer<typeof draftIdSchema> | null,
): DocumentEvent | DomainDiagnostic {
  const current = requireExistingDocumentRevision(
    snapshot,
    command.documentId,
    command.baseRevision,
  )

  if (!current.ok) return current.diagnostic

  if (current.snapshot.name === command.payload.name) {
    return diagnostic("command-no-op", "The document already has the requested name.")
  }

  return {
    schemaVersion: 1,
    type: "org.vibeshape.document.renamed",
    commandId: command.commandId,
    transactionId,
    documentId: command.documentId,
    baseRevision: command.baseRevision,
    revision: command.baseRevision + 1,
    issuedAt: command.issuedAt,
    actor: command.actor,
    previousName: current.snapshot.name,
    name: command.payload.name,
  }
}

function createEvent(
  snapshot: DocumentSnapshot | null,
  command: DocumentCommand,
  transactionId: z.infer<typeof draftIdSchema> | null,
): DocumentEvent | DomainDiagnostic {
  if (isVariableCommand(command)) {
    return createVariableDocumentEvent(snapshot, command, transactionId)
  }
  if (isSketchCommand(command)) {
    return createSketchDocumentEvent(snapshot, command, transactionId)
  }
  if (isFeatureCommand(command)) {
    return createFeatureDocumentEvent(snapshot, command, transactionId)
  }

  switch (command.kind) {
    case "org.vibeshape.document.create":
      return createDocumentCreatedEvent(snapshot, command, transactionId)
    case "org.vibeshape.document.rename":
      return createDocumentRenamedEvent(snapshot, command, transactionId)
    case "org.vibeshape.document.set-display-units":
      return createDocumentDisplayUnitsChangedEvent(snapshot, command, transactionId)
  }
}

export function parseDocumentCommand(input: unknown) {
  const parsed = documentCommandSchema.safeParse(input)

  return parsed.success
    ? ({ ok: true, command: parsed.data } as const)
    : ({ ok: false, diagnostic: invalidInputDiagnostic("invalid-command", parsed.error) } as const)
}

export function applyDocumentCommand(
  snapshot: DocumentSnapshot | null,
  input: unknown,
  options: DocumentCommandOptions = {},
): DocumentCommandResult {
  const parsed = parseDocumentCommand(input)

  if (!parsed.ok) {
    return parsed
  }

  const event = createEvent(snapshot, parsed.command, options.transactionId ?? null)

  if ("code" in event) {
    return { ok: false, diagnostic: event }
  }

  const reduced = validateReducedDocument(reduceParsedEvent(snapshot, event), false)
  return reduced.ok ? { ok: true, snapshot: reduced.snapshot, event } : reduced
}

export function reduceDocumentEvent(
  snapshot: DocumentSnapshot | null,
  input: unknown,
): DocumentEventResult {
  const parsed = documentEventSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, diagnostic: invalidInputDiagnostic("invalid-event", parsed.error) }
  }
  const unavailable = validateDestructiveEventDependencyModel(snapshot, parsed.data)
  return unavailable ?? validateReducedDocument(reduceParsedEvent(snapshot, parsed.data), true)
}

export function replayDocumentEvents(inputs: readonly unknown[]): DocumentEventResult {
  let snapshot: DocumentSnapshot | null = null

  for (const input of inputs) {
    const result = reduceDocumentEvent(snapshot, input)

    if (!result.ok) {
      return result
    }

    snapshot = result.snapshot
  }

  return snapshot
    ? { ok: true, snapshot }
    : { ok: false, diagnostic: diagnostic("document-not-found", "The event sequence is empty.") }
}
