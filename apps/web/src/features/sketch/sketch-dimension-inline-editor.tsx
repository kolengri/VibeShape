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
import {
  VariableExpressionInput,
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

export function SketchDimensionInlineEditor({
  displayUnits,
  entities,
  initialExpression,
  initialKind,
  mode,
  onCancel,
  onSubmit,
  options,
  position,
  variables,
}: Readonly<{
  displayUnits: DocumentDisplayUnits
  entities: readonly SketchEntity[]
  initialExpression?: string
  initialKind: SketchDimensionKind
  mode: "create" | "edit"
  onCancel: () => void
  onSubmit: (result: SketchDimensionInlineEditorResult) => void
  options: readonly SketchDimensionOption[]
  position: CSSProperties
  variables: readonly VariableDefinition[]
}>) {
  const t = useTranslations("app.sketch.viewport")
  const [message, setMessage] = useState<string | null>(null)
  const suggestions = variableExpressionSuggestions(variables)
  const referenceAvailable = options.some(
    ({ kind }) => createSketchReferenceDimensionConstraint(kind, entities) !== null,
  )
  const form = useAppForm({
    defaultValues: inlineDimensionDefaults(displayUnits, initialExpression, initialKind, options),
    onSubmit: ({ value }) => {
      const result = resolveInlineDimensionResult({
        displayUnits,
        entities,
        expression: value.expression,
        kind: value.kind,
        mode,
        valueMode: value.mode,
        variables,
      })
      if (!result) {
        setMessage(t("dimensionInvalid"))
        return
      }
      onSubmit(result)
    },
  })
  const cancelOnEscape = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) =>
    cancelDimensionEditor(event, onCancel)

  return (
    <div
      className="absolute z-30 min-w-52 -translate-y-1/2 rounded-md border border-primary/60 bg-popover p-1.5 text-popover-foreground shadow-lg"
      data-sketch-dimension-editor
      style={position}
    >
      <Form form={form} aria-label={t("dimensionInlineEditor")} className="gap-1.5">
        <div className="flex items-center gap-1">
          {options.length > 1 ? (
            <form.Field name="kind">
              {(field) => (
                <NativeSelect
                  aria-label={t("dimensionType")}
                  className="h-7 w-auto max-w-32 text-xs"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onKeyDown={cancelOnEscape}
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
          ) : null}
          {mode === "create" && referenceAvailable ? (
            <form.Field name="mode">
              {(field) => (
                <DimensionModeButtons
                  drivingLabel={t("driving")}
                  label={t("dimensionMode")}
                  referenceLabel={t("reference")}
                  value={field.state.value}
                  onChange={(value) => {
                    setMessage(null)
                    field.handleChange(value)
                  }}
                />
              )}
            </form.Field>
          ) : null}
          <form.Subscribe selector={(state) => state.values.mode}>
            {(dimensionMode) =>
              dimensionMode === "reference" ? null : (
                <form.Field name="expression">
                  {(field) => (
                    <VariableExpressionInput
                      autoFocus
                      aria-label={t("dimensionExpression")}
                      className="h-7 min-w-28 flex-1 font-mono text-xs tabular-nums"
                      name={field.name}
                      suggestions={suggestions}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onKeyDown={cancelOnEscape}
                      onValueChange={(value) => {
                        setMessage(null)
                        field.handleChange(value)
                      }}
                    />
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
          <Tooltip>
            <TooltipTrigger asChild>
              <form.SubmitButton
                aria-label={t("dimensionApply")}
                requireDirty={false}
                size="icon-xs"
              >
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
        </div>
        <FieldError className="max-w-64 text-[10px] leading-3">{message}</FieldError>
      </Form>
    </div>
  )
}
