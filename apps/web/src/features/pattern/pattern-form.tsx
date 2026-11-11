import type {
  DocumentDisplayUnits,
  DocumentSnapshot,
  FeatureId,
  FeatureRecord,
  SketchEntityId,
  VariableDefinition,
} from "@vibeshape/domain"
import { readPatternFeatureParametersV2 } from "@vibeshape/domain/part-design-pattern"
import type { ReferenceAxis } from "@vibeshape/domain/reference-frame"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useEffect, useRef, useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import type { ReferenceFrameOptions } from "../reference-geometry/reference-frame-options"
import { ReferenceAxisSelection } from "../reference-geometry/reference-support-fields"
import { type PathSketchOption, togglePathCurve } from "../sweep-loft/sweep-loft-form-model"
import { SketchPathFields, type SketchPathValues } from "../sweep-loft/sweep-path-fields"
import {
  type PatternFormMode,
  type PatternFormValues,
  type PatternValidationCopy,
  parsePatternForm,
  patternFeatureRecord,
  patternFormValues,
} from "./pattern-form-model"
import type {
  PatternPathPickingContext,
  PatternPathPickingRequest,
} from "./use-pattern-path-picking"

export type PatternFormCopy = ParameterPanelCopy &
  PatternValidationCopy & {
    parameters: string
    submit: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
    unavailable: string
    previewFailed: string
    pathPreviewFailed: string
    kind: string
    linear: string
    circular: string
    axis: string
    count: string
    countDescription: string
    spacing: string
    spacingDescription: string
    angle: string
    angleDescription: string
    centerX: string
    centerY: string
    centerZ: string
    centerDescription: string
    path: string
    pathSketch: string
    choosePath: string
    pathCurves: string
    pathDescription: string
    startPoint: string
    chooseStart: string
    unavailablePath: string
    spacingMode: string
    spacingEqual: string
    spacingFixed: string
    pathSpacing: string
    pathSpacingDescription: string
    startOffset: string
    startOffsetDescription: string
    orientation: string
    translate: string
    follow: string
    reverse: string
    reverseDescription: string
  }
type Props = FeatureParameterFormProps<PatternFormMode, PatternFormCopy> & {
  sourceAvailable: boolean
  referenceOptions?: ReferenceFrameOptions | undefined
  selectedFace?: ViewerSelection | null | undefined
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
  snapshot: DocumentSnapshot
  paths: readonly PathSketchOption[]
  pickingRequest?: PatternPathPickingRequest | null | undefined
  onPickingContextChange?: ((context: PatternPathPickingContext | null) => void) | undefined
}
function PatternPreview({
  values,
  variables,
  units,
  copy,
  mode,
  featureId,
  referenceAxis,
  snapshot,
  onPreviewChange,
}: {
  values: PatternFormValues
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: PatternFormCopy
  mode: PatternFormMode
  featureId: FeatureId
  referenceAxis: ReferenceAxis | null | undefined
  snapshot: DocumentSnapshot
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  const parsed = parsePatternForm(values, variables, units, copy, referenceAxis ?? undefined)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview:
      parsed.ok && (values.kind === "path" || referenceAxis !== null)
        ? patternFeatureRecord(mode, featureId, parsed, referenceAxis ?? undefined, snapshot)
        : null,
  })
  return null
}
/**
 * Publishes the chosen path sketch for viewport picking and applies each picked curve once,
 * through the same toggle and start-point reconciliation as the panel's curve checkboxes.
 */
function PatternPathPicking({
  values,
  featureId,
  disabled,
  paths,
  request,
  onContextChange,
  onPathChange,
}: {
  values: PatternFormValues
  featureId: FeatureId
  disabled: boolean
  paths: readonly PathSketchOption[]
  request: PatternPathPickingRequest | null | undefined
  onContextChange: ((context: PatternPathPickingContext | null) => void) | undefined
  onPathChange: (changes: Partial<SketchPathValues>) => void
}) {
  const consumed = useRef<number | null>(null)
  const sketchId = values.kind === "path" && !disabled ? values.pathSketchId : ""
  useEffect(() => {
    if (!onContextChange) return
    onContextChange(sketchId ? { featureId, sketchId } : null)
    return () => onContextChange(null)
  }, [featureId, onContextChange, sketchId])
  useEffect(() => {
    if (!request || consumed.current === request.requestId) return
    consumed.current = request.requestId
    if (!sketchId || request.featureId !== featureId || request.sketchId !== sketchId) return
    const entityId = request.entityId as SketchEntityId
    const path = paths.find(({ sketch }) => sketch.id === sketchId)
    onPathChange(togglePathCurve(path, values, entityId, !values.entityIds.includes(entityId)))
  }, [featureId, onPathChange, paths, request, sketchId, values])
  return null
}
const commonExpressionFields = ["count"] as const
const linearFields = ["spacing"] as const
const circularFields = ["angle", "centerX", "centerY", "centerZ"] as const
function patternExpressionFields(
  values: PatternFormValues,
  referenceAxis: ReferenceAxis | null | undefined,
) {
  const kind = values.kind
  if (kind === "path")
    return values.spacingMode === "fixed"
      ? (["count", "spacing", "startOffset"] as const)
      : (["count", "startOffset"] as const)
  if (kind === "linear") return [...commonExpressionFields, ...linearFields] as const
  return referenceAxis === undefined
    ? ([...commonExpressionFields, ...circularFields] as const)
    : (["count", "angle"] as const)
}
function panelMessage(
  message: string | null,
  sourceAvailable: boolean,
  status: FeaturePreviewState["status"] | undefined,
  copy: PatternFormCopy,
  isPath: boolean,
) {
  if (message) return message
  if (!sourceAvailable) return copy.unavailable
  if (status !== "error") return null
  return isPath ? copy.pathPreviewFailed : copy.previewFailed
}
type FormContext = Readonly<{
  props: Props
  state: ReturnType<typeof useParameterFormState>
  featureId: FeatureId
  referenceAxis: ReferenceAxis | null | undefined
}>
function parseValues(values: PatternFormValues, context: FormContext) {
  return parsePatternForm(
    values,
    context.props.variables,
    context.state.displayUnits,
    context.props.copy,
    context.referenceAxis ?? undefined,
  )
}
/** Saves one validated pattern; Path needs no axis, other kinds need a resolved axis choice. */
async function submitPattern(values: PatternFormValues, context: FormContext) {
  const { props, state, featureId, referenceAxis } = context
  if (props.disabled || !isFeaturePreviewReady(props.previewStatus)) return
  if (values.kind !== "path" && referenceAxis === null) return
  const parsed = parseValues(values, context)
  if (!parsed.ok) return
  state.setMessage(null)
  try {
    await submitFeatureMutation({
      baseRevision: props.baseRevision,
      copy: props.copy,
      feature: patternFeatureRecord(
        props.mode,
        featureId,
        parsed,
        referenceAxis ?? undefined,
        props.snapshot,
      ),
      onSave: props.onSave,
      onSaved: props.onSaved,
      setMessage: state.setMessage,
    })
  } catch {
    state.setMessage(props.copy.saveFailed)
  }
}
function usePatternForm(context: FormContext) {
  return useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: patternFormValues(context.props.mode, context.state.displayUnits),
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parseValues(value, context)
        return parsed.ok
          ? undefined
          : { form: context.props.copy.validationSummary, fields: parsed.issues }
      },
    },
    onSubmit: ({ value }) => submitPattern(value, context),
  })
}
type PatternFormApi = ReturnType<typeof usePatternForm>
type ExpressionField = ReturnType<typeof patternExpressionFields>[number]
/** Kind-specific labels, descriptions and Apply availability for one rendered value set. */
function panelPresentation(
  values: PatternFormValues,
  context: FormContext,
  pending: boolean,
): Readonly<{
  isPath: boolean
  busy: boolean
  canApply: boolean
  issues: Partial<Record<keyof PatternFormValues, string>>
  label: Record<ExpressionField, string>
  description: Record<ExpressionField, string>
}> {
  const { copy, disabled = false, sourceAvailable } = context.props
  const parsed = parseValues(values, context)
  const isPath = values.kind === "path"
  const axisReady = isPath || context.referenceAxis !== null
  return {
    isPath,
    busy: disabled || pending || !sourceAvailable,
    canApply: !disabled && sourceAvailable && parsed.ok && axisReady,
    issues: parsed.ok ? {} : parsed.issues,
    ...expressionFieldCopy(copy, isPath),
  }
}
/** Path spacing is an arc-length distance; linear spacing is a signed axis step. */
function expressionFieldCopy(copy: PatternFormCopy, isPath: boolean) {
  return {
    label: { ...copy, spacing: isPath ? copy.pathSpacing : copy.spacing },
    description: {
      count: copy.countDescription,
      spacing: isPath ? copy.pathSpacingDescription : copy.spacingDescription,
      startOffset: copy.startOffsetDescription,
      angle: copy.angleDescription,
      centerX: copy.centerDescription,
      centerY: copy.centerDescription,
      centerZ: copy.centerDescription,
    },
  }
}
type ChoiceName = "kind" | "spacingMode" | "orientation"
function pathChoices(copy: PatternFormCopy) {
  return {
    spacingMode: [
      { value: "equal", label: copy.spacingEqual },
      { value: "fixed", label: copy.spacingFixed },
    ],
    orientation: (["translate", "follow"] as const).map((value) => ({
      value,
      label: copy[value],
    })),
  }
}
/** Panel checkboxes and viewport picks edit the path through this one owner. */
function applyPathChanges(
  form: PatternFormApi,
  context: FormContext,
  changes: Partial<SketchPathValues>,
) {
  context.state.clearSubmissionErrors()
  for (const [name, value] of Object.entries(changes))
    form.setFieldValue(name as keyof SketchPathValues, value as never)
}
function PatternChoice({
  form,
  name,
  label,
  options,
  onChange,
}: {
  form: PatternFormApi
  name: ChoiceName
  label: string
  options: readonly { value: string; label: string }[]
  onChange: () => void
}) {
  return (
    <form.AppField name={name}>
      {(field) => <field.ChoiceField label={label} onValueChange={onChange} options={options} />}
    </form.AppField>
  )
}
function PatternEffects({
  form,
  values,
  context,
  busy,
}: {
  form: PatternFormApi
  values: PatternFormValues
  context: FormContext
  busy: boolean
}) {
  const { props, state, featureId, referenceAxis } = context
  return (
    <>
      {props.onPreviewChange && props.sourceAvailable && (
        <PatternPreview
          values={values}
          variables={props.variables}
          units={state.displayUnits}
          copy={props.copy}
          mode={props.mode}
          featureId={featureId}
          referenceAxis={referenceAxis}
          snapshot={props.snapshot}
          onPreviewChange={props.onPreviewChange}
        />
      )}
      <PatternPathPicking
        values={values}
        featureId={featureId}
        disabled={busy}
        paths={props.paths}
        request={props.pickingRequest}
        onContextChange={props.onPickingContextChange}
        onPathChange={(changes) => applyPathChanges(form, context, changes)}
      />
    </>
  )
}
function PatternSupportFields({
  form,
  values,
  context,
  error,
  onChange,
  onReferenceChange,
}: {
  form: PatternFormApi
  values: PatternFormValues
  context: FormContext
  error: string | undefined
  onChange: () => void
  onReferenceChange: (axis: ReferenceAxis | null | undefined) => void
}) {
  const { copy } = context.props
  if (values.kind === "path")
    return (
      <PathFields
        copy={copy}
        values={values}
        paths={context.props.paths}
        error={error}
        onChange={(changes) => applyPathChanges(form, context, changes)}
      />
    )
  return (
    <ReferenceAxisSelection
      options={context.props.referenceOptions}
      value={context.referenceAxis}
      selectedFace={context.props.selectedFace}
      onChange={onReferenceChange}
    >
      <form.AppField name="axis">
        {(field) => (
          <field.ChoiceField
            label={copy.axis}
            onValueChange={onChange}
            options={(["X", "Y", "Z"] as const).map((axis) => ({ value: axis, label: axis }))}
          />
        )}
      </form.AppField>
    </ReferenceAxisSelection>
  )
}
function PatternFormBody({
  form,
  values,
  pending,
  context,
  onReferenceChange,
}: {
  form: PatternFormApi
  values: PatternFormValues
  pending: boolean
  context: FormContext
  onReferenceChange: (axis: ReferenceAxis | null | undefined) => void
}) {
  const { props, state } = context
  const { copy } = props
  const view = panelPresentation(values, context, pending)
  const clear = () => state.clearSubmissionErrors()
  const choices = pathChoices(copy)
  return (
    <>
      <PatternEffects form={form} values={values} context={context} busy={view.busy} />
      <ParameterPanel
        previewStatus={props.previewStatus}
        copy={copy}
        legend={copy.parameters}
        disabled={view.busy}
        message={panelMessage(
          state.message,
          props.sourceAvailable,
          props.previewStatus,
          copy,
          view.isPath,
        )}
        actions={
          <TaskPanelFormActions
            acceptLabel={copy.submit}
            ariaLabel={copy.title}
            cancelLabel={copy.cancel}
            disabled={!view.canApply}
            onCancel={props.onCancel}
            previewStatus={props.previewStatus}
          />
        }
      >
        <PatternChoice
          form={form}
          name="kind"
          label={copy.kind}
          onChange={clear}
          options={(["linear", "circular", "path"] as const).map((kind) => ({
            value: kind,
            label: copy[kind],
          }))}
        />
        <PatternSupportFields
          form={form}
          values={values}
          context={context}
          error={view.issues.entityIds}
          onChange={clear}
          onReferenceChange={onReferenceChange}
        />
        {view.isPath && (
          <PatternChoice
            form={form}
            name="spacingMode"
            label={copy.spacingMode}
            options={choices.spacingMode}
            onChange={clear}
          />
        )}
        {patternExpressionFields(values, context.referenceAxis).map((name) => (
          <form.AppField name={name} key={name}>
            {(field) => (
              <field.LengthExpressionField
                id={`pattern-${name}`}
                label={view.label[name]}
                description={view.description[name]}
                error={view.issues[name]}
                suggestions={state.suggestions}
                onValueChange={clear}
              />
            )}
          </form.AppField>
        ))}
        {view.isPath && <PathOrientationFields form={form} copy={copy} onChange={clear} />}
      </ParameterPanel>
    </>
  )
}
function PathOrientationFields({
  form,
  copy,
  onChange,
}: {
  form: PatternFormApi
  copy: PatternFormCopy
  onChange: () => void
}) {
  return (
    <>
      <PatternChoice
        form={form}
        name="orientation"
        label={copy.orientation}
        options={pathChoices(copy).orientation}
        onChange={onChange}
      />
      <form.AppField name="reverse">
        {(field) => (
          <field.CheckboxField
            id="pattern-reverse"
            label={copy.reverse}
            description={copy.reverseDescription}
            onValueChange={onChange}
          />
        )}
      </form.AppField>
    </>
  )
}
export function PatternForm(props: Props) {
  const { copy, mode } = props
  const state = useParameterFormState(props.variables)
  const [referenceAxis, setReference] = useState<ReferenceAxis | null | undefined>(() =>
    mode.kind === "edit" ? readPatternFeatureParametersV2(mode.feature)?.axis : undefined,
  )
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const context: FormContext = { props, state, featureId, referenceAxis }
  const form = usePatternForm(context)
  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
        <form.Subscribe
          selector={(formState) => [formState.values, formState.isSubmitting] as const}
        >
          {([values, pending]) => (
            <PatternFormBody
              form={form}
              values={values}
              pending={pending}
              context={context}
              onReferenceChange={setReference}
            />
          )}
        </form.Subscribe>
      </TaskPanelContentProvider>
    </Form>
  )
}

function PathFields({
  copy,
  values,
  paths,
  error,
  onChange,
}: {
  copy: PatternFormCopy
  values: PatternFormValues
  paths: readonly PathSketchOption[]
  error: string | undefined
  onChange: (values: Partial<SketchPathValues>) => void
}) {
  return (
    <>
      <SketchPathFields
        values={values}
        paths={paths}
        copy={{ ...copy, profile: copy.pathSketch, chooseProfile: copy.choosePath }}
        onChange={onChange}
        idPrefix="pattern"
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )
}
