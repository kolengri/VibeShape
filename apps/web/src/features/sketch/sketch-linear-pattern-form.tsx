import {
  type DocumentDisplayUnits,
  type EvaluatedVariable,
  type ExpressionValue,
  evaluateVariableDefinitions,
  type LinearSketchPatternDefinition,
  MAX_SKETCH_PATTERN_INSTANCES,
  type VariableDefinition,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useMemo, useState } from "react"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { TanStackBooleanParameterField } from "../part-design/boolean-parameter-field"
import { variableExpressionSuggestions } from "../variables/variable-expression-input"
import { SketchExpressionFormField } from "./sketch-expression-form-field"
import { SketchFormActions } from "./sketch-form-actions"
import {
  evaluateSketchPatternExpression,
  stableSketchPatternScalar,
} from "./sketch-pattern-form-values"

type LinearSketchPatternFormValues = Readonly<{
  firstAngle: string
  firstCount: string
  firstSpacing: string
  secondAngle: string
  secondCount: string
  secondDirection: boolean
  secondSpacing: string
}>

export const defaultLinearSketchPatternDefinition: LinearSketchPatternDefinition = {
  first: { angleRadians: 0, count: 3, spacing: 20 },
  second: null,
}

function defaultValues(
  value: LinearSketchPatternDefinition,
  displayUnits: DocumentDisplayUnits,
): LinearSketchPatternFormValues {
  const second = value.second ?? {
    angleRadians: Math.PI / 2,
    count: 2,
    spacing: value.first.spacing,
  }
  return {
    firstAngle: defaultAngleExpression(value.first.angleRadians, displayUnits.angle),
    firstCount: stableSketchPatternScalar(value.first.count),
    firstSpacing: defaultLengthExpression(value.first.spacing, displayUnits.length),
    secondAngle: defaultAngleExpression(second.angleRadians, displayUnits.angle),
    secondCount: stableSketchPatternScalar(second.count),
    secondDirection: value.second !== null,
    secondSpacing: defaultLengthExpression(second.spacing, displayUnits.length),
  }
}

type PatternDirectionExpressions = Readonly<{
  angle: string
  count: string
  spacing: string
}>

function patternCount(value: ExpressionValue | null) {
  return value?.dimension === "scalar" && Number.isInteger(value.value) && value.value >= 2
    ? value.value
    : null
}

function patternSpacing(value: ExpressionValue | null) {
  return value?.dimension === "length" && value.value > 0 ? value.value : null
}

function patternAngle(value: ExpressionValue | null) {
  return value?.dimension === "angle" ? value.value : null
}

function evaluatedPatternDirection(
  expressions: PatternDirectionExpressions,
  variables: ReadonlyMap<string, ExpressionValue | EvaluatedVariable>,
  displayUnits: DocumentDisplayUnits,
) {
  const count = patternCount(evaluateSketchPatternExpression(expressions.count, variables))
  const spacing = patternSpacing(
    evaluateSketchPatternExpression(expressions.spacing, variables, displayUnits.length),
  )
  const angle = patternAngle(
    evaluateSketchPatternExpression(expressions.angle, variables, displayUnits.angle),
  )
  return count === null || spacing === null || angle === null
    ? null
    : { angleRadians: angle, count, spacing }
}

export function evaluateLinearSketchPatternForm(
  values: LinearSketchPatternFormValues,
  variables: readonly VariableDefinition[],
  displayUnits: DocumentDisplayUnits,
): LinearSketchPatternDefinition | null {
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  if (!evaluatedVariables.ok) return null
  const { valuesByName } = evaluatedVariables
  const first = evaluatedPatternDirection(
    { angle: values.firstAngle, count: values.firstCount, spacing: values.firstSpacing },
    valuesByName,
    displayUnits,
  )
  if (!first) return null
  const second = values.secondDirection
    ? evaluatedPatternDirection(
        {
          angle: values.secondAngle,
          count: values.secondCount,
          spacing: values.secondSpacing,
        },
        valuesByName,
        displayUnits,
      )
    : null
  if (values.secondDirection && !second) return null
  if (first.count * (second?.count ?? 1) > MAX_SKETCH_PATTERN_INSTANCES) return null
  return { first, second }
}

export function SketchLinearPatternForm({
  initialValue = defaultLinearSketchPatternDefinition,
  variables,
  onApply,
  onCancel,
  onPreview,
}: Readonly<{
  initialValue?: LinearSketchPatternDefinition
  variables: readonly VariableDefinition[]
  onApply: (value: LinearSketchPatternDefinition) => void
  onCancel: () => void
  onPreview: (value: LinearSketchPatternDefinition | null) => void
}>) {
  const t = useTranslations("app.sketch.linearPattern")
  const displayUnits = useDocumentDisplayUnits()
  const [message, setMessage] = useState<string | null>(null)
  const suggestions = useMemo(() => variableExpressionSuggestions(variables), [variables])
  const form = useAppForm({
    defaultValues: defaultValues(initialValue, displayUnits),
    onSubmit: ({ value }) => {
      const definition = evaluateLinearSketchPatternForm(value, variables, displayUnits)
      if (!definition) {
        setMessage(t("invalid"))
        return
      }
      setMessage(null)
      onApply(definition)
    },
  })
  const updatePreview = (
    field: keyof LinearSketchPatternFormValues,
    value: LinearSketchPatternFormValues[typeof field],
  ) => {
    setMessage(null)
    onPreview(
      evaluateLinearSketchPatternForm(
        { ...form.state.values, [field]: value },
        variables,
        displayUnits,
      ),
    )
  }
  const fields = [
    { label: t("firstCount"), name: "firstCount" },
    { label: t("firstSpacing"), name: "firstSpacing" },
    { label: t("firstAngle"), name: "firstAngle" },
    { label: t("secondCount"), name: "secondCount" },
    { label: t("secondSpacing"), name: "secondSpacing" },
    { label: t("secondAngle"), name: "secondAngle" },
  ] as const
  const renderFields = (items: readonly (typeof fields)[number][]) =>
    items.map(({ label, name }) => (
      <form.Field key={name} name={name}>
        {(field) => (
          <SketchExpressionFormField
            field={field}
            id={`sketch-linear-pattern-${name}`}
            label={label}
            suggestions={suggestions}
            onValueChange={(nextValue) => {
              updatePreview(name, nextValue)
            }}
          />
        )}
      </form.Field>
    ))
  return (
    <Form
      aria-label={t("title")}
      className="absolute bottom-3 right-3 z-10 w-80 max-w-[calc(100%-1.5rem)] gap-3 bg-background/95 p-3 shadow-md"
      form={form}
      variant="panel"
    >
      <div className="grid grid-cols-2 gap-2">{renderFields(fields.slice(0, 3))}</div>
      <form.Field name="secondDirection">
        {(field) => (
          <TanStackBooleanParameterField
            field={field}
            label={t("secondDirection")}
            onBeforeChange={() => {
              updatePreview("secondDirection", !field.state.value)
            }}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.secondDirection}>
        {(secondDirection) =>
          secondDirection ? (
            <div className="grid grid-cols-2 gap-2">{renderFields(fields.slice(3))}</div>
          ) : null
        }
      </form.Subscribe>
      {message ? (
        <p className="text-xs text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <SketchFormActions
        cancelLabel={t("cancel")}
        submit={
          <form.SubmitButton requireDirty={false} size="sm">
            {t("apply")}
          </form.SubmitButton>
        }
        onCancel={onCancel}
      />
    </Form>
  )
}
