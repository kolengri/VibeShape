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
  readRevolveProfileSet,
  revolveFeatureParametersSchema,
  revolveFeatureParametersV6Schema,
  revolveFeatureParametersV7Schema,
  revolveFeatureType,
  revolveFeatureTypeV6,
  revolveFeatureTypeV7,
  type SketchProfileSelector,
  type SketchProfileSet,
  type TopoRef,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import { Button } from "@vibeshape/ui/components/button"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { Scan } from "@vibeshape/ui/components/icons"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { cn } from "@vibeshape/ui/lib/cn"
import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultAngleExpression,
  normalizeExpressionWithDisplayUnit,
  positiveDirectManipulationAngleExpression,
} from "../../document/document-display-units"
import { exactBodyPickCandidates } from "../part-design/body-reference-picking"
import { exactBodyOptionId } from "../part-design/exact-body-options"
import { featureEditPreview } from "../part-design/feature-edit-preview"
import { submitFeatureMutation } from "../part-design/primitive-form"
import {
  profileSelectorsEqual,
  revolveAxesEqual,
  topologyReferencesEqual,
} from "../part-design/profile-feature-selection"
import { ReferencePickField } from "../part-design/reference-pick-field"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import { VariableExpressionField } from "../variables/variable-expression-field"
import type { RevolveAngleRequest } from "./revolve-angle-manipulator"
import { RevolveParameterPanel, type RevolveParameterPanelCopy } from "./revolve-parameter-panel"

export type RevolveTargetOption = Readonly<{ id: string; label: string; body?: BodyReference }>

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
    targetFeatureId: p.targetBody
      ? exactBodyOptionId(p.targetBody)
      : (feature.dependencies[0] ?? ""),
  }
}
function featureIdForMode(mode: RevolveFormMode) {
  return mode.kind === "edit" ? mode.feature.id : mode.createFeatureId()
}

function defaultValuesForMode(
  mode: RevolveFormMode,
  angleUnit: "rad" | "deg",
  targetOptions: readonly RevolveTargetOption[],
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
  options: readonly RevolveTargetOption[]
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
    | ReturnType<typeof multiProfileRevolveFeatureParametersSchema.parse>
    | ReturnType<typeof revolveFeatureParametersV6Schema.parse>
    | ReturnType<typeof revolveFeatureParametersV7Schema.parse>,
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
          type: revolveType(parameters),
          parameters,
          references,
          dependencies,
        }
      : {
          schemaVersion: 0,
          id,
          type: revolveType(parameters),
          parameters,
          references,
          dependencies,
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}

function revolveType(
  parameters:
    | ReturnType<typeof revolveFeatureParametersSchema.parse>
    | ReturnType<typeof multiProfileRevolveFeatureParametersSchema.parse>
    | ReturnType<typeof revolveFeatureParametersV6Schema.parse>
    | ReturnType<typeof revolveFeatureParametersV7Schema.parse>,
) {
  if ("targetBody" in parameters) return revolveFeatureTypeV7.type
  if (!("profiles" in parameters)) return revolveFeatureType.type
  return parameters.operation === "new"
    ? multiProfileRevolveFeatureType.type
    : revolveFeatureTypeV6.type
}

function parseValues(
  values: Values,
  variables: readonly VariableDefinition[],
  unit: "rad" | "deg",
  copy: RevolveFormCopy,
  options: readonly RevolveTargetOption[],
) {
  const angle = parseAngle(values.angle, variables, unit, copy)
  if (!angle.ok) return angle
  const operation = extrusionOperationSchema.parse(values.operation)
  const target = parseTarget(values.targetFeatureId, operation, options, copy)
  if (!target.ok) return target
  const parsed =
    operation !== "new" && target.body
      ? revolveFeatureParametersV7Schema.safeParse({
          profiles: values.profiles,
          axis: values.axis,
          angle: angle.quantity,
          operation,
          targetBody: target.body,
        })
      : values.profiles.profiles.length > 1
        ? operation === "new"
          ? multiProfileRevolveFeatureParametersSchema.safeParse({
              profiles: values.profiles,
              axis: values.axis,
              angle: angle.quantity,
              operation,
            })
          : revolveFeatureParametersV6Schema.safeParse({
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
  options: readonly RevolveTargetOption[],
  copy: RevolveFormCopy,
) {
  if (operation === "new") return { ok: true as const, featureId: null, body: null }
  const selected = options.find(({ id }) => id === rawTargetFeatureId)
  const featureId = featureIdSchema.safeParse(selected?.body?.featureId ?? selected?.id)
  return selected && featureId.success
    ? { ok: true as const, featureId: featureId.data, body: selected.body ?? null }
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
  options: readonly RevolveTargetOption[]
  values: Values
  variables: readonly VariableDefinition[]
}) {
  const parsed = parseValues(values, variables, displayUnit, copy, options)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: featureEditPreview(
      mode,
      values,
      mode.kind === "edit"
        ? valuesFromFeature(
            mode.feature,
            readRevolveProfileSet(mode.feature)?.profiles ?? [],
            mode.supportReference,
          )
        : null,
      parsed.ok
        ? record(
            mode,
            featureId,
            parsed.parameters,
            parsed.targetFeatureId,
            parsed.supportReference,
          )
        : null,
    ),
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
    <fieldset className={fieldVariants({ orientation: "horizontal" })} disabled={disabled}>
      <legend className="sr-only">{copy.axis}</legend>
      <span className="text-xs font-medium" aria-hidden="true">
        {copy.axis}
      </span>
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 gap-1">
          {(["x", "y"] as const).map((axis) => {
            const selected = value.kind === "origin-axis" && value.axis === axis
            const label = axis === "x" ? copy.axisX : copy.axisY
            return (
              <Button
                key={axis}
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
            )
          })}
        </div>
        <Button
          size="content"
          type="button"
          className="w-full min-w-0 justify-start overflow-hidden border-dashed text-left"
          variant={selectionActive ? "secondary" : "outline"}
          aria-label={copy.axisSelectHint}
          aria-pressed={selectionActive}
          {...(onSelectionRequest ? { onClick: onSelectionRequest } : {})}
        >
          <Scan className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span
            className={cn("min-w-0 truncate", axisLineLabel ? undefined : "text-muted-foreground")}
          >
            {axisLineLabel ?? copy.axisSelectHint}
          </span>
        </Button>
      </div>
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
  angleRequest?: RevolveAngleRequest | null
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
  options?: readonly RevolveTargetOption[]
  profileLabel: string
  profileLabels?: readonly string[]
  onProfileRemove?: ((index: number) => void) | undefined
  onProfilesClear?: (() => void) | undefined
  profileSelectionActive?: boolean
  previewStatus?: FeaturePreviewState["status"] | undefined
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
    (axis: RevolveAxis) => {
      if (!revolveAxesEqual(form.getFieldValue("axis"), axis)) {
        form.setFieldValue("axis", axis)
      }
    },
    [form],
  )
  useEffect(() => {
    if (props.disabled || !props.angleRequest || props.angleRequest.featureId !== featureId) {
      return
    }
    const expression = positiveDirectManipulationAngleExpression(
      props.angleRequest.angle,
      displayUnits.angle,
    )
    if (form.getFieldValue("angle") === expression) return
    clearSubmissionErrors()
    form.setFieldValue("angle", expression)
  }, [
    clearSubmissionErrors,
    displayUnits.angle,
    featureId,
    form,
    props.angleRequest,
    props.disabled,
  ])
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
    <form.Field name="operation">
      {(field) => (
        <ChoiceField
          name={field.name}
          value={field.state.value}
          label={controller.copy.operation}
          disabled={controller.disabled}
          onBlur={field.handleBlur}
          onValueChange={(value) => {
            controller.clearSubmissionErrors()
            field.handleChange(value)
          }}
          options={[
            { value: "new", label: controller.copy.operationNew },
            { value: "add", label: controller.copy.operationAdd },
            { value: "remove", label: controller.copy.operationRemove },
            { value: "intersect", label: controller.copy.operationIntersect },
          ]}
        />
      )}
    </form.Field>
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
              <ReferencePickField
                id="revolve-target-body"
                name={field.name}
                value={field.state.value}
                label={controller.copy.target}
                placeholder={controller.copy.missingTarget}
                options={controller.targetOptions.map((option) => ({
                  value: option.id,
                  label: option.label,
                }))}
                candidates={exactBodyPickCandidates(controller.targetOptions)}
                description={controller.copy.targetDescription}
                error={controller.issues.targetFeatureId}
                disabled={controller.disabled}
                required
                onBlur={field.handleBlur}
                onValueChange={(value) => {
                  controller.clearSubmissionErrors()
                  field.handleChange(value)
                }}
              />
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
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
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
            previewStatus={controller.previewStatus}
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
