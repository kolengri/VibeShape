import {
  type CircularSketchPatternDefinition,
  type DocumentDisplayUnits,
  evaluateVariableDefinitions,
  MAX_SKETCH_PATTERN_INSTANCES,
  type VariableDefinition,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { useMemo } from "react"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { variableExpressionSuggestions } from "../variables/variable-expression-input"
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
  const suggestions = useMemo(() => variableExpressionSuggestions(variables), [variables])
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: defaultValues(initialValue, displayUnits),
    validators: {
      onDynamic: ({ value }) =>
        evaluateCircularSketchPatternForm(value, variables, displayUnits)
          ? undefined
          : t("invalid"),
    },
    onSubmit: ({ value }) => {
      const definition = evaluateCircularSketchPatternForm(value, variables, displayUnits)
      if (!definition) return
      onApply(definition)
    },
  })
  const updatePreview = (
    field: keyof CircularSketchPatternFormValues,
    value: CircularSketchPatternFormValues[typeof field],
  ) => {
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
      <div className="grid gap-2">
        {fields.map(({ label, name }) => (
          <form.AppField key={name} name={name}>
            {(field) => (
              <field.VariableExpressionField
                id={`sketch-circular-pattern-${name}`}
                label={label}
                suggestions={suggestions}
                inputClassName="font-mono tabular-nums"
                onValueChange={(nextValue) => {
                  updatePreview(name, nextValue)
                }}
              />
            )}
          </form.AppField>
        ))}
      </div>
      <form.AppField name="closed">
        {(field) => (
          <field.CheckboxField
            label={t("closed")}
            onValueChange={(checked) => {
              updatePreview("closed", checked)
            }}
          />
        )}
      </form.AppField>
      <form.Subscribe selector={(state) => state.values.closed}>
        {(closed) =>
          closed ? null : (
            <form.AppField name="angle">
              {(field) => (
                <field.VariableExpressionField
                  id="sketch-circular-pattern-angle"
                  label={t("angle")}
                  suggestions={suggestions}
                  inputClassName="font-mono tabular-nums"
                  onValueChange={(nextValue) => {
                    updatePreview("angle", nextValue)
                  }}
                />
              )}
            </form.AppField>
          )
        }
      </form.Subscribe>
      <form.FormError />
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
