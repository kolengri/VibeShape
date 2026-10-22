import {
  type EvaluatedVariable,
  evaluateVariableDefinitions,
  parameterVariableReferences,
  type VariableDefinition,
  type VariableId,
  variableDefinitionsSchema,
  variableNameSchema,
  variableReferencesInExpression,
} from "@vibeshape/domain"
import { useFormatter } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { DialogBody, DialogFooter } from "@vibeshape/ui/components/dialog"
import { Check, Pencil, Trash2, X } from "@vibeshape/ui/components/icons"
import { Input } from "@vibeshape/ui/components/input"
import { TextField } from "@vibeshape/ui/components/text-field"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vibeshape/ui/components/tooltip"
import { Form, validationMessage } from "@vibeshape/ui/integrations/tanstack-form"
import { isInteger, isString } from "is-what"
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react"
import { ActionAvailability } from "../../components/action-availability"
import type { ApplyVariableTableResult } from "../../document/document-controller"
import {
  formatDisplayAngle,
  formatDisplayLength,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { variableExpressionSuggestions } from "./variable-expression-input"
import { VariablesTable, type VariablesTableCopy } from "./variables-table"

const MAX_VARIABLES = 4_096
const EMPTY_VARIABLE_NAMES = new Set<string>()

type VariablesFormCopy = VariablesTableCopy &
  Readonly<{
    nameInput: string
    expressionInput: string
    search: string
    searchPlaceholder: string
    clearSearch: string
    valid: string
    invalid: string
    pending: string
    apply: string
    remove: string
    rename: string
    confirmRename: string
    cancelRename: string
    readOnly: string
    validationSummary: string
    staleRevision: string
    applyFailed: string
    removeInUse: string
    invalidName: string
    invalidExpression: string
    renameNoChange: string
    renameConflict: string
    renameFailed: string
  }>

function issueMessages(
  error: { issues: readonly { path: readonly PropertyKey[] }[] },
  copy: VariablesFormCopy,
) {
  const issues: Record<string, string> = {}
  for (const issue of error.issues) {
    const [index, field] = issue.path
    if (isInteger(index) && isString(field)) {
      issues[`variables[${index}].${field}`] =
        field === "name" ? copy.invalidName : copy.invalidExpression
    }
  }
  return issues
}

function formatResult(
  value: { dimension: "length" | "angle" | "scalar"; value: number },
  displayUnits: ReturnType<typeof useDocumentDisplayUnits>,
  formatNumber: (value: number) => string,
) {
  if (value.dimension === "length") {
    return formatDisplayLength(value.value, displayUnits.length, formatNumber)
  }
  if (value.dimension === "angle") {
    return formatDisplayAngle(value.value, displayUnits.angle, formatNumber)
  }
  return formatNumber(value.value)
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

function renameSubmissionMessage(result: ApplyVariableTableResult, copy: VariablesFormCopy) {
  if (result.ok) return null
  if (
    result.diagnostic.sourceCode === "stale-revision" ||
    result.diagnostic.code === "write-access-unavailable"
  ) {
    return copy.staleRevision
  }
  if (result.diagnostic.sourceCode === "variable-name-conflict") return copy.renameConflict
  return copy.renameFailed
}

function VariableRowActions({
  canRename,
  copy,
  disabled,
  onCancelRename,
  onConfirmRename,
  onRemove,
  onStartRename,
  removeDisabled,
  removeDisabledReason,
  renaming,
}: {
  canRename: boolean
  copy: VariablesFormCopy
  disabled: boolean
  onCancelRename: () => void
  onConfirmRename: () => Promise<void>
  onRemove: () => void
  onStartRename: () => void
  removeDisabled: boolean
  removeDisabledReason?: string
  renaming: boolean
}) {
  if (renaming) {
    return (
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={disabled}
          aria-label={copy.cancelRename}
          title={copy.cancelRename}
          onClick={onCancelRename}
        >
          <X aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="secondary"
          disabled={disabled}
          aria-label={copy.confirmRename}
          title={copy.confirmRename}
          onClick={onConfirmRename}
        >
          <Check aria-hidden="true" />
        </Button>
      </div>
    )
  }
  return (
    <TooltipProvider>
      <div className="flex items-center justify-end gap-1">
        {canRename ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={disabled}
                aria-label={copy.rename}
                onClick={onStartRename}
              >
                <Pencil aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copy.rename}</TooltipContent>
          </Tooltip>
        ) : null}
        <ActionAvailability
          disabledReason={removeDisabledReason}
          presentation="persistent"
          reasonClassName="sr-only"
        >
          {({ describedBy }) => (
            <Tooltip>
              <TooltipTrigger asChild>
                <fieldset
                  className="m-0 inline-flex min-w-0 rounded-md border-0 p-0 focus-visible:outline focus-visible:outline-ring"
                  tabIndex={removeDisabled && !disabled ? 0 : undefined}
                  aria-label={removeDisabled ? copy.remove : undefined}
                  aria-describedby={describedBy}
                >
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={disabled || removeDisabled}
                    aria-label={copy.remove}
                    aria-describedby={describedBy}
                    onClick={onRemove}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </fieldset>
              </TooltipTrigger>
              <TooltipContent>{removeDisabledReason ?? copy.remove}</TooltipContent>
            </Tooltip>
          )}
        </ActionAvailability>
      </div>
    </TooltipProvider>
  )
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

function fieldErrorProps(nameIssue: unknown, expressionIssue: unknown) {
  const nameError = validationMessage(nameIssue)
  const expressionError = validationMessage(expressionIssue)
  return {
    ...(nameError ? { nameError } : {}),
    ...(expressionError ? { expressionError } : {}),
  }
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
  displayUnits: ReturnType<typeof useDocumentDisplayUnits>,
  formatNumber: (value: number) => string,
) {
  return evaluation ? formatResult(evaluation.value, displayUnits, formatNumber) : "—"
}

function invalidAttribute(error: string | undefined) {
  return error ? (true as const) : undefined
}

function useVariableFieldFocus(formElementRef: RefObject<HTMLFormElement | null>) {
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusedRowId) return
    const input = formElementRef.current?.querySelector<HTMLInputElement>(
      `[data-variable-name-id="${focusedRowId}"]`,
    )
    input?.focus()
    input?.select()
  }, [focusedRowId, formElementRef])
  return { focusedRowId, setFocusedRowId }
}

type RenameValidation =
  | { ok: true; name: string }
  | { ok: false; fieldMessage?: string; message: string }

function validateVariableRename(
  variables: readonly VariableDefinition[],
  variablesById: ReadonlyMap<VariableId, VariableDefinition>,
  rowId: VariableId,
  name: string,
  copy: VariablesFormCopy,
): RenameValidation {
  const committed = variablesById.get(rowId)
  if (!committed) return { ok: false, message: copy.renameFailed }
  const parsed = variableNameSchema.safeParse(name)
  if (!parsed.success) {
    return { ok: false, fieldMessage: copy.invalidName, message: copy.validationSummary }
  }
  if (parsed.data === committed.name) {
    return { ok: false, fieldMessage: copy.renameNoChange, message: copy.renameNoChange }
  }
  return variables.some((variable) => variable.id !== rowId && variable.name === parsed.data)
    ? { ok: false, fieldMessage: copy.renameConflict, message: copy.renameConflict }
    : { ok: true, name: parsed.data }
}

function useVariableRename({
  baseRevision,
  copy,
  onRename,
  setFocusedRowId,
  setFieldError,
  clearSubmissionErrors,
  setSubmitMessage,
  variables,
}: {
  baseRevision: number
  copy: VariablesFormCopy
  onRename: (
    baseRevision: number,
    variableId: VariableId,
    name: string,
  ) => Promise<ApplyVariableTableResult>
  setFocusedRowId: (rowId: string | null) => void
  setFieldError: (index: number, message: string | undefined) => void
  clearSubmissionErrors: () => void
  setSubmitMessage: (message: string | null) => void
  variables: readonly VariableDefinition[]
}) {
  const variablesById = useMemo(
    () => new Map(variables.map((variable) => [variable.id, variable])),
    [variables],
  )
  const [rowId, setRowId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const start = (nextRowId: VariableId, rowIndex: number) => {
    clearSubmissionErrors()
    setFieldError(rowIndex, undefined)
    setSubmitMessage(null)
    setRowId(nextRowId)
    setFocusedRowId(nextRowId)
  }
  const cancel = (rowIndex: number) => {
    clearSubmissionErrors()
    setFieldError(rowIndex, undefined)
    setSubmitMessage(null)
    setRowId(null)
    setFocusedRowId(null)
  }
  const confirm = async (variableId: VariableId, rowIndex: number, name: string) => {
    const validated = validateVariableRename(variables, variablesById, variableId, name, copy)
    if (!validated.ok) {
      setFieldError(rowIndex, validated.fieldMessage)
      setSubmitMessage(validated.message)
      setFocusedRowId(variableId)
      return
    }

    setFieldError(rowIndex, undefined)
    setSubmitMessage(null)
    setPending(true)
    try {
      const result = await onRename(baseRevision, variableId, validated.name)
      setSubmitMessage(renameSubmissionMessage(result, copy))
      if (result.ok) {
        setRowId(null)
        setFocusedRowId(null)
      } else if (result.diagnostic.sourceCode === "variable-name-conflict") {
        setFieldError(rowIndex, copy.renameConflict)
      }
    } finally {
      setPending(false)
    }
  }

  return { cancel, confirm, pending, rowId, start, variablesById }
}

function VariablesSearchField({
  copy,
  onValueChange,
  value,
}: {
  copy: Pick<VariablesFormCopy, "search" | "searchPlaceholder" | "clearSearch">
  onValueChange: (value: string) => void
  value: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-2">
      <TextField
        ref={inputRef}
        type="search"
        label={copy.search}
        placeholder={copy.searchPlaceholder}
        className="min-w-0 max-w-sm flex-1"
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault()
        }}
      />
      {value ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            onValueChange("")
            inputRef.current?.focus()
          }}
        >
          {copy.clearSearch}
        </Button>
      ) : null}
    </div>
  )
}

function VariablesFormNotices({
  disabled,
  readOnlyLabel,
  message,
}: {
  disabled: boolean
  readOnlyLabel: string
  message: string | null
}) {
  return (
    <>
      {disabled ? (
        <p className="rounded-md border border-diagnostic-warning/40 bg-panel-muted p-2 text-xs">
          {readOnlyLabel}
        </p>
      ) : null}
      {message ? <Alert>{message}</Alert> : null}
    </>
  )
}

function variablesFormLayout(closeAction: ReactNode, submitAction: ReactNode) {
  if (!closeAction)
    return {
      className: "gap-3",
      tableAction: submitAction,
      content: (body: ReactNode) => body,
    }
  return {
    className: "flex min-h-0 flex-1 flex-col overflow-hidden",
    tableAction: null,
    content: (body: ReactNode) => (
      <>
        <DialogBody>{body}</DialogBody>
        <DialogFooter>
          {closeAction}
          {submitAction}
        </DialogFooter>
      </>
    ),
  }
}

export function VariablesForm({
  baseRevision,
  copy,
  createVariableId,
  disabled = false,
  onApply,
  onRename,
  protectedVariableNames = EMPTY_VARIABLE_NAMES,
  variables,
  dialogCloseAction,
}: {
  baseRevision: number
  copy: VariablesFormCopy
  createVariableId: () => VariableId
  disabled?: boolean
  onApply: (
    baseRevision: number,
    variables: readonly VariableDefinition[],
  ) => Promise<ApplyVariableTableResult>
  onRename: (
    baseRevision: number,
    variableId: VariableId,
    name: string,
  ) => Promise<ApplyVariableTableResult>
  protectedVariableNames?: ReadonlySet<string>
  variables: readonly VariableDefinition[]
  dialogCloseAction?: ReactNode
}) {
  const formatter = useFormatter()
  const displayUnits = useDocumentDisplayUnits()
  const formElementRef = useRef<HTMLFormElement>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const query = searchQuery.trim().toLowerCase()
  const nameQuery = query.replace(/^#/, "")
  const { focusedRowId, setFocusedRowId } = useVariableFieldFocus(formElementRef)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: {
      variables: variables.map((variable) => ({ ...variable, persisted: true })),
    },
    validators: {
      onDynamic: ({ value }) => {
        const parsed = variableDefinitionsSchema.safeParse(
          value.variables.map(({ id, name, expression }) => ({
            schemaVersion: 0 as const,
            id,
            name,
            expression,
          })),
        )
        return parsed.success
          ? undefined
          : { form: copy.validationSummary, fields: issueMessages(parsed.error, copy) }
      },
    },
    onSubmitInvalid: () => setSearchQuery(""),
    onSubmit: async ({ value }) => {
      const parsed = variableDefinitionsSchema.safeParse(
        value.variables.map(({ id, name, expression }) => ({
          schemaVersion: 0 as const,
          id,
          name,
          expression,
        })),
      )
      if (!parsed.success) return
      setSubmitMessage(null)
      const result = await onApply(baseRevision, parsed.data)
      setSubmitMessage(submissionMessage(result, copy))
    },
  })

  const clearSubmissionErrors = () => {
    if (submitMessage) setSubmitMessage(null)
  }

  const setFieldError = (index: number, message: string | undefined) => {
    form.setFieldMeta(`variables[${index}].name`, (meta) => ({
      ...meta,
      isTouched: true,
      isBlurred: true,
      errorMap: { ...meta.errorMap, onSubmit: message },
    }))
  }

  const rename = useVariableRename({
    baseRevision,
    copy,
    onRename,
    setFocusedRowId,
    setFieldError,
    clearSubmissionErrors,
    setSubmitMessage,
    variables,
  })

  const submitAction = (
    <form.SubmitButton disabled={disabled || rename.rowId !== null || rename.pending}>
      {copy.apply}
    </form.SubmitButton>
  )
  const layout = variablesFormLayout(dialogCloseAction, submitAction)

  const body = (
    <>
      <form.FormError />
      <VariablesFormNotices
        disabled={disabled}
        readOnlyLabel={copy.readOnly}
        message={submitMessage}
      />
      <form.AppField name="variables" mode="array">
        {(arrayField) => (
          <form.Subscribe
            selector={(formState) => [formState.values.variables, formState.fieldMeta] as const}
          >
            {([rows, metadata]) => {
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
              const suggestions = variableExpressionSuggestions(rows)

              return (
                <VariablesTable
                  addDisabled={rows.length >= MAX_VARIABLES}
                  copy={copy}
                  disabled={disabled || rename.rowId !== null || rename.pending}
                  searchField={
                    <VariablesSearchField
                      copy={copy}
                      value={searchQuery}
                      onValueChange={setSearchQuery}
                    />
                  }
                  footerAction={layout.tableAction}
                  onAdd={() => {
                    const id = createVariableId()
                    clearSubmissionErrors()
                    setSearchQuery("")
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
                    const errors = fieldErrorProps(
                      metadata[`variables[${index}].name`]?.errors[0],
                      metadata[`variables[${index}].expression`]?.errors[0],
                    )
                    const removal = removalProps(rows, index, protectedVariableNames, copy)
                    const rowRenaming = rename.rowId === row.id
                    const rowLocked = rename.rowId !== null && !rowRenaming
                    const committed = rename.variablesById.get(row.id)

                    return {
                      id: row.id,
                      hidden:
                        !row.name.toLowerCase().includes(nameQuery) &&
                        !row.expression.toLowerCase().includes(query),
                      nameField: (
                        <form.Field name={`variables[${index}].name`}>
                          {(field) => (
                            <Input
                              name={field.name}
                              value={field.state.value}
                              disabled={
                                disabled ||
                                rename.pending ||
                                rowLocked ||
                                (row.persisted && !rowRenaming)
                              }
                              autoFocus={focusedRowId === row.id}
                              data-variable-name-id={row.id}
                              aria-label={copy.nameInput}
                              aria-describedby={`${row.id}-name-error`}
                              aria-invalid={invalidAttribute(errors.nameError)}
                              className="h-8 font-mono"
                              onBlur={field.handleBlur}
                              onFocus={() => setSearchQuery("")}
                              onChange={(event) => {
                                clearSubmissionErrors()
                                field.handleChange(event.currentTarget.value)
                              }}
                            />
                          )}
                        </form.Field>
                      ),
                      expressionField: (
                        <form.AppField name={`variables[${index}].expression`}>
                          {(field) => (
                            <field.VariableExpressionInput
                              disabled={disabled || rename.pending || rename.rowId !== null}
                              excludedSuggestionId={row.id}
                              suggestions={suggestions}
                              aria-label={copy.expressionInput}
                              aria-describedby={`${row.id}-expression-error`}
                              className="h-8 font-mono"
                              onValueChange={clearSubmissionErrors}
                            />
                          )}
                        </form.AppField>
                      ),
                      result: resultText(evaluation, displayUnits, (value) =>
                        formatter.number(value, { maximumFractionDigits: 6 }),
                      ),
                      status: rowStatus(evaluation, hasStructuralIssue, copy),
                      ...errors,
                      actions: (
                        <VariableRowActions
                          canRename={row.persisted}
                          copy={copy}
                          disabled={disabled || rename.pending || rowLocked}
                          renaming={rowRenaming}
                          removeDisabled={Boolean(removal.removeDisabled)}
                          {...(removal.removeDisabledReason
                            ? { removeDisabledReason: removal.removeDisabledReason }
                            : {})}
                          onStartRename={() => {
                            setSearchQuery("")
                            rename.start(row.id, index)
                          }}
                          onCancelRename={() => {
                            if (committed) {
                              arrayField.replaceValue(index, {
                                ...row,
                                name: committed.name,
                              })
                            }
                            rename.cancel(index)
                          }}
                          onConfirmRename={() => rename.confirm(row.id, index, row.name)}
                          onRemove={() => {
                            clearSubmissionErrors()
                            arrayField.removeValue(index)
                          }}
                        />
                      ),
                    }
                  })}
                />
              )
            }}
          </form.Subscribe>
        )}
      </form.AppField>
    </>
  )
  return (
    <Form ref={formElementRef} form={form} className={layout.className} aria-label={copy.caption}>
      {layout.content(body)}
    </Form>
  )
}

export function referencedModelVariableNames(
  variables: readonly VariableDefinition[],
  modelParameters: readonly unknown[],
) {
  const names = new Set(variables.map(({ name }) => name))
  return new Set(
    modelParameters.flatMap(parameterVariableReferences).filter((name) => names.has(name)),
  )
}
