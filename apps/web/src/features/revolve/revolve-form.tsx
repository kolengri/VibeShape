import {
  createAngleQuantity,
  evaluateExpression,
  evaluateVariableDefinitions,
  extrusionOperationSchema,
  type FeatureId,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
  readRevolveFeatureParameters,
  revolveFeatureParametersSchema,
  revolveFeatureType,
  type SketchProfileSelector,
  type TopoRef,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Button } from "@vibeshape/ui/components/button"
import { Scan } from "@vibeshape/ui/components/icons"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useCallback, useEffect, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultAngleExpression,
  normalizeExpressionWithDisplayUnit,
} from "../../document/document-display-units"
import { submitFeatureMutation } from "../part-design/primitive-form"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import { VariableExpressionField } from "../variables/variable-expression-field"
import { RevolveParameterPanel, type RevolveParameterPanelCopy } from "./revolve-parameter-panel"

const EMPTY_TARGET_OPTIONS = [] as const
const IGNORE_PREVIEW = () => undefined

type RevolveAxis = ReturnType<typeof revolveFeatureParametersSchema.parse>["axis"]
type Values = Readonly<{
  axis: RevolveAxis
  angle: string
  operation: string
  targetFeatureId: string
}>
export type RevolveFormCopy = RevolveParameterPanelCopy &
  Readonly<{
    axis: string
    axisX: string
    axisY: string
    axisSelectHint: string
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
  const p = readRevolveFeatureParameters(feature)
  if (!p) throw new Error("Revolve parameters are unavailable.")
  return {
    axis: p.axis,
    angle: p.angle.source.expression ?? `${p.angle.source.value} ${p.angle.source.unit}`,
    operation: p.operation,
    targetFeatureId: feature.dependencies[0] ?? "",
  }
}
function profileForMode(mode: RevolveFormMode) {
  if (mode.kind === "create") return mode.profile
  const parameters = readRevolveFeatureParameters(mode.feature)
  if (!parameters) throw new Error("Revolve parameters are unavailable.")
  return parameters.profile
}

function featureIdForMode(mode: RevolveFormMode) {
  return mode.kind === "edit" ? mode.feature.id : mode.createFeatureId()
}

function defaultValuesForMode(
  mode: RevolveFormMode,
  angleUnit: "rad" | "deg",
  targetOptions: readonly { id: FeatureId; label: string }[],
): Values {
  if (mode.kind === "edit") return valuesFromFeature(mode.feature)
  return {
    axis: { kind: "origin-axis", axis: "x" },
    angle: defaultAngleExpression(Math.PI * 2, angleUnit),
    operation: "new",
    targetFeatureId: targetOptions[0]?.id ?? "",
  }
}

function invalidFieldName(issues: Readonly<Record<string, string>>) {
  return "angle" in issues ? "angle" : "targetFeatureId"
}

function previewHandler(onPreviewChange?: (feature: FeatureRecord | null) => void) {
  return onPreviewChange ?? IGNORE_PREVIEW
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
  useDebouncedFeaturePreview({
    input: { copy, displayUnit, mode, options, profile, variables },
    onPreviewChange,
    values,
    resolve: (currentValues, input) => {
      const parsed = parseValues(
        currentValues,
        input.profile,
        input.variables,
        input.displayUnit,
        input.copy,
        input.options,
      )
      return parsed.ok
        ? record(input.mode, featureId, parsed.parameters, parsed.targetFeatureId)
        : null
    },
  })
  return null
}

function RevolveAxisField({
  axisLineLabel,
  copy,
  disabled,
  onChange,
  value,
}: Readonly<{
  axisLineLabel?: string | undefined
  copy: Pick<RevolveFormCopy, "axis" | "axisSelectHint" | "axisX" | "axisY">
  disabled: boolean
  onChange: (axis: RevolveAxis) => void
  value: RevolveAxis
}>) {
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="text-sm font-medium">{copy.axis}</legend>
      <div className="flex gap-2">
        {(["x", "y"] as const).map((axis) => {
          const selected = value.kind === "origin-axis" && value.axis === axis
          const label = axis === "x" ? copy.axisX : copy.axisY
          return (
            <Tooltip key={axis}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  className="min-w-0 flex-1"
                  size="sm"
                  variant={selected ? "secondary" : "outline"}
                  aria-label={label}
                  aria-pressed={selected}
                  onClick={() => onChange({ kind: "origin-axis", axis })}
                >
                  {axis.toUpperCase()}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      <output className="flex min-h-9 items-center gap-2 rounded-md border border-dashed bg-panel-muted px-3 py-2 text-sm">
        <Scan className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={axisLineLabel ? undefined : "text-muted-foreground"}>
          {axisLineLabel ?? copy.axisSelectHint}
        </span>
      </output>
    </fieldset>
  )
}

function RevolveAxisSelectionSync({
  axisSelection,
  onChange,
}: Readonly<{
  axisSelection?: RevolveAxis | undefined
  onChange: (axis: RevolveAxis) => void
}>) {
  useEffect(() => {
    if (axisSelection) onChange(axisSelection)
  }, [axisSelection, onChange])
  return null
}

export function RevolveForm({
  axisLineLabel,
  axisSelection,
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onSave,
  onSaved,
  onPreviewChange,
  onAxisChange,
  options,
  profileLabel,
  variables,
}: {
  axisLineLabel?: string | undefined
  axisSelection?: RevolveAxis | undefined
  baseRevision: number
  copy: RevolveFormCopy
  disabled?: boolean
  mode: RevolveFormMode
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  onPreviewChange?: (feature: FeatureRecord | null) => void
  onAxisChange?: ((axis: RevolveAxis) => void) | undefined
  options?: readonly { id: FeatureId; label: string }[]
  profileLabel: string
  variables: readonly VariableDefinition[]
}) {
  const targetOptions = options ?? EMPTY_TARGET_OPTIONS
  const updatePreview = previewHandler(onPreviewChange)
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
  const [featureId] = useState(() => featureIdForMode(mode))
  const form = useAppForm({
    defaultValues: defaultValuesForMode(mode, displayUnits.angle, targetOptions),
    onSubmit: async ({ value }) => {
      const parsed = parseValues(value, profile, variables, displayUnits.angle, copy, targetOptions)
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(copy.validationSummary)
        const fieldName = invalidFieldName(parsed.issues)
        formElementRef.current?.querySelector<HTMLElement>(`[name="${fieldName}"]`)?.focus()
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
  const applyAxisSelection = useCallback(
    (axis: RevolveAxis) => form.setFieldValue("axis", axis),
    [form],
  )
  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <RevolveAxisSelectionSync axisSelection={axisSelection} onChange={applyAxisSelection} />
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <RevolvePreviewSync
            copy={copy}
            displayUnit={displayUnits.angle}
            featureId={featureId}
            mode={mode}
            onPreviewChange={updatePreview}
            options={targetOptions}
            profile={profile}
            values={values}
            variables={variables}
          />
        )}
      </form.Subscribe>
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
              <RevolveAxisField
                axisLineLabel={axisLineLabel}
                copy={copy}
                disabled={disabled}
                value={field.state.value}
                onChange={(axis) => {
                  clearSubmissionErrors()
                  field.handleChange(axis)
                  onAxisChange?.(axis)
                }}
              />
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
