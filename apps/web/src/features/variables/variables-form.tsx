import {
  evaluateVariableDefinitions,
  type EvaluatedVariable,
  parameterVariableReferences,
  type VariableDefinition,
  type VariableId,
  variableDefinitionsSchema,
  variableReferencesInExpression,
} from "@vibeshape/domain"
import { useFormatter } from "@vibeshape/i18n"
import { Input } from "@vibeshape/ui/components/input"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useRef, useState } from "react"
import type { ApplyVariableTableResult } from "../../document/document-controller"
import { VariablesTable, type VariablesTableCopy } from "./variables-table"

const MAX_VARIABLES = 4_096

type VariablesFormCopy = VariablesTableCopy &
  Readonly<{
    nameInput: string
    expressionInput: string
    valid: string
    invalid: string
    pending: string
    apply: string
    readOnly: string
    validationSummary: string
    staleRevision: string
    applyFailed: string
    removeInUse: string
    invalidName: string
    invalidExpression: string
  }>

function issueMessages(
  error: { issues: readonly { path: readonly PropertyKey[] }[] },
  copy: VariablesFormCopy,
) {
  const issues = new Map<string, string>()
  for (const issue of error.issues) {
    const [index, field] = issue.path
    if (typeof index === "number" && typeof field === "string") {
      issues.set(`${index}.${field}`, field === "name" ? copy.invalidName : copy.invalidExpression)
    }
  }
  return issues
}

function formatResult(
  value: { dimension: "length" | "angle" | "scalar"; value: number },
  formatNumber: (value: number) => string,
) {
  const unit = value.dimension === "length" ? " mm" : value.dimension === "angle" ? " rad" : ""
  return `${formatNumber(value.value)}${unit}`
}

function submissionMessage(result: ApplyVariableTableResult, copy: VariablesFormCopy) {
  if (result.ok) return null
  if (
    result.diagnostic.sourceCode === "stale-revision" ||
    result.diagnostic.code === "write-access-unavailable"
  ) {
    return copy.staleRevision
  }
  if (result.diagnostic.sourceCode === "variable-in-use") return copy.removeInUse
  return copy.applyFailed
}

function draftReferencesRow(
  rows: readonly { name: string; expression: string }[],
  rowIndex: number,
) {
  const row = rows[rowIndex]
  if (!row) return false
  return rows.some(
    (candidate, candidateIndex) =>
      candidateIndex !== rowIndex &&
      variableReferencesInExpression(candidate.expression).includes(row.name),
  )
}

function removalProps(
  rows: readonly { name: string; expression: string }[],
  rowIndex: number,
  protectedVariableNames: ReadonlySet<string>,
  copy: VariablesFormCopy,
) {
  const row = rows[rowIndex]
  const removeDisabled =
    draftReferencesRow(rows, rowIndex) || Boolean(row && protectedVariableNames.has(row.name))
  return removeDisabled
    ? { removeDisabled, removeDisabledReason: copy.removeInUse }
    : { removeDisabled }
}

function fieldErrorProps(issues: ReadonlyMap<string, string>, rowIndex: number) {
  const props: { nameError?: string; expressionError?: string } = {}
  const nameError = issues.get(`${rowIndex}.name`)
  const expressionError = issues.get(`${rowIndex}.expression`)
  if (nameError) props.nameError = nameError
  if (expressionError) props.expressionError = expressionError
  return props
}

function evaluatedRow(
  evaluation: ReturnType<typeof evaluateVariableDefinitions> | null,
  name: string,
) {
  return evaluation?.ok ? evaluation.valuesByName.get(name) : undefined
}

function rowStatus(
  evaluation: EvaluatedVariable | undefined,
  hasStructuralIssue: boolean,
  copy: VariablesFormCopy,
) {
  if (evaluation) return copy.valid
  return hasStructuralIssue ? copy.invalid : copy.pending
}

function resultText(
  evaluation: EvaluatedVariable | undefined,
  formatNumber: (value: number) => string,
) {
  return evaluation ? formatResult(evaluation.value, formatNumber) : "—"
}

function invalidAttribute(error: string | undefined) {
  return error ? (true as const) : undefined
}

export function VariablesForm({
  baseRevision,
  copy,
  createVariableId,
  disabled = false,
  onApply,
  protectedVariableNames = new Set<string>(),
  variables,
}: {
  baseRevision: number
  copy: VariablesFormCopy
  createVariableId: () => VariableId
  disabled?: boolean
  onApply: (
    baseRevision: number,
    variables: readonly VariableDefinition[],
  ) => Promise<ApplyVariableTableResult>
  protectedVariableNames?: ReadonlySet<string>
  variables: readonly VariableDefinition[]
}) {
  const formatter = useFormatter()
  const formElementRef = useRef<HTMLFormElement>(null)
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  const [submitIssues, setSubmitIssues] = useState<ReadonlyMap<string, string>>(new Map())
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: {
      variables: variables.map((variable) => ({ ...variable, persisted: true })),
    },
    onSubmit: async ({ value }) => {
      const parsed = variableDefinitionsSchema.safeParse(
        value.variables.map(({ id, name, expression }) => ({
          schemaVersion: 0 as const,
          id,
          name,
          expression,
        })),
      )
      if (!parsed.success) {
        setSubmitIssues(issueMessages(parsed.error, copy))
        setSubmitMessage(copy.validationSummary)
        const [index, field] = parsed.error.issues[0]?.path ?? []
        if (typeof index === "number" && typeof field === "string") {
          formElementRef.current
            ?.querySelector<HTMLElement>(`[name="variables[${index}].${field}"]`)
            ?.focus()
        }
        return
      }
      setSubmitIssues(new Map())
      setSubmitMessage(null)
      const result = await onApply(baseRevision, parsed.data)
      setSubmitMessage(submissionMessage(result, copy))
    },
  })

  const clearSubmissionErrors = () => {
    if (submitIssues.size > 0) setSubmitIssues(new Map())
    if (submitMessage) setSubmitMessage(null)
  }

  return (
    <Form ref={formElementRef} form={form} className="gap-3" aria-label={copy.caption}>
      {disabled ? (
        <p className="rounded-md border border-diagnostic-warning/40 bg-panel-muted p-2 text-xs">
          {copy.readOnly}
        </p>
      ) : null}
      {submitMessage ? (
        <p
          className="rounded-md border border-destructive/40 bg-panel-muted p-2 text-xs text-destructive"
          role="alert"
        >
          {submitMessage}
        </p>
      ) : null}
      <form.AppField name="variables" mode="array">
        {(arrayField) => (
          <form.Subscribe selector={(formState) => formState.values.variables}>
            {(rows) => {
              const structural = variableDefinitionsSchema.safeParse(
                rows.map(({ id, name, expression }) => ({
                  schemaVersion: 0 as const,
                  id,
                  name,
                  expression,
                })),
              )
              const evaluated = structural.success
                ? evaluateVariableDefinitions(structural.data)
                : null

              return (
                <VariablesTable
                  addDisabled={rows.length >= MAX_VARIABLES}
                  copy={copy}
                  disabled={disabled}
                  footerAction={
                    <form.SubmitButton disabled={disabled}>{copy.apply}</form.SubmitButton>
                  }
                  onAdd={() => {
                    const id = createVariableId()
                    clearSubmissionErrors()
                    setFocusedRowId(id)
                    arrayField.pushValue({
                      schemaVersion: 0,
                      id,
                      name: "",
                      expression: "",
                      persisted: false,
                    })
                  }}
                  rows={rows.map((row, index) => {
                    const evaluation = evaluatedRow(evaluated, row.name)
                    const hasStructuralIssue =
                      !structural.success &&
                      structural.error.issues.some((issue) => issue.path[0] === index)
                    const errors = fieldErrorProps(submitIssues, index)

                    return {
                      id: row.id,
                      nameField: (
                        <form.Field name={`variables[${index}].name`}>
                          {(field) => (
                            <Input
                              name={field.name}
                              value={field.state.value}
                              disabled={disabled || row.persisted}
                              autoFocus={focusedRowId === row.id}
                              aria-label={copy.nameInput}
                              aria-describedby={`${row.id}-name-error`}
                              aria-invalid={invalidAttribute(errors.nameError)}
                              className="h-8 font-mono"
                              onBlur={field.handleBlur}
                              onChange={(event) => {
                                clearSubmissionErrors()
                                field.handleChange(event.currentTarget.value)
                              }}
                            />
                          )}
                        </form.Field>
                      ),
                      expressionField: (
                        <form.Field name={`variables[${index}].expression`}>
                          {(field) => (
                            <Input
                              name={field.name}
                              value={field.state.value}
                              disabled={disabled}
                              aria-label={copy.expressionInput}
                              aria-describedby={`${row.id}-expression-error`}
                              aria-invalid={invalidAttribute(errors.expressionError)}
                              className="h-8 font-mono"
                              onBlur={field.handleBlur}
                              onChange={(event) => {
                                clearSubmissionErrors()
                                field.handleChange(event.currentTarget.value)
                              }}
                            />
                          )}
                        </form.Field>
                      ),
                      result: resultText(evaluation, (value) =>
                        formatter.number(value, { maximumFractionDigits: 6 }),
                      ),
                      status: rowStatus(evaluation, hasStructuralIssue, copy),
                      ...errors,
                      ...removalProps(rows, index, protectedVariableNames, copy),
                      onRemove: () => {
                        clearSubmissionErrors()
                        arrayField.removeValue(index)
                      },
                    }
                  })}
                />
              )
            }}
          </form.Subscribe>
        )}
      </form.AppField>
    </Form>
  )
}

export function referencedFeatureVariableNames(
  variables: readonly VariableDefinition[],
  featureParameters: readonly unknown[],
) {
  const names = new Set(variables.map(({ name }) => name))
  return new Set(
    featureParameters.flatMap(parameterVariableReferences).filter((name) => names.has(name)),
  )
}
