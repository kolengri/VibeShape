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
  type RevolveAuthoringIntent,
  type RevolveAuthoringRoute,
  type RevolveEndCondition,
  readRevolveFeatureParameters,
  readRevolveProfileSet,
  revolveAngleSchema,
  type revolveFeatureParametersSchema,
  routeRevolveAuthoring,
  type SketchProfileSelector,
  type SketchProfileSet,
  type TopoRef,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { Scan } from "@vibeshape/ui/components/icons"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { cn } from "@vibeshape/ui/lib/cn"
import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultAngleExpression,
  normalizeExpressionWithDisplayUnit,
  positiveDirectManipulationAngleExpression,
} from "../../document/document-display-units"
import type { ExtrusionTargetOption } from "../extrusion/extrusion-body-options"
import { exactBodyPickCandidates } from "../part-design/body-reference-picking"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { exactBodyOptionId } from "../part-design/exact-body-options"
import { featureEditPreview } from "../part-design/feature-edit-preview"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
import { submitFeatureMutation } from "../part-design/primitive-form"
import {
  profileSelectorsEqual,
  revolveAxesEqual,
  topologyReferencesEqual,
} from "../part-design/profile-feature-selection"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import type { RevolveAngleRequest } from "./revolve-angle-manipulator"
import { RevolveEndFields, RevolveExtentFields } from "./revolve-extent-fields"
import {
  defaultRevolveExtentValues,
  parseRevolveEnd,
  type RevolveExtentValues,
  revolveExtentValuesFromParameters,
} from "./revolve-extent-model"
import { RevolveParameterPanel, type RevolveParameterPanelCopy } from "./revolve-parameter-panel"

export type RevolveTargetOption = Readonly<{ id: string; label: string; body?: BodyReference }>

const EMPTY_TARGET_OPTIONS = [] as const
const EMPTY_END_OPTIONS: readonly ExtrusionTargetOption[] = []
const IGNORE_PREVIEW = () => undefined

type RevolveAxis = ReturnType<typeof revolveFeatureParametersSchema.parse>["axis"]
export type RevolveFormValues = RevolveExtentValues &
  Readonly<{
    axis: RevolveAxis
    angle: string
    operation: string
    profiles: SketchProfileSet
    supportReference: TopoRef | null
    targetFeatureId: string
  }>
type Values = RevolveFormValues
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
    invalidTotal: string
    missingEnd: string
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
  angleUnit: "rad" | "deg",
): Values {
  const p = readRevolveFeatureParameters(feature)
  if (!p) throw new Error("Revolve parameters are unavailable.")
  return {
    ...revolveExtentValuesFromParameters(p, defaultAngleExpression(Math.PI / 2, angleUnit)),
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
    return valuesFromFeature(mode.feature, mode.profiles, mode.supportReference, angleUnit)
  return {
    ...defaultRevolveExtentValues(defaultAngleExpression(Math.PI / 2, angleUnit)),
    axis: { kind: "origin-axis", axis: "x" },
    angle: defaultAngleExpression(Math.PI * 2, angleUnit),
    operation: "new",
    profiles: createSketchProfileSet(mode.profiles),
    supportReference: mode.supportReference ?? null,
    targetFeatureId: targetOptions[0]?.id ?? "",
  }
}

function previewHandler(onPreviewChange?: (feature: FeatureRecord | null) => void) {
  return onPreviewChange ?? IGNORE_PREVIEW
}

type RevolveSubmitHandlerInput = Readonly<{
  disabled?: boolean | undefined
  previewStatus?: FeaturePreviewState["status"] | undefined
  baseRevision: number
  copy: RevolveFormCopy
  displayUnit: "rad" | "deg"
  featureId: FeatureId
  mode: RevolveFormMode
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  options: readonly RevolveTargetOption[]
  endOptions: readonly ExtrusionTargetOption[]
  setMessage: (message: string | null) => void
  variables: readonly VariableDefinition[]
}>

function revolveSubmitHandler(input: RevolveSubmitHandlerInput) {
  return async ({ value }: { value: Values }) => {
    if (input.disabled || !isFeaturePreviewReady(input.previewStatus)) return
    const parsed = parseValues(value, {
      variables: input.variables,
      unit: input.displayUnit,
      copy: input.copy,
      options: input.options,
      endOptions: input.endOptions,
      mode: input.mode,
    })
    if (!parsed.ok) return
    input.setMessage(null)
    await submitFeatureMutation({
      baseRevision: input.baseRevision,
      copy: input.copy,
      feature: record(input.mode, input.featureId, parsed),
      onSave: input.onSave,
      onSaved: input.onSaved,
      setMessage: input.setMessage,
    })
  }
}

type ParsedRevolve = Readonly<{
  route: RevolveAuthoringRoute
  endCondition: RevolveEndCondition
  axis: RevolveAxis
  operation: ReturnType<typeof extrusionOperationSchema.parse>
  supportReference: TopoRef | null
  targetFeatureId: FeatureId | null
}>

function record(mode: RevolveFormMode, id: FeatureId, parsed: ParsedRevolve) {
  const references = parsed.supportReference ? [parsed.supportReference] : []
  const dependencies = expectedRevolveDependencyIds(
    parsed,
    parsed.targetFeatureId,
    references.map(({ featureId }) => featureId),
  )
  const authored = { type: parsed.route.type, parameters: parsed.route.parameters }
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, ...authored, references, dependencies }
      : {
          schemaVersion: 0,
          id,
          ...authored,
          references,
          dependencies,
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}

type ParseContext = Readonly<{
  variables: readonly VariableDefinition[]
  unit: "rad" | "deg"
  copy: RevolveFormCopy
  options: readonly RevolveTargetOption[]
  endOptions: readonly ExtrusionTargetOption[]
  mode: RevolveFormMode
}>

/**
 * An endpoint hides the angle field; its retained value is the parsed field when it is a supported
 * Revolve angle, else the saved angle of an edited revolve, else a full turn, so hidden raw or
 * out-of-range input never blocks Apply. Only the literal is kept: a hidden expression would tie the
 * revolve to a variable that the user can no longer see.
 */
function retainedEndpointAngle(values: Values, context: ParseContext) {
  const angle = parseAngle(values.angle, "angle", context)
  const saved =
    context.mode.kind === "edit" ? readRevolveFeatureParameters(context.mode.feature)?.angle : null
  const retained =
    angle.ok && revolveAngleSchema.safeParse(angle.quantity).success
      ? angle.quantity
      : (saved ?? createAngleQuantity(Math.PI * 2, "rad"))
  return createAngleQuantity(retained.source.value, retained.source.unit)
}

function parseAngles(values: Values, context: ParseContext) {
  if (values.endKind !== "angle")
    return {
      ok: true as const,
      angle: retainedEndpointAngle(values, context),
      secondAngle: null,
    }
  const angle = parseAngle(values.angle, "angle", context)
  if (!angle.ok) return angle
  if (values.extent !== "two-sided")
    return { ok: true as const, angle: angle.quantity, secondAngle: null }
  const second = parseAngle(values.secondAngle, "secondAngle", context)
  return second.ok
    ? { ok: true as const, angle: angle.quantity, secondAngle: second.quantity }
    : second
}

/** Exact body choices name their role; a legacy producer choice means its whole result. */
function targetBody(target: Extract<ReturnType<typeof parseTarget>, { ok: true }>) {
  if (target.body) return target.body
  return target.featureId
    ? { schemaVersion: 0 as const, featureId: target.featureId, outputRole: "result" }
    : null
}

type ParsedAngles = Extract<ReturnType<typeof parseAngles>, { ok: true }>

/** Symmetric intent only applies to an angular end; it never carries a reversed direction. */
function authoringIntent(
  values: Values,
  angles: ParsedAngles,
  operation: ParsedRevolve["operation"],
  target: Extract<ReturnType<typeof parseTarget>, { ok: true }>,
  endCondition: RevolveEndCondition,
): RevolveAuthoringIntent {
  const symmetric = endCondition.kind === "angle" && values.extent === "symmetric"
  return {
    profiles: values.profiles,
    axis: values.axis,
    angle: angles.angle,
    symmetric,
    reversed: !symmetric && values.reversed,
    secondAngle: angles.secondAngle,
    operation,
    targetBody: operation === "new" ? null : targetBody(target),
    endCondition,
  }
}

function parseValues(values: Values, context: ParseContext) {
  const { copy } = context
  const angles = parseAngles(values, context)
  if (!angles.ok) return angles
  const operation = extrusionOperationSchema.parse(values.operation)
  const target = parseTarget(values.targetFeatureId, operation, context.options, copy)
  if (!target.ok) return target
  const end = parseRevolveEnd(values, context.endOptions)
  if (!end.ok) return { ok: false as const, issues: { [end.field]: copy.missingEnd } }
  const route = routeRevolveAuthoring(
    authoringIntent(values, angles, operation, target, end.value),
    context.mode.kind === "edit" ? context.mode.feature.type : null,
  )
  if (!route) {
    const issues = angles.secondAngle
      ? { secondAngle: copy.invalidTotal }
      : { angle: copy.invalidRange }
    return { ok: false as const, issues }
  }
  return {
    ok: true as const,
    route,
    endCondition: end.value,
    axis: values.axis,
    operation,
    supportReference: values.supportReference,
    targetFeatureId: target.featureId,
  }
}

function parseAngle(rawExpression: string, field: "angle" | "secondAngle", context: ParseContext) {
  const { copy } = context
  const evaluated = evaluateVariableDefinitions(context.variables)
  if (!evaluated.ok) return { ok: false as const, issues: { [field]: copy.invalidExpression } }
  const expression = normalizeExpressionWithDisplayUnit(rawExpression, context.unit)
  const result = evaluateExpression(expression, evaluated.valuesByName)
  if (!result.ok) return { ok: false as const, issues: { [field]: copy.invalidExpression } }
  if (result.value.dimension !== "angle")
    return { ok: false as const, issues: { [field]: copy.invalidDimension } }
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
  context,
  featureId,
  onPreviewChange,
  values,
}: {
  context: ParseContext
  featureId: FeatureId
  onPreviewChange: (feature: FeatureRecord | null) => void
  values: Values
}) {
  const { mode } = context
  const parsed = parseValues(values, context)
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
            context.unit,
          )
        : null,
      parsed.ok ? record(mode, featureId, parsed) : null,
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
  /** Exact rebuilt bodies and faces available as dynamic endpoints. */
  endOptions?: readonly ExtrusionTargetOption[]
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
  const endOptions = props.endOptions ?? EMPTY_END_OPTIONS
  const updatePreview = previewHandler(props.onPreviewChange)
  const { clearSubmissionErrors, displayUnits, message, setMessage, suggestions } =
    useParameterFormState(props.variables)
  const [featureId] = useState(() => featureIdForMode(props.mode))
  const parseContext: ParseContext = {
    variables: props.variables,
    unit: displayUnits.angle,
    copy: props.copy,
    options: targetOptions,
    endOptions,
    mode: props.mode,
  }
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: defaultValuesForMode(props.mode, displayUnits.angle, targetOptions),
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parseValues(value, parseContext)
        return parsed.ok ? undefined : { form: props.copy.validationSummary, fields: parsed.issues }
      },
    },
    onSubmit: revolveSubmitHandler({
      disabled: props.disabled,
      previewStatus: props.previewStatus,
      baseRevision: props.baseRevision,
      copy: props.copy,
      displayUnit: displayUnits.angle,
      featureId,
      mode: props.mode,
      onSave: props.onSave,
      onSaved: props.onSaved,
      options: targetOptions,
      endOptions,
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
    endOptions,
    featureId,
    form,
    parseContext,
    message,
    profileSelectionActive: props.profileSelectionActive ?? false,
    suggestions,
    targetOptions,
    updatePreview,
  } as const
}

export type RevolveFormController = ReturnType<typeof useRevolveFormController>

function RevolvePreviewField({ controller }: { controller: RevolveFormController }) {
  const { form } = controller
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <RevolvePreviewSync
          context={controller.parseContext}
          featureId={controller.featureId}
          onPreviewChange={controller.updatePreview}
          values={values}
        />
      )}
    </form.Subscribe>
  )
}

function RevolveOperationField({ controller }: { controller: RevolveFormController }) {
  const { form } = controller
  return (
    <form.AppField name="operation">
      {(field) => (
        <field.ChoiceField
          label={controller.copy.operation}
          disabled={controller.disabled}
          onValueChange={() => {
            controller.clearSubmissionErrors()
          }}
          options={[
            { value: "new", label: controller.copy.operationNew },
            { value: "add", label: controller.copy.operationAdd },
            { value: "remove", label: controller.copy.operationRemove },
            { value: "intersect", label: controller.copy.operationIntersect },
          ]}
        />
      )}
    </form.AppField>
  )
}

function RevolveTargetField({ controller }: { controller: RevolveFormController }) {
  const { form } = controller
  return (
    <form.Subscribe selector={(state) => state.values.operation}>
      {(operation) =>
        operation === "new" ? null : (
          <form.AppField name="targetFeatureId">
            {(field) => (
              <field.ReferencePickField
                id="revolve-target-body"
                label={controller.copy.target}
                placeholder={controller.copy.missingTarget}
                options={controller.targetOptions.map((option) => ({
                  value: option.id,
                  label: option.label,
                }))}
                candidates={exactBodyPickCandidates(controller.targetOptions)}
                description={controller.copy.targetDescription}
                disabled={controller.disabled}
                required
                onValueChange={() => {
                  controller.clearSubmissionErrors()
                }}
              />
            )}
          </form.AppField>
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
  const t = useTranslations("app.shell.taskPanel.revolve")
  return (
    <form.Subscribe
      selector={(state) => ({ extent: state.values.extent, endKind: state.values.endKind })}
    >
      {({ extent, endKind }) =>
        endKind === "angle" ? (
          <RevolveAngleInput
            controller={controller}
            label={
              extent === "symmetric"
                ? t("totalAngle")
                : extent === "two-sided"
                  ? t("firstAngle")
                  : controller.copy.angle
            }
          />
        ) : null
      }
    </form.Subscribe>
  )
}

function RevolveAngleInput({
  controller,
  label,
}: {
  controller: RevolveFormController
  label: string
}) {
  const { form } = controller
  return (
    <form.AppField name="angle">
      {(field) => (
        <field.VariableExpressionField
          id="revolve-angle"
          label={label}
          description={controller.copy.expressionDescription}
          disabled={controller.disabled}
          suggestions={controller.suggestions}
          onValueChange={() => {
            controller.clearSubmissionErrors()
          }}
        />
      )}
    </form.AppField>
  )
}

function RevolveFormView({ controller }: { controller: RevolveFormController }) {
  const { form } = controller
  return (
    <Form
      form={form}
      aria-label={controller.copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
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
          previewStatus={controller.previewStatus}
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
          extentField={
            <>
              <RevolveEndFields controller={controller} />
              <RevolveExtentFields controller={controller} />
            </>
          }
        />
      </TaskPanelContentProvider>
    </Form>
  )
}

export function RevolveForm(props: RevolveFormProps) {
  const controller = useRevolveFormController(props)
  return <RevolveFormView controller={controller} />
}
