import {
  type DocumentDisplayUnits,
  type EvaluatedVariable,
  type ExpressionValue,
  evaluateExpression,
  evaluateVariableDefinitions,
  type SketchPoint2,
  type VariableDefinition,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useMemo, useState } from "react"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  normalizeExpressionWithDisplayUnit,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { variableExpressionSuggestions } from "../variables/variable-expression-input"
import { SketchExpressionFormField } from "./sketch-expression-form-field"
import { SketchFormActions } from "./sketch-form-actions"
import type { SketchTransformPreview } from "./sketch-transform-manipulator"

export type SketchTransformExactValue = Readonly<{
  origin: SketchPoint2
  preview: SketchTransformPreview
}>

type SketchTransformFormValues = Readonly<{
  originX: string
  originY: string
  rotation: string
  scale: string
  translationX: string
  translationY: string
}>

function stableScalarExpression(value: number) {
  return Number(value.toPrecision(12)).toString()
}

function defaultTransformFormValues(
  value: SketchTransformExactValue,
  displayUnits: DocumentDisplayUnits,
): SketchTransformFormValues {
  return {
    originX: defaultLengthExpression(value.origin.x, displayUnits.length),
    originY: defaultLengthExpression(value.origin.y, displayUnits.length),
    rotation: defaultAngleExpression(value.preview.rotationRadians, displayUnits.angle),
    scale: stableScalarExpression(value.preview.scale),
    translationX: defaultLengthExpression(value.preview.translation.x, displayUnits.length),
    translationY: defaultLengthExpression(value.preview.translation.y, displayUnits.length),
  }
}

function evaluatedValue(
  expression: string,
  variables: ReadonlyMap<string, ExpressionValue | EvaluatedVariable>,
) {
  const result = evaluateExpression(expression, variables)
  return result.ok ? result.value : null
}

export function evaluateSketchTransformForm(
  values: SketchTransformFormValues,
  variables: readonly VariableDefinition[],
  displayUnits: DocumentDisplayUnits,
): SketchTransformExactValue | null {
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  if (!evaluatedVariables.ok) return null
  const length = (expression: string) =>
    evaluatedValue(
      normalizeExpressionWithDisplayUnit(expression, displayUnits.length),
      evaluatedVariables.valuesByName,
    )
  const angle = evaluatedValue(
    normalizeExpressionWithDisplayUnit(values.rotation, displayUnits.angle),
    evaluatedVariables.valuesByName,
  )
  const scale = evaluatedValue(values.scale.trim(), evaluatedVariables.valuesByName)
  const originX = length(values.originX)
  const originY = length(values.originY)
  const translationX = length(values.translationX)
  const translationY = length(values.translationY)
  if (
    originX?.dimension !== "length" ||
    originY?.dimension !== "length" ||
    translationX?.dimension !== "length" ||
    translationY?.dimension !== "length" ||
    angle?.dimension !== "angle" ||
    scale?.dimension !== "scalar" ||
    scale.value <= 0
  ) {
    return null
  }
  return {
    origin: { x: originX.value, y: originY.value },
    preview: {
      rotationRadians: angle.value,
      scale: scale.value,
      translation: { x: translationX.value, y: translationY.value },
    },
  }
}

export function SketchTransformForm({
  value,
  variables,
  onApply,
  onCancel,
}: Readonly<{
  value: SketchTransformExactValue
  variables: readonly VariableDefinition[]
  onApply: (value: SketchTransformExactValue) => void
  onCancel: () => void
}>) {
  const t = useTranslations("app.sketch.transform")
  const displayUnits = useDocumentDisplayUnits()
  const [message, setMessage] = useState<string | null>(null)
  const suggestions = useMemo(() => variableExpressionSuggestions(variables), [variables])
  const defaultValues = useMemo(
    () => defaultTransformFormValues(value, displayUnits),
    [
      displayUnits.angle,
      displayUnits.length,
      value.origin.x,
      value.origin.y,
      value.preview.rotationRadians,
      value.preview.scale,
      value.preview.translation.x,
      value.preview.translation.y,
    ],
  )
  const form = useAppForm({
    defaultValues,
    onSubmit: ({ value: submitted }) => {
      const transform = evaluateSketchTransformForm(submitted, variables, displayUnits)
      if (!transform) {
        setMessage(t("invalid"))
        return
      }
      setMessage(null)
      onApply(transform)
    },
  })
  useEffect(() => {
    form.reset(defaultValues)
    setMessage(null)
  }, [defaultValues, form])
  const fields = [
    { label: t("originX"), name: "originX" },
    { label: t("originY"), name: "originY" },
    { label: t("translationX"), name: "translationX" },
    { label: t("translationY"), name: "translationY" },
    { label: t("rotation"), name: "rotation" },
    { label: t("scale"), name: "scale" },
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
                id={`sketch-transform-${name}`}
                label={label}
                suggestions={suggestions}
                onValueChange={() => setMessage(null)}
              />
            )}
          </form.Field>
        ))}
      </div>
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
