import {
  createAngleQuantity,
  createSketchProfileSet,
  evaluateExpression,
  evaluateVariableDefinitions,
  expectedRevolveDependencyIds,
  extrusionOperationSchema,
  type FeatureId,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
  multiProfileRevolveFeatureParametersSchema,
  multiProfileRevolveFeatureType,
  readRevolveFeatureParameters,
  revolveFeatureParametersSchema,
  revolveFeatureType,
  type SketchProfileSelector,
  type SketchProfileSet,
  type TopoRef,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Button } from "@vibeshape/ui/components/button"
import { Scan } from "@vibeshape/ui/components/icons"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultAngleExpression,
  normalizeExpressionWithDisplayUnit,
} from "../../document/document-display-units"
import { submitFeatureMutation } from "../part-design/primitive-form"
import {
  profileSelectorsEqual,
  topologyReferencesEqual,
} from "../part-design/profile-feature-selection"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
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
  profiles: SketchProfileSet
  supportReference: TopoRef | null
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
      profiles: readonly SketchProfileSelector[]
      supportReference?: TopoRef
    }>
  | Readonly<{
      kind: "edit"
      feature: FeatureRecord
      profiles: readonly SketchProfileSelector[]
      supportReference?: TopoRef
    }>

function valuesFromFeature(
  feature: FeatureRecord,
  profiles: readonly SketchProfileSelector[],
  supportReference: TopoRef | undefined,
): Values {
  const p = readRevolveFeatureParameters(feature)
  if (!p) throw new Error("Revolve parameters are unavailable.")
  return {
    axis: p.axis,
    angle: p.angle.source.expression ?? `${p.angle.source.value} ${p.angle.source.unit}`,
    operation: p.operation,
    profiles: createSketchProfileSet(profiles),
    supportReference: supportReference ?? null,
    targetFeatureId: feature.dependencies[0] ?? "",
  }
}
function featureIdForMode(mode: RevolveFormMode) {
  return mode.kind === "edit" ? mode.feature.id : mode.createFeatureId()
}

function defaultValuesForMode(
  mode: RevolveFormMode,
  angleUnit: "rad" | "deg",
  targetOptions: readonly { id: FeatureId; label: string }[],
): Values {
  if (mode.kind === "edit")
    return valuesFromFeature(mode.feature, mode.profiles, mode.supportReference)
  return {
    axis: { kind: "origin-axis", axis: "x" },
    angle: defaultAngleExpression(Math.PI * 2, angleUnit),
    operation: "new",
    profiles: createSketchProfileSet(mode.profiles),
    supportReference: mode.supportReference ?? null,
    targetFeatureId: targetOptions[0]?.id ?? "",
  }
}

function invalidFieldName(issues: Readonly<Record<string, string>>) {
  return "angle" in issues ? "angle" : "targetFeatureId"
}

function previewHandler(onPreviewChange?: (feature: FeatureRecord | null) => void) {
  return onPreviewChange ?? IGNORE_PREVIEW
}

type RevolveSubmitHandlerInput = Readonly<{
  baseRevision: number
  copy: RevolveFormCopy
  displayUnit: "rad" | "deg"
  featureId: FeatureId
  focusInvalidField: (fieldName: string) => void
  mode: RevolveFormMode
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  options: readonly { id: FeatureId; label: string }[]
  setIssues: (issues: Readonly<Record<string, string | undefined>>) => void
  setMessage: (message: string | null) => void
  variables: readonly VariableDefinition[]
}>

function revolveSubmitHandler(input: RevolveSubmitHandlerInput) {
  return async ({ value }: { value: Values }) => {
    const parsed = parseValues(value, input.variables, input.displayUnit, input.copy, input.options)
    if (!parsed.ok) {
      input.setIssues(parsed.issues)
      input.setMessage(input.copy.validationSummary)
      input.focusInvalidField(invalidFieldName(parsed.issues))
      return
    }
    input.setIssues({})
    input.setMessage(null)
    await submitFeatureMutation({
      baseRevision: input.baseRevision,
      copy: input.copy,
      feature: record(
        input.mode,
        input.featureId,
        parsed.parameters,
        parsed.targetFeatureId,
        parsed.supportReference,
      ),
      onSave: input.onSave,
      onSaved: input.onSaved,
      setMessage: input.setMessage,
    })
  }
}

function record(
  mode: RevolveFormMode,
  id: FeatureId,
  parameters:
    | ReturnType<typeof revolveFeatureParametersSchema.parse>
    | ReturnType<typeof multiProfileRevolveFeatureParametersSchema.parse>,
  targetFeatureId: FeatureId | null,
  supportReference: TopoRef | null,
) {
  const references = supportReference ? [supportReference] : []
  const dependencyParameters =
    "profile" in parameters
      ? parameters
      : { ...parameters, profile: parameters.profiles.profiles[0] as SketchProfileSelector }
  const dependencies = expectedRevolveDependencyIds(
    dependencyParameters,
    targetFeatureId,
    references.map(({ featureId }) => featureId),
  )
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? {
          ...mode.feature,
          type:
            "profiles" in parameters
              ? multiProfileRevolveFeatureType.type
              : revolveFeatureType.type,
          parameters,
          references,
          dependencies,
        }
      : {
          schemaVersion: 0,
          id,
          type:
            "profiles" in parameters
              ? multiProfileRevolveFeatureType.type
              : revolveFeatureType.type,
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
  variables: readonly VariableDefinition[],
  unit: "rad" | "deg",
  copy: RevolveFormCopy,
  options: readonly { id: FeatureId; label: string }[],
) {
  const angle = parseAngle(values.angle, variables, unit, copy)
  if (!angle.ok) return angle
  const operation = extrusionOperationSchema.parse(values.operation)
  if (values.profiles.profiles.length > 1 && operation !== "new") {
    return { ok: false as const, issues: { targetFeatureId: copy.missingTarget } }
  }
  const target = parseTarget(values.targetFeatureId, operation, options, copy)
  if (!target.ok) return target
  const parsed =
    values.profiles.profiles.length > 1
      ? multiProfileRevolveFeatureParametersSchema.safeParse({
          profiles: values.profiles,
          axis: values.axis,
          angle: angle.quantity,
          operation,
        })
      : revolveFeatureParametersSchema.safeParse({
          profile: values.profiles.profiles[0],
          axis: values.axis,
          angle: angle.quantity,
          operation,
        })
  if (!parsed.success) return { ok: false as const, issues: { angle: copy.invalidRange } }
  return {
    ok: true as const,
    parameters: parsed.data,
    supportReference: values.supportReference,
    targetFeatureId: target.featureId,
  }
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
  values,
  variables,
}: {
  copy: RevolveFormCopy
  displayUnit: "rad" | "deg"
  featureId: FeatureId
  mode: RevolveFormMode
  onPreviewChange: (feature: FeatureRecord | null) => void
  options: readonly { id: FeatureId; label: string }[]
  values: Values
  variables: readonly VariableDefinition[]
}) {
  useDebouncedFeaturePreview({
    input: { copy, displayUnit, mode, options, variables },
    onPreviewChange,
    values,
    resolve: (currentValues, input) => {
      const parsed = parseValues(
        currentValues,
        input.variables,
        input.displayUnit,
        input.copy,
        input.options,
      )
      return parsed.ok
        ? record(
            input.mode,
            featureId,
            parsed.parameters,
            parsed.targetFeatureId,
            parsed.supportReference,
          )
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
  onSelectionRequest,
  selectionActive,
  value,
}: Readonly<{
  axisLineLabel?: string | undefined
  copy: Pick<RevolveFormCopy, "axis" | "axisSelectHint" | "axisX" | "axisY">
  disabled: boolean
  onChange: (axis: RevolveAxis) => void
  onSelectionRequest?: (() => void) | undefined
  selectionActive: boolean
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
                  onClick={() => {
                    onSelectionRequest?.()
                    onChange({ kind: "origin-axis", axis })
                  }}
                >
                  {axis.toUpperCase()}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            className="h-auto min-h-9 justify-start gap-2 border-dashed px-3 py-2 text-left"
            variant={selectionActive ? "secondary" : "outline"}
            aria-label={copy.axisSelectHint}
            aria-pressed={selectionActive}
            {...(onSelectionRequest ? { onClick: onSelectionRequest } : {})}
          >
            <Scan className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className={axisLineLabel ? undefined : "text-muted-foreground"}>
              {axisLineLabel ?? copy.axisSelectHint}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copy.axisSelectHint}</TooltipContent>
      </Tooltip>
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

function RevolveProfileSelectionSync({
  onChange,
  profiles,
  supportReference,
}: Readonly<{
  onChange: (profiles: readonly SketchProfileSelector[], supportReference: TopoRef | null) => void
  profiles: readonly SketchProfileSelector[]
  supportReference: TopoRef | null
}>) {
  useLayoutEffect(
    () => onChange(profiles, supportReference),
    [onChange, profiles, supportReference],
  )
  return null
}

export type RevolveFormProps = Readonly<{
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
  onAxisSelectionRequest?: (() => void) | undefined
  onProfileSelectionRequest?: (() => void) | undefined
  options?: readonly { id: FeatureId; label: string }[]
  profileLabel: string
  profileLabels?: readonly string[]
  onProfileRemove?: ((index: number) => void) | undefined
  onProfilesClear?: (() => void) | undefined
  profileSelectionActive?: boolean
  variables: readonly VariableDefinition[]
}>

function useRevolveFormController(props: RevolveFormProps) {
  const targetOptions = props.options ?? EMPTY_TARGET_OPTIONS
  const updatePreview = previewHandler(props.onPreviewChange)
  const {
    clearSubmissionErrors,
    displayUnits,
    formElementRef,
    issues,
    message,
    setIssues,
    setMessage,
    suggestions,
  } = useParameterFormState(props.variables)
  const [featureId] = useState(() => featureIdForMode(props.mode))
  const form = useAppForm({
    defaultValues: defaultValuesForMode(props.mode, displayUnits.angle, targetOptions),
    onSubmit: revolveSubmitHandler({
      baseRevision: props.baseRevision,
      copy: props.copy,
      displayUnit: displayUnits.angle,
      featureId,
      focusInvalidField: (fieldName) =>
        formElementRef.current?.querySelector<HTMLElement>(`[name="${fieldName}"]`)?.focus(),
      mode: props.mode,
      onSave: props.onSave,
      onSaved: props.onSaved,
      options: targetOptions,
      setIssues,
      setMessage,
      variables: props.variables,
    }),
  })
  const applyAxisSelection = useCallback(
    (axis: RevolveAxis) => form.setFieldValue("axis", axis),
    [form],
  )
  const applyProfileSelection = useCallback(
    (profiles: readonly SketchProfileSelector[], supportReference: TopoRef | null) => {
      const nextProfiles = createSketchProfileSet(profiles)
      const currentProfiles = form.getFieldValue("profiles")
      const matches =
        currentProfiles.profiles.length === nextProfiles.profiles.length &&
        currentProfiles.profiles.every((profile, index) =>
          profileSelectorsEqual(profile, nextProfiles.profiles[index] ?? null),
        )
      if (!matches) {
        form.setFieldValue("profiles", nextProfiles)
        if (nextProfiles.profiles.length > 1) form.setFieldValue("operation", "new")
      }
      if (!topologyReferencesEqual(form.getFieldValue("supportReference"), supportReference)) {
        form.setFieldValue("supportReference", supportReference)
      }
    },
    [form],
  )

  return {
    ...props,
    applyAxisSelection,
    applyProfileSelection,
    clearSubmissionErrors,
    disabled: props.disabled ?? false,
    displayUnits,
    featureId,
    form,
    formElementRef,
    issues,
    message,
    profileSelectionActive: props.profileSelectionActive ?? false,
    suggestions,
    targetOptions,
    updatePreview,
  } as const
}

type RevolveFormController = ReturnType<typeof useRevolveFormController>

function RevolvePreviewField({ controller }: { controller: RevolveFormController }) {
  const { form } = controller
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <RevolvePreviewSync
          copy={controller.copy}
          displayUnit={controller.displayUnits.angle}
          featureId={controller.featureId}
          mode={controller.mode}
          onPreviewChange={controller.updatePreview}
          options={controller.targetOptions}
          values={values}
          variables={controller.variables}
        />
      )}
    </form.Subscribe>
  )
}

function RevolveOperationField({ controller }: { controller: RevolveFormController }) {
  const { form } = controller
  return (
    <form.Subscribe selector={(state) => state.values.profiles.profiles.length}>
      {(profileCount) => (
        <form.Field name="operation">
          {(field) => (
            <NativeSelectField
              name={field.name}
              value={field.state.value}
              label={controller.copy.operation}
              disabled={controller.disabled || profileCount > 1}
              onChange={(event) => {
                controller.clearSubmissionErrors()
                field.handleChange(event.currentTarget.value)
              }}
            >
              <option value="new">{controller.copy.operationNew}</option>
              <option value="add">{controller.copy.operationAdd}</option>
              <option value="remove">{controller.copy.operationRemove}</option>
              <option value="intersect">{controller.copy.operationIntersect}</option>
            </NativeSelectField>
          )}
        </form.Field>
      )}
    </form.Subscribe>
  )
}

function RevolveTargetField({ controller }: { controller: RevolveFormController }) {
  const { form } = controller
  return (
    <form.Subscribe selector={(state) => state.values.operation}>
      {(operation) =>
        operation === "new" ? null : (
          <form.Field name="targetFeatureId">
            {(field) => (
              <NativeSelectField
                name={field.name}
                value={field.state.value}
                label={controller.copy.target}
                description={controller.copy.targetDescription}
                error={controller.issues.targetFeatureId}
                disabled={controller.disabled}
                required
                onChange={(event) => {
                  controller.clearSubmissionErrors()
                  field.handleChange(event.currentTarget.value)
                }}
              >
                {controller.targetOptions.length === 0 ? (
                  <option value="">{controller.copy.missingTarget}</option>
                ) : null}
                {controller.targetOptions.map((option) => (
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
  )
}

function RevolveAxisFormField({ controller }: { controller: RevolveFormController }) {
  const { form } = controller
  return (
    <form.Field name="axis">
      {(field) => (
        <RevolveAxisField
          axisLineLabel={controller.axisLineLabel}
          copy={controller.copy}
          disabled={controller.disabled}
          selectionActive={!controller.profileSelectionActive}
          value={field.state.value}
          onSelectionRequest={controller.onAxisSelectionRequest}
          onChange={(axis) => {
            controller.clearSubmissionErrors()
            field.handleChange(axis)
            controller.onAxisChange?.(axis)
          }}
        />
      )}
    </form.Field>
  )
}

function RevolveAngleField({ controller }: { controller: RevolveFormController }) {
  const { form } = controller
  return (
    <form.Field name="angle">
      {(field) => (
        <VariableExpressionField
          id="revolve-angle"
          name={field.name}
          label={controller.copy.angle}
          description={controller.copy.expressionDescription}
          error={controller.issues.angle}
          value={field.state.value}
          disabled={controller.disabled}
          suggestions={controller.suggestions}
          onBlur={field.handleBlur}
          onValueChange={(value: string) => {
            controller.clearSubmissionErrors()
            field.handleChange(value)
          }}
        />
      )}
    </form.Field>
  )
}

function RevolveFormView({ controller }: { controller: RevolveFormController }) {
  const { form } = controller
  return (
    <Form
      ref={controller.formElementRef}
      form={form}
      aria-label={controller.copy.title}
      className="gap-0"
    >
      <RevolveProfileSelectionSync
        profiles={controller.mode.profiles}
        supportReference={controller.mode.supportReference ?? null}
        onChange={controller.applyProfileSelection}
      />
      <RevolveAxisSelectionSync
        axisSelection={controller.axisSelection}
        onChange={controller.applyAxisSelection}
      />
      <RevolvePreviewField controller={controller} />
      <RevolveParameterPanel
        actions={
          <TaskPanelFormActions
            acceptLabel={controller.copy.submit}
            ariaLabel={controller.copy.title}
            cancelLabel={controller.copy.cancel}
            disabled={controller.disabled}
            onCancel={controller.onCancel}
          />
        }
        copy={controller.copy}
        disabled={controller.disabled}
        message={controller.message}
        profileLabels={controller.profileLabels ?? [controller.profileLabel]}
        onProfileRemove={controller.onProfileRemove}
        onProfilesClear={controller.onProfilesClear}
        profileSelectionActive={controller.profileSelectionActive}
        onProfileSelectionRequest={controller.onProfileSelectionRequest}
        operationField={<RevolveOperationField controller={controller} />}
        targetField={<RevolveTargetField controller={controller} />}
        axisField={<RevolveAxisFormField controller={controller} />}
        angleField={<RevolveAngleField controller={controller} />}
      />
    </Form>
  )
}

export function RevolveForm(props: RevolveFormProps) {
  const controller = useRevolveFormController(props)
  return <RevolveFormView controller={controller} />
}
