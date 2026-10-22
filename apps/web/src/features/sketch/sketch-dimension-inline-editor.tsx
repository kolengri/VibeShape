import type {
  DocumentDisplayUnits,
  SketchConstraintDefinition,
  SketchDimensionValue,
  SketchEntity,
  VariableDefinition,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Check, X } from "@vibeshape/ui/components/icons"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import type { CSSProperties, KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import {
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
      <Button
        type="button"
        size="xs"
        variant="ghost"
        aria-pressed={value === "driving"}
        className="aria-pressed:bg-accent"
        onClick={() => onChange("driving")}
      >
        {drivingLabel}
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        aria-pressed={value === "reference"}
        className="aria-pressed:bg-accent"
        onClick={() => onChange("reference")}
      >
        {referenceLabel}
      </Button>
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

function useInlineDimensionForm(props: SketchDimensionInlineEditorProps) {
  const t = useTranslations("app.sketch.viewport")
  return useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: inlineDimensionDefaults(
      props.displayUnits,
      props.initialExpression,
      props.initialKind,
      props.options,
    ),
    validators: {
      onDynamic: ({ value }) => {
        const result = resolveInlineDimensionResult({
          displayUnits: props.displayUnits,
          entities: props.entities,
          expression: value.expression,
          kind: value.kind,
          mode: props.mode,
          valueMode: value.mode,
          variables: props.variables,
        })
        return result
          ? undefined
          : {
              form: t("dimensionInvalid"),
              fields: value.mode === "driving" ? { expression: t("dimensionInvalid") } : {},
            }
      },
    },
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
      if (!result) return
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
}: Readonly<{
  form: InlineDimensionForm
  referenceAvailable: boolean
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
  suggestions,
}: Readonly<{
  ariaLabel: string
  form: InlineDimensionForm
  onEscape: (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void
  suggestions: readonly VariableExpressionSuggestion[]
}>) {
  return (
    <form.Subscribe selector={(state) => state.values.mode}>
      {(dimensionMode) =>
        dimensionMode === "reference" ? null : (
          <form.AppField name="expression">
            {(field) => (
              <field.VariableExpressionInput
                autoFocus
                aria-label={ariaLabel}
                className="h-7 min-w-28 flex-1 font-mono text-xs tabular-nums"
                suggestions={suggestions}
                onKeyDown={onEscape}
              />
            )}
          </form.AppField>
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
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t("dimensionCancel")}
            className="text-muted-foreground"
            onClick={onCancel}
          >
            <X aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("dimensionCancel")}</TooltipContent>
      </Tooltip>
    </>
  )
}

export function SketchDimensionInlineEditor(props: SketchDimensionInlineEditorProps) {
  const t = useTranslations("app.sketch.viewport")
  const form = useInlineDimensionForm(props)
  const suggestions = variableExpressionSuggestions(props.variables)
  const referenceAvailable =
    (props.allowReference ?? true) &&
    props.mode === "create" &&
    props.options.some(
      ({ kind }) => createSketchReferenceDimensionConstraint(kind, props.entities) !== null,
    )
  const cancelOnEscape = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) =>
    cancelDimensionEditor(event, props.onCancel)

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
          <DimensionModeControl form={form} referenceAvailable={referenceAvailable} />
          <DimensionExpressionControl
            ariaLabel={props.expressionAriaLabel ?? t("dimensionExpression")}
            form={form}
            onEscape={cancelOnEscape}
            suggestions={suggestions}
          />
          <DimensionEditorActions form={form} onCancel={props.onCancel} />
        </div>
        <form.FormError />
      </Form>
    </div>
  )
  return typeof document === "undefined" ? editor : createPortal(editor, document.body)
}
