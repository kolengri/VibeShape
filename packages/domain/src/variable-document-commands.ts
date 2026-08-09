import type { z } from "zod"
import type {
  DocumentCommand,
  DocumentEvent,
  DocumentEventResult,
  DomainDiagnostic,
} from "./commands"
import { domainDiagnostic, requireExistingDocumentRevision } from "./command-support"
import type { DocumentSnapshot } from "./document"
import type { draftIdSchema } from "./identifiers"
import {
  type VariableDefinition,
  parameterVariableReferences,
  variableDefinitionSchema,
  variableDefinitionsSchema,
} from "./variables"

type VariableCommand = Extract<
  DocumentCommand,
  {
    kind:
      | "org.vibeshape.variable.add"
      | "org.vibeshape.variable.set-expression"
      | "org.vibeshape.variable.remove"
      | "org.vibeshape.variable.replace-table"
  }
>
type VariableAddedEvent = Extract<DocumentEvent, { type: "org.vibeshape.variable.added" }>
type VariableExpressionChangedEvent = Extract<
  DocumentEvent,
  { type: "org.vibeshape.variable.expression-changed" }
>
type VariableRemovedEvent = Extract<DocumentEvent, { type: "org.vibeshape.variable.removed" }>
type VariableTableReplacedEvent = Extract<
  DocumentEvent,
  { type: "org.vibeshape.variable.table-replaced" }
>
type VariableEvent =
  | VariableAddedEvent
  | VariableExpressionChangedEvent
  | VariableRemovedEvent
  | VariableTableReplacedEvent
type TransactionId = z.infer<typeof draftIdSchema> | null

type VariableMutationResult =
  | { ok: true; variables: readonly VariableDefinition[] }
  | { ok: false; diagnostic: DomainDiagnostic }

function invalidVariableExpression(error: z.ZodError, invalidEvent = false): DomainDiagnostic {
  return {
    code: invalidEvent ? "invalid-event" : "invalid-variable-expression",
    message: invalidEvent
      ? "The variable event does not match the current document."
      : "The variable table contains an invalid expression or dependency.",
    retryable: false,
    issues: error.issues.slice(0, 8).map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  }
}

function parseMutation(
  variables: readonly VariableDefinition[],
  invalidEvent = false,
): VariableMutationResult {
  const parsed = variableDefinitionsSchema.safeParse(variables)
  return parsed.success
    ? { ok: true, variables: parsed.data }
    : { ok: false, diagnostic: invalidVariableExpression(parsed.error, invalidEvent) }
}

function addVariable(
  variables: readonly VariableDefinition[],
  variable: VariableDefinition,
  invalidEvent = false,
): VariableMutationResult {
  if (variables.some(({ id }) => id === variable.id)) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        invalidEvent ? "invalid-event" : "variable-already-exists",
        invalidEvent
          ? "The variable event does not match the current document."
          : `Variable ${variable.id} already exists.`,
      ),
    }
  }
  if (variables.some(({ name }) => name === variable.name)) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        invalidEvent ? "invalid-event" : "variable-name-conflict",
        invalidEvent
          ? "The variable event does not match the current document."
          : `Variable name ${variable.name} is already in use.`,
      ),
    }
  }
  return parseMutation([...variables, variable], invalidEvent)
}

function setVariableExpression(
  variables: readonly VariableDefinition[],
  variableId: VariableDefinition["id"],
  expression: string,
  invalidEvent = false,
): VariableMutationResult {
  const index = variables.findIndex(({ id }) => id === variableId)
  if (index < 0) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        invalidEvent ? "invalid-event" : "variable-not-found",
        invalidEvent
          ? "The variable event does not match the current document."
          : `Variable ${variableId} does not exist.`,
      ),
    }
  }
  const variable = variables[index] as VariableDefinition
  if (variable.expression === expression) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        invalidEvent ? "invalid-event" : "command-no-op",
        invalidEvent
          ? "The variable event does not match the current document."
          : "The variable already has the requested expression.",
      ),
    }
  }
  const next = [...variables]
  next[index] = { ...variable, expression }
  return parseMutation(next, invalidEvent)
}

function variablesEqual(left: VariableDefinition, right: VariableDefinition) {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.id === right.id &&
    left.name === right.name &&
    left.expression === right.expression
  )
}

function removalFailure(
  invalidEvent: boolean,
  code: "variable-not-found" | "variable-in-use",
  message: string,
): VariableMutationResult {
  return {
    ok: false,
    diagnostic: domainDiagnostic(
      invalidEvent ? "invalid-event" : code,
      invalidEvent ? "The variable event does not match the current document." : message,
    ),
  }
}

function featureReferencesVariable(featureParameters: readonly unknown[], variableName: string) {
  return featureParameters.some((parameters) =>
    parameterVariableReferences(parameters).includes(variableName),
  )
}

function dependencyRemovalFailure(
  variable: VariableDefinition,
  error: z.ZodError,
  invalidEvent: boolean,
): VariableMutationResult {
  if (invalidEvent) return { ok: false, diagnostic: invalidVariableExpression(error, true) }
  return {
    ok: false,
    diagnostic: {
      code: "variable-in-use",
      message: `Variable #${variable.name} is referenced by another variable.`,
      retryable: false,
      issues: error.issues.slice(0, 8).map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    },
  }
}

function removeVariable(
  variables: readonly VariableDefinition[],
  variable: VariableDefinition,
  featureParameters: readonly unknown[],
  invalidEvent = false,
): VariableMutationResult {
  const existing = variables.find(({ id }) => id === variable.id)
  if (!existing || !variablesEqual(existing, variable)) {
    return removalFailure(
      invalidEvent,
      "variable-not-found",
      `Variable ${variable.id} does not exist.`,
    )
  }
  if (featureReferencesVariable(featureParameters, variable.name)) {
    return removalFailure(
      invalidEvent,
      "variable-in-use",
      `Variable #${variable.name} is referenced by a feature parameter.`,
    )
  }
  const parsed = variableDefinitionsSchema.safeParse(
    variables.filter(({ id }) => id !== variable.id),
  )
  if (parsed.success) return { ok: true, variables: parsed.data }
  return dependencyRemovalFailure(variable, parsed.error, invalidEvent)
}

function immutableVariableNameFailure(
  current: readonly VariableDefinition[],
  variables: readonly VariableDefinition[],
  invalidEvent: boolean,
): VariableMutationResult | null {
  for (const existing of current) {
    const replacement = variables.find(({ id }) => id === existing.id)
    if (replacement && replacement.name !== existing.name) {
      return {
        ok: false,
        diagnostic: domainDiagnostic(
          invalidEvent ? "invalid-event" : "variable-name-immutable",
          invalidEvent
            ? "The variable event does not match the current document."
            : `Variable #${existing.name} cannot be renamed.`,
        ),
      }
    }
  }
  return null
}

function removedFeatureReference(
  current: DocumentSnapshot,
  variables: readonly VariableDefinition[],
) {
  const names = new Set(variables.map(({ name }) => name))
  for (const feature of current.features) {
    const removedReference = parameterVariableReferences(feature.parameters).find(
      (name) => !names.has(name),
    )
    if (removedReference) return removedReference
  }
  return null
}

function variableTablesEqual(
  left: readonly VariableDefinition[],
  right: readonly VariableDefinition[],
) {
  return (
    left.length === right.length &&
    left.every((variable, index) => {
      const existing = right[index]
      return existing ? variablesEqual(variable, existing) : false
    })
  )
}

function noOpVariableTableFailure(invalidEvent: boolean): VariableMutationResult {
  return {
    ok: false,
    diagnostic: domainDiagnostic(
      invalidEvent ? "invalid-event" : "command-no-op",
      invalidEvent
        ? "The variable event does not match the current document."
        : "The variable table already has the requested contents.",
    ),
  }
}

function replaceVariableTable(
  current: DocumentSnapshot,
  variables: readonly VariableDefinition[],
  invalidEvent = false,
): VariableMutationResult {
  const immutableName = immutableVariableNameFailure(current.variables, variables, invalidEvent)
  if (immutableName) return immutableName
  const removedReference = removedFeatureReference(current, variables)
  if (removedReference) {
    return removalFailure(
      invalidEvent,
      "variable-in-use",
      `Variable #${removedReference} is referenced by a feature parameter.`,
    )
  }
  const parsed = parseMutation(variables, invalidEvent)
  if (!parsed.ok) return parsed
  return variableTablesEqual(parsed.variables, current.variables)
    ? noOpVariableTableFailure(invalidEvent)
    : parsed
}

function snapshotAfterMutation(
  current: DocumentSnapshot,
  event: VariableEvent,
  mutation: VariableMutationResult,
): DocumentEventResult {
  return mutation.ok
    ? {
        ok: true,
        snapshot: {
          ...current,
          revision: event.revision,
          variables: mutation.variables,
          updatedAt: event.issuedAt,
        },
      }
    : mutation
}

function reduceAddedEvent(
  snapshot: DocumentSnapshot | null,
  event: VariableAddedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )
  return current.ok
    ? snapshotAfterMutation(
        current.snapshot,
        event,
        addVariable(current.snapshot.variables, event.variable, true),
      )
    : current
}

function reduceExpressionChangedEvent(
  snapshot: DocumentSnapshot | null,
  event: VariableExpressionChangedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )
  if (!current.ok) return current
  const variable = current.snapshot.variables.find(({ id }) => id === event.variableId)
  if (!variable || variable.expression !== event.previousExpression) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "The variable event does not match the current document.",
      ),
    }
  }
  return snapshotAfterMutation(
    current.snapshot,
    event,
    setVariableExpression(current.snapshot.variables, event.variableId, event.expression, true),
  )
}

function reduceRemovedEvent(
  snapshot: DocumentSnapshot | null,
  event: VariableRemovedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )
  return current.ok
    ? snapshotAfterMutation(
        current.snapshot,
        event,
        removeVariable(
          current.snapshot.variables,
          event.variable,
          current.snapshot.features.map(({ parameters }) => parameters),
          true,
        ),
      )
    : current
}

function reduceTableReplacedEvent(
  snapshot: DocumentSnapshot | null,
  event: VariableTableReplacedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )
  if (!current.ok) return current
  if (
    current.snapshot.variables.length !== event.previousVariables.length ||
    current.snapshot.variables.some((variable, index) => {
      const previous = event.previousVariables[index]
      return previous ? !variablesEqual(variable, previous) : true
    })
  ) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "invalid-event",
        "The variable event does not match the current document.",
      ),
    }
  }
  return snapshotAfterMutation(
    current.snapshot,
    event,
    replaceVariableTable(current.snapshot, event.variables, true),
  )
}

export function reduceVariableDocumentEvent(
  snapshot: DocumentSnapshot | null,
  event: VariableEvent,
): DocumentEventResult {
  switch (event.type) {
    case "org.vibeshape.variable.added":
      return reduceAddedEvent(snapshot, event)
    case "org.vibeshape.variable.expression-changed":
      return reduceExpressionChangedEvent(snapshot, event)
    case "org.vibeshape.variable.removed":
      return reduceRemovedEvent(snapshot, event)
    case "org.vibeshape.variable.table-replaced":
      return reduceTableReplacedEvent(snapshot, event)
  }
}

function eventEnvelope(command: VariableCommand, transactionId: TransactionId) {
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

function requireCurrent(
  snapshot: DocumentSnapshot | null,
  command: VariableCommand,
): { ok: true; snapshot: DocumentSnapshot } | { ok: false; diagnostic: DomainDiagnostic } {
  return requireExistingDocumentRevision(snapshot, command.documentId, command.baseRevision)
}

function createAddedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<VariableCommand, { kind: "org.vibeshape.variable.add" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireCurrent(snapshot, command)
  if (!current.ok) return current.diagnostic
  const variable = variableDefinitionSchema.parse(command.payload.variable)
  const mutation = addVariable(current.snapshot.variables, variable)
  return mutation.ok
    ? { ...eventEnvelope(command, transactionId), type: "org.vibeshape.variable.added", variable }
    : mutation.diagnostic
}

function createExpressionChangedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<VariableCommand, { kind: "org.vibeshape.variable.set-expression" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireCurrent(snapshot, command)
  if (!current.ok) return current.diagnostic
  const variable = current.snapshot.variables.find(({ id }) => id === command.payload.variableId)
  if (!variable) {
    return domainDiagnostic(
      "variable-not-found",
      `Variable ${command.payload.variableId} does not exist.`,
    )
  }
  const mutation = setVariableExpression(
    current.snapshot.variables,
    command.payload.variableId,
    command.payload.expression,
  )
  return mutation.ok
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.variable.expression-changed",
        variableId: command.payload.variableId,
        previousExpression: variable.expression,
        expression: command.payload.expression,
      }
    : mutation.diagnostic
}

function createRemovedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<VariableCommand, { kind: "org.vibeshape.variable.remove" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireCurrent(snapshot, command)
  if (!current.ok) return current.diagnostic
  const variable = current.snapshot.variables.find(({ id }) => id === command.payload.variableId)
  if (!variable) {
    return domainDiagnostic(
      "variable-not-found",
      `Variable ${command.payload.variableId} does not exist.`,
    )
  }
  const mutation = removeVariable(
    current.snapshot.variables,
    variable,
    current.snapshot.features.map(({ parameters }) => parameters),
  )
  return mutation.ok
    ? { ...eventEnvelope(command, transactionId), type: "org.vibeshape.variable.removed", variable }
    : mutation.diagnostic
}

function createTableReplacedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<VariableCommand, { kind: "org.vibeshape.variable.replace-table" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireCurrent(snapshot, command)
  if (!current.ok) return current.diagnostic
  const mutation = replaceVariableTable(current.snapshot, command.payload.variables)
  return mutation.ok
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.variable.table-replaced",
        previousVariables: [...current.snapshot.variables],
        variables: [...mutation.variables],
      }
    : mutation.diagnostic
}

export function createVariableDocumentEvent(
  snapshot: DocumentSnapshot | null,
  command: VariableCommand,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  switch (command.kind) {
    case "org.vibeshape.variable.add":
      return createAddedEvent(snapshot, command, transactionId)
    case "org.vibeshape.variable.set-expression":
      return createExpressionChangedEvent(snapshot, command, transactionId)
    case "org.vibeshape.variable.remove":
      return createRemovedEvent(snapshot, command, transactionId)
    case "org.vibeshape.variable.replace-table":
      return createTableReplacedEvent(snapshot, command, transactionId)
  }
}
