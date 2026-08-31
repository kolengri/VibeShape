import {
  createAngleQuantity,
  evaluateExpression,
  evaluateVariableDefinitions,
  extrusionOperationSchema,
  type FeatureId,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
  revolveFeatureParametersSchema,
  revolveFeatureType,
  type SketchProfileSelector,
  type TopoRef,
  type VariableDefinition,
} from "@vibeshape/domain"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useRef, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultAngleExpression,
  normalizeExpressionWithDisplayUnit,
} from "../../document/document-display-units"
import { submitFeatureMutation } from "../part-design/primitive-form"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import { VariableExpressionField } from "../variables/variable-expression-field"
import { RevolveParameterPanel, type RevolveParameterPanelCopy } from "./revolve-parameter-panel"

const EMPTY_TARGET_OPTIONS = [] as const

type Values = Readonly<{ axis: string; angle: string; operation: string; targetFeatureId: string }>
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
    missingTarget: string
    operation: string
    operationAdd: string
    operationIntersect: string
    operationNew: string
    operationRemove: string
    saveFailed: string
    staleRevision: string
    validationSummary: string
    submit: string
    target: string
    targetDescription: string
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
    operation: p.operation,
    targetFeatureId: feature.dependencies[0] ?? "",
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
  targetFeatureId: FeatureId | null,
) {
  const references =
    mode.kind === "create"
      ? mode.supportReference
        ? [mode.supportReference]
        : []
      : mode.feature.references
  const dependencies = [targetFeatureId, ...references.map(({ featureId }) => featureId)].flatMap(
    (item, index, values) => (item && values.indexOf(item) === index ? [item] : []),
  )
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
  options: readonly { id: FeatureId; label: string }[],
) {
  const angle = parseAngle(values.angle, variables, unit, copy)
  if (!angle.ok) return angle
  const operation = extrusionOperationSchema.parse(values.operation)
  const target = parseTarget(values.targetFeatureId, operation, options, copy)
  if (!target.ok) return target
  const parsed = revolveFeatureParametersSchema.safeParse({
    profile,
    axis: values.axis,
    angle: angle.quantity,
    operation,
  })
  if (!parsed.success) return { ok: false as const, issues: { angle: copy.invalidRange } }
  return { ok: true as const, parameters: parsed.data, targetFeatureId: target.featureId }
}

function parseAngle(
  rawExpression: string,
  variables: readonly VariableDefinition[],
  unit: "rad" | "deg",
  copy: RevolveFormCopy,
) {
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) return { ok: false as const, issues: { angle: copy.invalidExpression } }
  const expression = normalizeExpressionWithDisplayUnit(rawExpression, unit)
  const result = evaluateExpression(expression, evaluated.valuesByName)
  if (!result.ok) return { ok: false as const, issues: { angle: copy.invalidExpression } }
  if (result.value.dimension !== "angle")
    return { ok: false as const, issues: { angle: copy.invalidDimension } }
  return { ok: true as const, quantity: createAngleQuantity(result.value.value, "rad", expression) }
}

function parseTarget(
  rawTargetFeatureId: string,
  operation: ReturnType<typeof extrusionOperationSchema.parse>,
  options: readonly { id: FeatureId; label: string }[],
  copy: RevolveFormCopy,
) {
  if (operation === "new") return { ok: true as const, featureId: null }
  const availableTargetIds = new Set(options.map(({ id }) => id))
  const target = featureIdSchema.safeParse(rawTargetFeatureId)
  return target.success && availableTargetIds.has(target.data)
    ? { ok: true as const, featureId: target.data }
    : { ok: false as const, issues: { targetFeatureId: copy.missingTarget } }
}

function RevolvePreviewSync({
  copy,
  displayUnit,
  featureId,
  mode,
  onPreviewChange,
  options,
  profile,
  values,
  variables,
}: {
  copy: RevolveFormCopy
  displayUnit: "rad" | "deg"
  featureId: FeatureId
  mode: RevolveFormMode
  onPreviewChange: (feature: FeatureRecord | null) => void
  options: readonly { id: FeatureId; label: string }[]
  profile: SketchProfileSelector
  values: Values
  variables: readonly VariableDefinition[]
}) {
  const inputRef = useRef({ copy, displayUnit, mode, options, profile, variables })
  inputRef.current = { copy, displayUnit, mode, options, profile, variables }
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const input = inputRef.current
      const parsed = parseValues(
        values,
        input.profile,
        input.variables,
        input.displayUnit,
        input.copy,
        input.options,
      )
      onPreviewChange(
        parsed.ok ? record(input.mode, featureId, parsed.parameters, parsed.targetFeatureId) : null,
      )
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [featureId, onPreviewChange, values])
  useEffect(() => () => onPreviewChange(null), [onPreviewChange])
  return null
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
  options,
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
  options?: readonly { id: FeatureId; label: string }[]
  profileLabel: string
  variables: readonly VariableDefinition[]
}) {
  const targetOptions = options ?? EMPTY_TARGET_OPTIONS
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
  const form = useAppForm({
    defaultValues:
      mode.kind === "edit"
        ? valuesFromFeature(mode.feature)
        : {
            axis: "x",
            angle: defaultAngleExpression(Math.PI * 2, displayUnits.angle),
            operation: "new",
            targetFeatureId: targetOptions[0]?.id ?? "",
          },
    onSubmit: async ({ value }) => {
      const parsed = parseValues(value, profile, variables, displayUnits.angle, copy, targetOptions)
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(copy.validationSummary)
        const invalidFieldName = "angle" in parsed.issues ? "angle" : "targetFeatureId"
        formElementRef.current?.querySelector<HTMLElement>(`[name="${invalidFieldName}"]`)?.focus()
        return
      }
      setIssues({})
      setMessage(null)
      await submitFeatureMutation({
        baseRevision,
        copy,
        feature: record(mode, featureId, parsed.parameters, parsed.targetFeatureId),
        onSave,
        onSaved,
        setMessage,
      })
    },
  })
  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      {onPreviewChange ? (
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <RevolvePreviewSync
              copy={copy}
              displayUnit={displayUnits.angle}
              featureId={featureId}
              mode={mode}
              onPreviewChange={onPreviewChange}
              options={targetOptions}
              profile={profile}
              values={values}
              variables={variables}
            />
          )}
        </form.Subscribe>
      ) : null}
      <RevolveParameterPanel
        copy={copy}
        disabled={disabled}
        message={message}
        profileLabel={profileLabel}
        operationField={
          <form.Field name="operation">
            {(field) => (
              <NativeSelectField
                name={field.name}
                value={field.state.value}
                label={copy.operation}
                disabled={disabled}
                onChange={(event) => {
                  clearSubmissionErrors()
                  field.handleChange(event.currentTarget.value)
                }}
              >
                <option value="new">{copy.operationNew}</option>
                <option value="add">{copy.operationAdd}</option>
                <option value="remove">{copy.operationRemove}</option>
                <option value="intersect">{copy.operationIntersect}</option>
              </NativeSelectField>
            )}
          </form.Field>
        }
        targetField={
          <form.Subscribe selector={(state) => state.values.operation}>
            {(operation) =>
              operation === "new" ? null : (
                <form.Field name="targetFeatureId">
                  {(field) => (
                    <NativeSelectField
                      name={field.name}
                      value={field.state.value}
                      label={copy.target}
                      description={copy.targetDescription}
                      error={issues.targetFeatureId}
                      disabled={disabled}
                      required
                      onChange={(event) => {
                        clearSubmissionErrors()
                        field.handleChange(event.currentTarget.value)
                      }}
                    >
                      {targetOptions.length === 0 ? (
                        <option value="">{copy.missingTarget}</option>
                      ) : null}
                      {targetOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelectField>
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
        }
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
