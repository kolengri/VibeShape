import {
  type CircularSketchPatternDefinition,
  type DocumentDisplayUnits,
  evaluateVariableDefinitions,
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

type CircularSketchPatternFormValues = Readonly<{
  angle: string
  centerX: string
  centerY: string
  closed: boolean
  count: string
}>

export const defaultCircularSketchPatternDefinition: CircularSketchPatternDefinition = {
  angleRadians: Math.PI * 2,
  center: { x: 0, y: 0 },
  closed: true,
  count: 3,
}

function defaultValues(
  value: CircularSketchPatternDefinition,
  displayUnits: DocumentDisplayUnits,
): CircularSketchPatternFormValues {
  return {
    angle: defaultAngleExpression(value.closed ? Math.PI : value.angleRadians, displayUnits.angle),
    centerX: defaultLengthExpression(value.center.x, displayUnits.length),
    centerY: defaultLengthExpression(value.center.y, displayUnits.length),
    closed: value.closed,
    count: stableSketchPatternScalar(value.count),
  }
}

export function evaluateCircularSketchPatternForm(
  values: CircularSketchPatternFormValues,
  variables: readonly VariableDefinition[],
  displayUnits: DocumentDisplayUnits,
): CircularSketchPatternDefinition | null {
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  if (!evaluatedVariables.ok) return null
  const { valuesByName } = evaluatedVariables
  const centerX = evaluateSketchPatternExpression(values.centerX, valuesByName, displayUnits.length)
  const centerY = evaluateSketchPatternExpression(values.centerY, valuesByName, displayUnits.length)
  const count = evaluateSketchPatternExpression(values.count, valuesByName)
  const angle = values.closed
    ? ({ dimension: "angle", value: Math.PI * 2 } as const)
    : evaluateSketchPatternExpression(values.angle, valuesByName, displayUnits.angle)
  if (
    centerX?.dimension !== "length" ||
    centerY?.dimension !== "length" ||
    count?.dimension !== "scalar" ||
    !Number.isInteger(count.value) ||
    count.value < 2 ||
    count.value > MAX_SKETCH_PATTERN_INSTANCES ||
    angle?.dimension !== "angle" ||
    (!values.closed &&
      (Math.abs(angle.value) <= Number.EPSILON || Math.abs(angle.value) >= Math.PI * 2))
  ) {
    return null
  }
  return {
    angleRadians: angle.value,
    center: { x: centerX.value, y: centerY.value },
    closed: values.closed,
    count: count.value,
  }
}

export function SketchCircularPatternForm({
  initialValue = defaultCircularSketchPatternDefinition,
  variables,
  onApply,
  onCancel,
  onPreview,
}: Readonly<{
  initialValue?: CircularSketchPatternDefinition
  variables: readonly VariableDefinition[]
  onApply: (value: CircularSketchPatternDefinition) => void
  onCancel: () => void
  onPreview: (value: CircularSketchPatternDefinition | null) => void
}>) {
  const t = useTranslations("app.sketch.circularPattern")
  const displayUnits = useDocumentDisplayUnits()
  const [message, setMessage] = useState<string | null>(null)
  const suggestions = useMemo(() => variableExpressionSuggestions(variables), [variables])
  const form = useAppForm({
    defaultValues: defaultValues(initialValue, displayUnits),
    onSubmit: ({ value }) => {
      const definition = evaluateCircularSketchPatternForm(value, variables, displayUnits)
      if (!definition) {
        setMessage(t("invalid"))
        return
      }
      setMessage(null)
      onApply(definition)
    },
  })
  const updatePreview = (
    field: keyof CircularSketchPatternFormValues,
    value: CircularSketchPatternFormValues[typeof field],
  ) => {
    setMessage(null)
    onPreview(
      evaluateCircularSketchPatternForm(
        { ...form.state.values, [field]: value },
        variables,
        displayUnits,
      ),
    )
  }
  const fields = [
    { label: t("centerX"), name: "centerX" },
    { label: t("centerY"), name: "centerY" },
    { label: t("count"), name: "count" },
  ] as const
  return (
    <Form
      aria-label={t("title")}
      className="absolute bottom-3 right-3 z-10 w-80 max-w-[calc(100%-1.5rem)] gap-3 bg-background/95 p-3 shadow-md"
      form={form}
      variant="panel"
    >
      <div className="grid grid-cols-2 gap-2">
        {fields.map(({ label, name }) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <SketchExpressionFormField
                field={field}
                id={`sketch-circular-pattern-${name}`}
                label={label}
                suggestions={suggestions}
                onValueChange={(nextValue) => {
                  updatePreview(name, nextValue)
                }}
              />
            )}
          </form.Field>
        ))}
      </div>
      <form.Field name="closed">
        {(field) => (
          <TanStackBooleanParameterField
            field={field}
            label={t("closed")}
            onBeforeChange={() => {
              updatePreview("closed", !field.state.value)
            }}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.closed}>
        {(closed) =>
          closed ? null : (
            <form.Field name="angle">
              {(field) => (
                <SketchExpressionFormField
                  field={field}
                  id="sketch-circular-pattern-angle"
                  label={t("angle")}
                  suggestions={suggestions}
                  onValueChange={(nextValue) => {
                    updatePreview("angle", nextValue)
                  }}
                />
              )}
            </form.Field>
          )
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
