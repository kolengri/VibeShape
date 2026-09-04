import type {
  DocumentDisplayUnits,
  SketchConstraintDefinition,
  SketchDimensionValue,
  SketchEntity,
  VariableDefinition,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { FieldError } from "@vibeshape/ui/components/field"
import { Check, X } from "@vibeshape/ui/components/icons"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import type { CSSProperties, KeyboardEvent } from "react"
import { useState } from "react"
import { createPortal } from "react-dom"
import {
  VariableExpressionInput,
  type VariableExpressionSuggestion,
  variableExpressionSuggestions,
} from "../variables/variable-expression-input"
import {
  createSketchReferenceDimensionConstraint,
  type SketchDimensionKind,
} from "./sketch-constraint-tools"
import {
  createSketchDimensionDefinition,
  defaultSketchDimensionExpression,
  evaluateSketchDimensionValue,
} from "./sketch-dimension-value"

export type SketchDimensionOption = Readonly<{
  kind: SketchDimensionKind
  label: string
  value: number
}>

export type SketchDimensionInlineEditorResult =
  | Readonly<{ definition: SketchConstraintDefinition; kind: "create" }>
  | Readonly<{ kind: "edit"; value: SketchDimensionValue }>

function resolveInlineDimensionResult({
  displayUnits,
  entities,
  expression,
  kind,
  mode,
  valueMode,
  variables,
}: Readonly<{
  displayUnits: DocumentDisplayUnits
  entities: readonly SketchEntity[]
  expression: string
  kind: SketchDimensionKind
  mode: "create" | "edit"
  valueMode: "driving" | "reference"
  variables: readonly VariableDefinition[]
}>): SketchDimensionInlineEditorResult | null {
  if (mode === "create" && valueMode === "reference") {
    const definition = createSketchReferenceDimensionConstraint(kind, entities)
    return definition ? { definition, kind: "create" } : null
  }
  if (mode === "create") {
    const definition = createSketchDimensionDefinition(
      kind,
      expression,
      entities,
      variables,
      displayUnits,
    )
    return definition ? { definition, kind: "create" } : null
  }
  const value = evaluateSketchDimensionValue(kind, expression, variables, displayUnits)
  return value ? { kind: "edit", value } : null
}

function DimensionModeButtons({
  drivingLabel,
  label,
  onChange,
  referenceLabel,
  value,
}: Readonly<{
  drivingLabel: string
  label: string
  onChange: (value: "driving" | "reference") => void
  referenceLabel: string
  value: "driving" | "reference"
}>) {
  return (
    <fieldset className="flex rounded-sm border p-0.5">
      <legend className="sr-only">{label}</legend>
      <button
        type="button"
        aria-pressed={value === "driving"}
        className="rounded-sm px-1.5 py-1 text-[10px] hover:bg-accent aria-pressed:bg-accent"
        onClick={() => onChange("driving")}
      >
        {drivingLabel}
      </button>
      <button
        type="button"
        aria-pressed={value === "reference"}
        className="rounded-sm px-1.5 py-1 text-[10px] hover:bg-accent aria-pressed:bg-accent"
        onClick={() => onChange("reference")}
      >
        {referenceLabel}
      </button>
    </fieldset>
  )
}

function inlineDimensionDefaults(
  displayUnits: DocumentDisplayUnits,
  initialExpression: string | undefined,
  initialKind: SketchDimensionKind,
  options: readonly SketchDimensionOption[],
) {
  const initialOption = options.find(({ kind }) => kind === initialKind) ?? options[0]
  const kind = initialOption?.kind ?? initialKind
  return {
    expression:
      initialExpression ??
      defaultSketchDimensionExpression(kind, initialOption?.value ?? 10, displayUnits),
    kind,
    mode: "driving" as "driving" | "reference",
  }
}

function cancelDimensionEditor(
  event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  onCancel: () => void,
) {
  if (event.key !== "Escape") return
  event.preventDefault()
  event.stopPropagation()
  onCancel()
}

type SketchDimensionInlineEditorProps = Readonly<{
  allowReference?: boolean
  displayUnits: DocumentDisplayUnits
  entities: readonly SketchEntity[]
  expressionAriaLabel?: string
  formAriaLabel?: string
  initialExpression?: string
  initialKind: SketchDimensionKind
  mode: "create" | "edit"
  onCancel: () => void
  onSubmit: (result: SketchDimensionInlineEditorResult) => void
  options: readonly SketchDimensionOption[]
  position: CSSProperties
  variables: readonly VariableDefinition[]
}>

function useInlineDimensionForm(
  props: SketchDimensionInlineEditorProps,
  setMessage: (message: string | null) => void,
) {
  const t = useTranslations("app.sketch.viewport")
  return useAppForm({
    defaultValues: inlineDimensionDefaults(
      props.displayUnits,
      props.initialExpression,
      props.initialKind,
      props.options,
    ),
    onSubmit: ({ value }) => {
      const result = resolveInlineDimensionResult({
        displayUnits: props.displayUnits,
        entities: props.entities,
        expression: value.expression,
        kind: value.kind,
        mode: props.mode,
        valueMode: value.mode,
        variables: props.variables,
      })
      if (!result) {
        setMessage(t("dimensionInvalid"))
        return
      }
      props.onSubmit(result)
    },
  })
}

type InlineDimensionForm = ReturnType<typeof useInlineDimensionForm>

function DimensionKindControl({
  displayUnits,
  form,
  onEscape,
  options,
}: Readonly<{
  displayUnits: DocumentDisplayUnits
  form: InlineDimensionForm
  onEscape: (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void
  options: readonly SketchDimensionOption[]
}>) {
  const t = useTranslations("app.sketch.viewport")
  if (options.length <= 1) {
    return (
      <span
        className="px-1 text-[10px] font-medium text-muted-foreground"
        data-sketch-dimension-kind={options[0]?.kind}
      >
        {options[0]?.label}
      </span>
    )
  }
  return (
    <form.Field name="kind">
      {(field) => (
        <NativeSelect
          aria-label={t("dimensionType")}
          className="h-7 w-auto max-w-32 text-xs"
          name={field.name}
          value={field.state.value}
          onBlur={field.handleBlur}
          onKeyDown={onEscape}
          onChange={(event) => {
            const kind = event.currentTarget.value as SketchDimensionKind
            field.handleChange(kind)
            const option = options.find((candidate) => candidate.kind === kind)
            form.setFieldValue(
              "expression",
              defaultSketchDimensionExpression(kind, option?.value ?? 10, displayUnits),
            )
          }}
        >
          {options.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      )}
    </form.Field>
  )
}

function DimensionModeControl({
  form,
  referenceAvailable,
  resetMessage,
}: Readonly<{
  form: InlineDimensionForm
  referenceAvailable: boolean
  resetMessage: () => void
}>) {
  const t = useTranslations("app.sketch.viewport")
  if (!referenceAvailable) return null
  return (
    <form.Field name="mode">
      {(field) => (
        <DimensionModeButtons
          drivingLabel={t("driving")}
          label={t("dimensionMode")}
          referenceLabel={t("reference")}
          value={field.state.value}
          onChange={(value) => {
            resetMessage()
            field.handleChange(value)
          }}
        />
      )}
    </form.Field>
  )
}

function DimensionExpressionControl({
  ariaLabel,
  form,
  onEscape,
  resetMessage,
  suggestions,
}: Readonly<{
  ariaLabel: string
  form: InlineDimensionForm
  onEscape: (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void
  resetMessage: () => void
  suggestions: readonly VariableExpressionSuggestion[]
}>) {
  return (
    <form.Subscribe selector={(state) => state.values.mode}>
      {(dimensionMode) =>
        dimensionMode === "reference" ? null : (
          <form.Field name="expression">
            {(field) => (
              <VariableExpressionInput
                autoFocus
                aria-label={ariaLabel}
                className="h-7 min-w-28 flex-1 font-mono text-xs tabular-nums"
                name={field.name}
                suggestions={suggestions}
                value={field.state.value}
                onBlur={field.handleBlur}
                onKeyDown={onEscape}
                onValueChange={(value) => {
                  resetMessage()
                  field.handleChange(value)
                }}
              />
            )}
          </form.Field>
        )
      }
    </form.Subscribe>
  )
}

function DimensionEditorActions({
  form,
  onCancel,
}: Readonly<{ form: InlineDimensionForm; onCancel: () => void }>) {
  const t = useTranslations("app.sketch.viewport")
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <form.SubmitButton aria-label={t("dimensionApply")} requireDirty={false} size="icon-xs">
            <Check aria-hidden="true" />
          </form.SubmitButton>
        </TooltipTrigger>
        <TooltipContent>{t("dimensionApply")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("dimensionCancel")}
            className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={onCancel}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("dimensionCancel")}</TooltipContent>
      </Tooltip>
    </>
  )
}

export function SketchDimensionInlineEditor(props: SketchDimensionInlineEditorProps) {
  const t = useTranslations("app.sketch.viewport")
  const [message, setMessage] = useState<string | null>(null)
  const form = useInlineDimensionForm(props, setMessage)
  const suggestions = variableExpressionSuggestions(props.variables)
  const referenceAvailable =
    (props.allowReference ?? true) &&
    props.mode === "create" &&
    props.options.some(
      ({ kind }) => createSketchReferenceDimensionConstraint(kind, props.entities) !== null,
    )
  const cancelOnEscape = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) =>
    cancelDimensionEditor(event, props.onCancel)
  const resetMessage = () => setMessage(null)

  const editor = (
    <div
      className="absolute z-50 min-w-52 max-w-[calc(100%-1rem)] -translate-y-1/2 rounded-md border border-primary/60 bg-popover p-1.5 text-popover-foreground shadow-lg"
      data-sketch-dimension-editor
      style={props.position}
    >
      <Form
        form={form}
        aria-label={props.formAriaLabel ?? t("dimensionInlineEditor")}
        className="gap-1.5"
      >
        <div className="flex items-center gap-1">
          <DimensionKindControl
            displayUnits={props.displayUnits}
            form={form}
            onEscape={cancelOnEscape}
            options={props.options}
          />
          <DimensionModeControl
            form={form}
            referenceAvailable={referenceAvailable}
            resetMessage={resetMessage}
          />
          <DimensionExpressionControl
            ariaLabel={props.expressionAriaLabel ?? t("dimensionExpression")}
            form={form}
            onEscape={cancelOnEscape}
            resetMessage={resetMessage}
            suggestions={suggestions}
          />
          <DimensionEditorActions form={form} onCancel={props.onCancel} />
        </div>
        <FieldError className="max-w-64 text-[10px] leading-3">{message}</FieldError>
      </Form>
    </div>
  )
  return typeof document === "undefined" ? editor : createPortal(editor, document.body)
}
