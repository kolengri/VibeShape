import type { z } from "zod"
import { domainDiagnostic, requireExistingDocumentRevision } from "./command-support"
import type {
  DocumentCommand,
  DocumentEvent,
  DocumentEventResult,
  DomainDiagnostic,
} from "./commands"
import type { DocumentSnapshot } from "./document"
import { type FeatureRecord, featureRecordSchema } from "./feature-graph"
import type { draftIdSchema } from "./identifiers"
import {
  parameterVariableReferences,
  rewriteParameterVariableReferences,
  rewriteVariableReferencesInExpression,
  type VariableDefinition,
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
      | "org.vibeshape.variable.rename"
      | "org.vibeshape.variable.replace-table"
  }
>
type VariableIdCommand = Extract<
  VariableCommand,
  {
    kind:
      | "org.vibeshape.variable.set-expression"
      | "org.vibeshape.variable.remove"
      | "org.vibeshape.variable.rename"
  }
>
type VariableAddedEvent = Extract<DocumentEvent, { type: "org.vibeshape.variable.added" }>
type VariableExpressionChangedEvent = Extract<
  DocumentEvent,
  { type: "org.vibeshape.variable.expression-changed" }
>
type VariableRemovedEvent = Extract<DocumentEvent, { type: "org.vibeshape.variable.removed" }>
type VariableRenamedEvent = Extract<DocumentEvent, { type: "org.vibeshape.variable.renamed" }>
type VariableTableReplacedEvent = Extract<
  DocumentEvent,
  { type: "org.vibeshape.variable.table-replaced" }
>
type VariableEvent =
  | VariableAddedEvent
  | VariableExpressionChangedEvent
  | VariableRemovedEvent
  | VariableRenamedEvent
  | VariableTableReplacedEvent
type TransactionId = z.infer<typeof draftIdSchema> | null

type VariableMutationResult =
  | {
      ok: true
      variables: readonly VariableDefinition[]
      features?: readonly FeatureRecord[]
    }
  | { ok: false; diagnostic: DomainDiagnostic }

type FeatureRefactorResult =
  | { ok: true; feature: FeatureRecord }
  | { ok: false; diagnostic: DomainDiagnostic }

type RenameTargetResult =
  | { ok: true; variable: VariableDefinition }
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

function featureRefactorFailure(invalidEvent: boolean, message: string): FeatureRefactorResult {
  return {
    ok: false,
    diagnostic: domainDiagnostic(
      invalidEvent ? "invalid-event" : "invalid-feature-expression",
      invalidEvent ? "The variable event does not match the current document." : message,
    ),
  }
}

function refactorFeature(
  feature: FeatureRecord,
  previousName: string,
  name: string,
  invalidEvent: boolean,
): FeatureRefactorResult {
  const parameters = rewriteParameterVariableReferences(feature.parameters, previousName, name)
  if (!parameters.ok) return featureRefactorFailure(invalidEvent, parameters.message)
  const parsed = featureRecordSchema.safeParse({ ...feature, parameters: parameters.value })
  return parsed.success
    ? { ok: true, feature: parsed.data }
    : featureRefactorFailure(
        invalidEvent,
        "A feature parameter could not retain the renamed variable reference.",
      )
}

function refactorFeatures(
  features: readonly FeatureRecord[],
  previousName: string,
  name: string,
  invalidEvent: boolean,
): { ok: true; features: readonly FeatureRecord[] } | { ok: false; diagnostic: DomainDiagnostic } {
  const rewritten: FeatureRecord[] = []
  for (const feature of features) {
    const result = refactorFeature(feature, previousName, name, invalidEvent)
    if (!result.ok) return result
    rewritten.push(result.feature)
  }
  return { ok: true, features: rewritten }
}

function renameTargetFailure(
  invalidEvent: boolean,
  code: "variable-not-found" | "command-no-op" | "variable-name-conflict",
  message: string,
): RenameTargetResult {
  return {
    ok: false,
    diagnostic: domainDiagnostic(
      invalidEvent ? "invalid-event" : code,
      invalidEvent ? "The variable event does not match the current document." : message,
    ),
  }
}

function requireRenameTarget(
  current: DocumentSnapshot,
  variableId: VariableDefinition["id"],
  name: string,
  invalidEvent = false,
): RenameTargetResult {
  const variable = current.variables.find(({ id }) => id === variableId)
  if (!variable) {
    return renameTargetFailure(
      invalidEvent,
      "variable-not-found",
      `Variable ${variableId} does not exist.`,
    )
  }
  if (variable.name === name) {
    return renameTargetFailure(
      invalidEvent,
      "command-no-op",
      "The variable already has the requested name.",
    )
  }
  if (
    current.variables.some((candidate) => candidate.id !== variableId && candidate.name === name)
  ) {
    return renameTargetFailure(
      invalidEvent,
      "variable-name-conflict",
      `Variable name ${name} is already in use.`,
    )
  }
  return { ok: true, variable }
}

function refactorVariableDefinitions(
  variables: readonly VariableDefinition[],
  target: VariableDefinition,
  name: string,
  invalidEvent: boolean,
) {
  return parseMutation(
    variables.map((candidate) => ({
      ...candidate,
      name: candidate.id === target.id ? name : candidate.name,
      expression: rewriteVariableReferencesInExpression(candidate.expression, target.name, name),
    })),
    invalidEvent,
  )
}

function renameVariable(
  current: DocumentSnapshot,
  variableId: VariableDefinition["id"],
  name: string,
  invalidEvent = false,
): VariableMutationResult {
  const target = requireRenameTarget(current, variableId, name, invalidEvent)
  if (!target.ok) return target
  const variables = refactorVariableDefinitions(
    current.variables,
    target.variable,
    name,
    invalidEvent,
  )
  if (!variables.ok) return variables
  const features = refactorFeatures(current.features, target.variable.name, name, invalidEvent)
  return features.ok
    ? { ok: true, variables: variables.variables, features: features.features }
    : features
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
          features: mutation.features ?? current.features,
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

function reduceRenamedEvent(
  snapshot: DocumentSnapshot | null,
  event: VariableRenamedEvent,
): DocumentEventResult {
  const current = requireExistingDocumentRevision(
    snapshot,
    event.documentId,
    event.baseRevision,
    event.revision,
  )
  if (!current.ok) return current
  const variable = current.snapshot.variables.find(({ id }) => id === event.variableId)
  if (!variable || variable.name !== event.previousName) {
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
    renameVariable(current.snapshot, event.variableId, event.name, true),
  )
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
    case "org.vibeshape.variable.renamed":
      return reduceRenamedEvent(snapshot, event)
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

function requireCommandVariable(
  snapshot: DocumentSnapshot | null,
  command: VariableIdCommand,
):
  | { ok: true; snapshot: DocumentSnapshot; variable: VariableDefinition }
  | { ok: false; diagnostic: DomainDiagnostic } {
  const current = requireCurrent(snapshot, command)
  if (!current.ok) return current
  const variable = current.snapshot.variables.find(({ id }) => id === command.payload.variableId)
  return variable
    ? { ok: true, snapshot: current.snapshot, variable }
    : {
        ok: false,
        diagnostic: domainDiagnostic(
          "variable-not-found",
          `Variable ${command.payload.variableId} does not exist.`,
        ),
      }
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
  const current = requireCommandVariable(snapshot, command)
  if (!current.ok) return current.diagnostic
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
        previousExpression: current.variable.expression,
        expression: command.payload.expression,
      }
    : mutation.diagnostic
}

function createRemovedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<VariableCommand, { kind: "org.vibeshape.variable.remove" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireCommandVariable(snapshot, command)
  if (!current.ok) return current.diagnostic
  const mutation = removeVariable(
    current.snapshot.variables,
    current.variable,
    current.snapshot.features.map(({ parameters }) => parameters),
  )
  return mutation.ok
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.variable.removed",
        variable: current.variable,
      }
    : mutation.diagnostic
}

function createRenamedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<VariableCommand, { kind: "org.vibeshape.variable.rename" }>,
  transactionId: TransactionId,
): DocumentEvent | DomainDiagnostic {
  const current = requireCommandVariable(snapshot, command)
  if (!current.ok) return current.diagnostic
  const mutation = renameVariable(
    current.snapshot,
    command.payload.variableId,
    command.payload.name,
  )
  return mutation.ok
    ? {
        ...eventEnvelope(command, transactionId),
        type: "org.vibeshape.variable.renamed",
        variableId: command.payload.variableId,
        previousName: current.variable.name,
        name: command.payload.name,
      }
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
    case "org.vibeshape.variable.rename":
      return createRenamedEvent(snapshot, command, transactionId)
    case "org.vibeshape.variable.replace-table":
      return createTableReplacedEvent(snapshot, command, transactionId)
  }
}
