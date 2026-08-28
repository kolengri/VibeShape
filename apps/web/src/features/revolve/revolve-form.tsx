import {
  createAngleQuantity,
  evaluateExpression,
  evaluateVariableDefinitions,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  revolveFeatureParametersSchema,
  revolveFeatureType,
  type SketchProfileSelector,
  type TopoRef,
  type VariableDefinition,
} from "@vibeshape/domain"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useCallback, useEffect, useRef, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultAngleExpression,
  normalizeExpressionWithDisplayUnit,
} from "../../document/document-display-units"
import { submitFeatureMutation } from "../part-design/primitive-form"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import { VariableExpressionField } from "../variables/variable-expression-field"
import { RevolveParameterPanel, type RevolveParameterPanelCopy } from "./revolve-parameter-panel"

type Values = Readonly<{ axis: string; angle: string }>
export type RevolveFormCopy = RevolveParameterPanelCopy &
  Readonly<{
    axis: string
    axisX: string
    axisY: string
    angle: string
    expressionDescription: string
    invalidExpression: string
    invalidDimension: string
    invalidRange: string
    saveFailed: string
    staleRevision: string
    validationSummary: string
    submit: string
  }>
export type RevolveFormMode =
  | Readonly<{
      kind: "create"
      createFeatureId: () => FeatureId
      featureLabel: string
      profile: SketchProfileSelector
      supportReference?: TopoRef
    }>
  | Readonly<{ kind: "edit"; feature: FeatureRecord }>

function valuesFromFeature(feature: FeatureRecord): Values {
  const p = revolveFeatureParametersSchema.parse(feature.parameters)
  return {
    axis: p.axis,
    angle: p.angle.source.expression ?? `${p.angle.source.value} ${p.angle.source.unit}`,
  }
}
function profileForMode(mode: RevolveFormMode) {
  return mode.kind === "create"
    ? mode.profile
    : revolveFeatureParametersSchema.parse(mode.feature.parameters).profile
}
function record(
  mode: RevolveFormMode,
  id: FeatureId,
  parameters: ReturnType<typeof revolveFeatureParametersSchema.parse>,
) {
  const references =
    mode.kind === "create"
      ? mode.supportReference
        ? [mode.supportReference]
        : []
      : mode.feature.references
  const dependencies = [...new Set(references.map(({ featureId }) => featureId))]
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, type: revolveFeatureType.type, parameters, references, dependencies }
      : {
          schemaVersion: 0,
          id,
          type: revolveFeatureType.type,
          parameters,
          references,
          dependencies,
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}
function parseValues(
  values: Values,
  profile: SketchProfileSelector,
  variables: readonly VariableDefinition[],
  unit: "rad" | "deg",
  copy: RevolveFormCopy,
) {
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) return { ok: false as const, message: copy.invalidExpression }
  const expression = normalizeExpressionWithDisplayUnit(values.angle, unit)
  const result = evaluateExpression(expression, evaluated.valuesByName)
  if (!result.ok) return { ok: false as const, message: copy.invalidExpression }
  if (result.value.dimension !== "angle")
    return { ok: false as const, message: copy.invalidDimension }
  const angle = createAngleQuantity(result.value.value, "rad", expression)
  const parsed = revolveFeatureParametersSchema.safeParse({
    profile,
    axis: values.axis,
    angle,
    operation: "new",
  })
  return parsed.success
    ? { ok: true as const, parameters: parsed.data }
    : { ok: false as const, message: copy.invalidRange }
}

export function RevolveForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onSave,
  onSaved,
  onPreviewChange,
  profileLabel,
  variables,
}: {
  baseRevision: number
  copy: RevolveFormCopy
  disabled?: boolean
  mode: RevolveFormMode
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  onPreviewChange?: (feature: FeatureRecord | null) => void
  profileLabel: string
  variables: readonly VariableDefinition[]
}) {
  const {
    clearSubmissionErrors,
    displayUnits,
    formElementRef,
    issues,
    message,
    setIssues,
    setMessage,
    suggestions,
  } = useParameterFormState(variables)
  const profile = profileForMode(mode)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const inputRef = useRef({ mode, profile, variables, copy, displayUnits: displayUnits.angle })
  inputRef.current = { mode, profile, variables, copy, displayUnits: displayUnits.angle }
  const form = useAppForm({
    defaultValues:
      mode.kind === "edit"
        ? valuesFromFeature(mode.feature)
        : { axis: "x", angle: defaultAngleExpression(Math.PI * 2, displayUnits.angle) },
    onSubmit: async ({ value }) => {
      const parsed = parseValues(value, profile, variables, displayUnits.angle, copy)
      if (!parsed.ok) {
        setIssues({ angle: parsed.message })
        setMessage(copy.validationSummary)
        formElementRef.current?.querySelector<HTMLElement>('[name="angle"]')?.focus()
        return
      }
      setIssues({})
      setMessage(null)
      await submitFeatureMutation({
        baseRevision,
        copy,
        feature: record(mode, featureId, parsed.parameters),
        onSave,
        onSaved,
        setMessage,
      })
    },
  })
  const preview = useCallback(
    (values: Values) => {
      if (!onPreviewChange) return null
      const input = inputRef.current
      const parsed = parseValues(
        values,
        input.profile,
        input.variables,
        input.displayUnits,
        input.copy,
      )
      onPreviewChange(parsed.ok ? record(input.mode, featureId, parsed.parameters) : null)
      return null
    },
    [featureId, onPreviewChange],
  )
  useEffect(() => () => onPreviewChange?.(null), [onPreviewChange])
  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      {onPreviewChange ? (
        <form.Subscribe selector={(state) => state.values}>
          {(values) => <PreviewSync values={values} onPreview={preview} />}
        </form.Subscribe>
      ) : null}
      <RevolveParameterPanel
        copy={copy}
        disabled={disabled}
        message={message}
        profileLabel={profileLabel}
        onCancel={onCancel}
        axisField={
          <form.Field name="axis">
            {(field) => (
              <NativeSelectField
                name={field.name}
                value={field.state.value}
                label={copy.axis}
                disabled={disabled}
                onChange={(event) => {
                  clearSubmissionErrors()
                  field.handleChange(event.currentTarget.value)
                }}
              >
                <option value="x">{copy.axisX}</option>
                <option value="y">{copy.axisY}</option>
              </NativeSelectField>
            )}
          </form.Field>
        }
        angleField={
          <form.Field name="angle">
            {(field) => (
              <VariableExpressionField
                id="revolve-angle"
                name={field.name}
                label={copy.angle}
                description={copy.expressionDescription}
                error={issues.angle}
                value={field.state.value}
                disabled={disabled}
                suggestions={suggestions}
                onBlur={field.handleBlur}
                onValueChange={(value: string) => {
                  clearSubmissionErrors()
                  field.handleChange(value)
                }}
              />
            )}
          </form.Field>
        }
        footerAction={
          <form.SubmitButton disabled={disabled} requireDirty={false} size="sm">
            {copy.submit}
          </form.SubmitButton>
        }
      />
    </Form>
  )
}

function PreviewSync({
  values,
  onPreview,
}: {
  values: Values
  onPreview: (values: Values) => null
}) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onPreview(values), 180)
    return () => window.clearTimeout(timeout)
  }, [onPreview, values])
  return null
}
