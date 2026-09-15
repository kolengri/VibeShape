import {
  expectedHoleDependencyIds,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  holeFeatureParametersSchema,
  holeFeatureParametersV2Schema,
  holeFeatureType,
  holeFeatureTypeV2,
  readHoleBodyTarget,
  readHoleFeatureParameters,
  type SketchEntityId,
  type SketchRecord,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Button } from "@vibeshape/ui/components/button"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useRef, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import { defaultLengthExpression } from "../../document/document-display-units"
import { LengthExpressionField } from "../part-design/length-expression-field"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  parsePrimitiveLengthExpression,
  quantityExpression,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import { type HoleTargetBodyOption, holeTargetBodyKey } from "./hole-target-body"

export type HoleFormCopy = ParameterPanelCopy &
  Readonly<{
    sketch: string
    sketchDescription: string
    target: string
    targetDescription: string
    points: string
    pointsDescription: string
    pointLabel: (ordinal: number, id: string) => string
    removePoint: string
    noPoints: string
    missingPoint: string
    missingSketch: string
    missingTarget: string
    diameter: string
    depth: string
    expressionDescription: string
    direction: string
    forward: string
    reverse: string
    extent: string
    blind: string
    throughAll: string
    invalidExpression: string
    invalidDimension: string
    invalidRange: string
    validationSummary: string
    saveFailed: string
    staleRevision: string
    missingTargetRole?: string
    incompatibleTarget?: string
    submit: string
  }>

export type HoleTargetOption = HoleTargetBodyOption
export type HoleFormMode =
  | Readonly<{ kind: "create"; createFeatureId: () => FeatureId; featureLabel: string }>
  | Readonly<{ kind: "edit"; feature: FeatureRecord }>
export type HolePickingRequest = Readonly<{
  requestId: number
  featureId: FeatureId
  sketchId: SketchRecord["id"]
  pointId: SketchEntityId
}>
export type HolePickingContext = Readonly<{
  featureId: FeatureId
  sketchId: SketchRecord["id"]
  pointIds: readonly SketchEntityId[]
}>
export type HoleFormProps = Readonly<{
  baseRevision: number
  copy: HoleFormCopy
  disabled?: boolean
  mode: HoleFormMode
  sketches: readonly SketchRecord[]
  options: readonly HoleTargetOption[]
  variables: readonly VariableDefinition[]
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  onPreviewChange?: (feature: FeatureRecord | null) => void
  previewStatus?: FeaturePreviewState["status"]
  pickingRequest?: HolePickingRequest | null
  onPickingContextChange?: (context: HolePickingContext | null) => void
}>

type Values = {
  sketchId: string
  targetBodyKey: string
  pointIds: readonly SketchEntityId[]
  diameter: string
  depth: string
  direction: "forward" | "reverse"
  extent: "blind" | "through-all"
}

type ParseContext = Pick<HoleFormProps, "mode" | "sketches" | "options" | "variables" | "copy"> & {
  featureId: FeatureId
  displayUnit: Parameters<typeof defaultLengthExpression>[1]
}

function initialValues(context: ParseContext): Values {
  return context.mode.kind === "edit" ? editInitialValues(context) : createInitialValues(context)
}

function editInitialValues({ mode, displayUnit }: ParseContext): Values {
  if (mode.kind !== "edit") throw new Error("Expected edit mode")
  const parsed = readHoleFeatureParameters(mode.feature)
  if (!parsed) throw new Error("Invalid Hole parameters")
  const target = readHoleBodyTarget(mode.feature)
  return {
    sketchId: parsed.sketchId,
    targetBodyKey: holeTargetBodyKey(
      target?.featureId ?? mode.feature.dependencies[0] ?? "",
      target?.outputRole,
    ),
    pointIds: parsed.pointIds,
    diameter: quantityExpression(parsed.diameter),
    depth:
      parsed.extent === "blind"
        ? quantityExpression(parsed.depth)
        : defaultLengthExpression(10, displayUnit),
    direction: parsed.direction,
    extent: parsed.extent,
  }
}

function createInitialValues({ sketches, options, displayUnit }: ParseContext): Values {
  const option = options[0]
  return {
    sketchId: sketches[0]?.id ?? "",
    targetBodyKey: option ? holeTargetBodyKey(option.featureId, option.outputRole) : "",
    pointIds: [],
    diameter: defaultLengthExpression(5, displayUnit),
    depth: defaultLengthExpression(10, displayUnit),
    direction: "forward",
    extent: "blind",
  }
}

function validHolePointSelection(ids: readonly SketchEntityId[], sketch: SketchRecord | undefined) {
  const points = new Set(
    sketch?.entities.filter((entity) => entity.type === "point").map(({ id }) => id),
  )
  return ids.length > 0 && ids.length <= 256 && ids.every((id) => points.has(id))
}

function holeSelection(values: Values, context: ParseContext) {
  const sketch = context.sketches.find((item) => item.id === values.sketchId)
  const target = context.options.find(
    (option) => holeTargetBodyKey(option.featureId, option.outputRole) === values.targetBodyKey,
  )
  const issues = holeSelectionIssues(values, context, sketch, target)
  return sketch && target && Object.keys(issues).length === 0
    ? { ok: true as const, sketch, target }
    : { ok: false as const, issues }
}

function holeSelectionIssues(
  values: Values,
  context: ParseContext,
  sketch: SketchRecord | undefined,
  target: HoleTargetOption | undefined,
) {
  const issues: Record<string, string> = {}
  if (!sketch) issues.sketchId = context.copy.missingSketch
  if (!target) issues.targetBodyKey = context.copy.missingTarget
  if (target?.missing)
    issues.targetBodyKey = context.copy.missingTargetRole ?? context.copy.missingTarget
  if (!validHolePointSelection(values.pointIds, sketch)) issues.pointIds = context.copy.missingPoint
  if (incompatibleHoleSupport(sketch, target)) {
    issues.targetBodyKey = context.copy.incompatibleTarget ?? context.copy.missingTarget
  }
  return issues
}

function incompatibleHoleSupport(
  sketch: SketchRecord | undefined,
  target: HoleTargetOption | undefined,
) {
  return (
    target?.outputRole !== undefined &&
    target.outputRole !== "result" &&
    sketch?.support?.reference.featureId === target.featureId
  )
}

function holeDimensions(values: Values, context: ParseContext) {
  const { variables, copy, displayUnit } = context
  const validLength = (quantity: { value: number }) => quantity.value > 0 && quantity.value <= 1e6
  const diameter = parsePrimitiveLengthExpression(
    values.diameter,
    variables,
    copy,
    validLength,
    displayUnit,
  )
  const depth =
    values.extent === "blind"
      ? parsePrimitiveLengthExpression(values.depth, variables, copy, validLength, displayUnit)
      : { ok: true as const, quantity: undefined }
  const issues: Record<string, string> = {}
  if (!diameter.ok) issues.diameter = diameter.message
  if (!depth.ok) issues.depth = depth.message
  return diameter.ok && depth.ok
    ? { ok: true as const, diameter: diameter.quantity, depth: depth.quantity }
    : { ok: false as const, issues }
}

function parseValues(values: Values, context: ParseContext) {
  const selection = holeSelection(values, context)
  const dimensions = holeDimensions(values, context)
  if (!selection.ok || !dimensions.ok)
    return { ok: false as const, issues: { ...selection.issues, ...dimensions.issues } }
  const { sketch, target } = selection
  const { mode, featureId, copy } = context
  const parameters = parseHoleParameters(values, dimensions, sketch.id, target)
  const useNamedTarget = target.outputRole !== undefined
  if (!parameters.success) return { ok: false as const, issues: { pointIds: copy.missingPoint } }
  const feature = featureRecordSchema.parse({
    ...(mode.kind === "edit"
      ? mode.feature
      : { schemaVersion: 0, id: featureId, suppressed: false, label: mode.featureLabel }),
    type: useNamedTarget ? holeFeatureTypeV2.type : holeFeatureType.type,
    parameters: parameters.data,
    dependencies: expectedHoleDependencyIds(
      target.featureId,
      sketch.support?.reference.featureId ?? null,
    ),
    references: sketch.support ? [sketch.support.reference] : [],
  })
  return { ok: true as const, feature }
}

function parseHoleParameters(
  values: Values,
  dimensions: Extract<ReturnType<typeof holeDimensions>, { ok: true }>,
  sketchId: SketchRecord["id"],
  target: HoleTargetOption,
) {
  const base = {
    sketchId,
    pointIds: values.pointIds,
    diameter: dimensions.diameter,
    direction: values.direction,
    extent: values.extent,
    ...(values.extent === "blind" ? { depth: dimensions.depth } : {}),
  }
  return target.outputRole
    ? holeFeatureParametersV2Schema.safeParse({
        ...base,
        targetBody: {
          schemaVersion: 0,
          featureId: target.featureId,
          outputRole: target.outputRole,
        },
      })
    : holeFeatureParametersSchema.safeParse(base)
}

function HolePreview({
  values,
  context,
  onPreviewChange,
}: {
  values: Values
  context: ParseContext
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  const parsed = parseValues(values, context)
  useDebouncedFeaturePreview({ onPreviewChange, preview: parsed.ok ? parsed.feature : null })
  return null
}

function HolePickingEffects({
  values,
  context,
  disabled,
  request,
  onContextChange,
  onPointsChange,
}: {
  values: Values
  context: ParseContext
  disabled: boolean
  request: HolePickingRequest | null
  onContextChange: HoleFormProps["onPickingContextChange"]
  onPointsChange: (ids: readonly SketchEntityId[]) => void
}) {
  const consumed = useRef<number | null>(null)
  const sketch = context.sketches.find(({ id }) => id === values.sketchId)
  useEffect(() => {
    if (!onContextChange) return
    onContextChange(
      !disabled && sketch
        ? { featureId: context.featureId, sketchId: sketch.id, pointIds: values.pointIds }
        : null,
    )
    return () => onContextChange(null)
  }, [context.featureId, disabled, onContextChange, sketch, values.pointIds])
  useEffect(() => {
    if (!request || consumed.current === request.requestId) return
    consumed.current = request.requestId
    if (
      disabled ||
      request.featureId !== context.featureId ||
      request.sketchId !== sketch?.id ||
      !sketch.entities.some((entity) => entity.type === "point" && entity.id === request.pointId)
    )
      return
    onPointsChange(
      values.pointIds.includes(request.pointId)
        ? values.pointIds.filter((id) => id !== request.pointId)
        : [...values.pointIds, request.pointId],
    )
  }, [context.featureId, disabled, onPointsChange, request, sketch, values.pointIds])
  return null
}

function HolePoints({
  sketch,
  selected,
  copy,
  error,
  onChange,
}: {
  sketch: SketchRecord | undefined
  selected: readonly SketchEntityId[]
  copy: HoleFormCopy
  error: string | undefined
  onChange: (ids: readonly SketchEntityId[]) => void
}) {
  const points = sketch?.entities.filter((entity) => entity.type === "point") ?? []
  const missing = selected.filter((id) => !points.some((point) => point.id === id))
  return (
    <fieldset className="grid min-w-0 gap-2" aria-label={copy.points}>
      <legend className="text-sm font-medium">{copy.points}</legend>
      <p className="text-xs text-muted-foreground">{copy.pointsDescription}</p>
      {points.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.noPoints}</p>
      ) : null}
      {points.map((point, index) => (
        <label key={point.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(point.id)}
            onChange={(event) =>
              onChange(
                event.currentTarget.checked
                  ? [...selected, point.id]
                  : selected.filter((id) => id !== point.id),
              )
            }
          />
          {copy.pointLabel(index + 1, point.id)}
        </label>
      ))}
      {missing.map((id) => (
        <div key={id} className="grid min-w-0 gap-1">
          <p role="alert" className="text-xs text-destructive">
            {copy.missingPoint}
          </p>
          <code className="break-all text-xs">{id}</code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => onChange(selected.filter((pointId) => pointId !== id))}
          >
            {copy.removePoint}
          </Button>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

async function submitHole(
  values: Values,
  props: HoleFormProps,
  context: ParseContext,
  state: ReturnType<typeof useParameterFormState>,
) {
  if (props.disabled || (props.previewStatus !== undefined && props.previewStatus !== "ready"))
    return
  const parsed = parseValues(values, context)
  if (!parsed.ok) {
    state.setIssues(parsed.issues)
    state.setMessage(props.copy.validationSummary)
    return
  }
  state.clearSubmissionErrors()
  try {
    await submitFeatureMutation({
      baseRevision: props.baseRevision,
      copy: props.copy,
      feature: parsed.feature,
      onSave: props.onSave,
      onSaved: props.onSaved,
      setMessage: state.setMessage,
    })
  } catch {
    state.setMessage(props.copy.saveFailed)
  }
}

export function HoleForm(props: HoleFormProps) {
  const {
    copy,
    disabled = false,
    mode,
    sketches,
    options,
    variables,
    onCancel,
    onPreviewChange,
    previewStatus,
    pickingRequest = null,
    onPickingContextChange,
  } = props
  const state = useParameterFormState(variables)
  const { displayUnits, formElementRef, issues, message, suggestions, clearSubmissionErrors } =
    state
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const context = {
    copy,
    mode,
    sketches,
    options,
    variables,
    featureId,
    displayUnit: displayUnits.length,
  }
  const [initial] = useState(() => initialValues(context))
  const form = useAppForm({
    defaultValues: initial,
    onSubmit: ({ value }) => submitHole(value, props, context, state),
  })
  const changePoints = (ids: readonly SketchEntityId[]) => {
    clearSubmissionErrors()
    form.setFieldValue("pointIds", ids)
  }
  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <form.Subscribe selector={(formState) => [formState.values, formState.isSubmitting] as const}>
        {([values, isSubmitting]) => (
          <>
            {onPreviewChange ? (
              <HolePreview values={values} context={context} onPreviewChange={onPreviewChange} />
            ) : null}
            <HolePickingEffects
              values={values}
              context={context}
              disabled={disabled || isSubmitting}
              request={pickingRequest}
              onContextChange={onPickingContextChange}
              onPointsChange={changePoints}
            />
          </>
        )}
      </form.Subscribe>
      <form.Subscribe selector={(formState) => formState.isSubmitting}>
        {(isSubmitting) => (
          <ParameterPanel
            actions={
              <TaskPanelFormActions
                acceptLabel={copy.submit}
                ariaLabel={copy.title}
                cancelLabel={copy.cancel}
                disabled={disabled}
                onCancel={onCancel}
                previewStatus={previewStatus}
              />
            }
            copy={copy}
            disabled={disabled || isSubmitting}
            legend={copy.title}
            message={message}
          >
            <form.Field name="sketchId">
              {(field) => (
                <NativeSelectField
                  name={field.name}
                  value={field.state.value}
                  label={copy.sketch}
                  description={copy.sketchDescription}
                  error={issues.sketchId}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    clearSubmissionErrors()
                    field.handleChange(event.currentTarget.value)
                    form.setFieldValue("pointIds", [])
                  }}
                >
                  {!sketches.some(({ id }) => id === field.state.value) ? (
                    <option value={field.state.value}>{copy.missingSketch}</option>
                  ) : null}
                  {sketches.map((sketch) => (
                    <option key={sketch.id} value={sketch.id}>
                      {sketch.label}
                    </option>
                  ))}
                </NativeSelectField>
              )}
            </form.Field>
            <form.Field name="targetBodyKey">
              {(field) => {
                const selectedOption = options.find(
                  (option) =>
                    holeTargetBodyKey(option.featureId, option.outputRole) === field.state.value,
                )
                return (
                  <NativeSelectField
                    name={field.name}
                    value={field.state.value}
                    label={copy.target}
                    description={copy.targetDescription}
                    error={
                      selectedOption?.missing
                        ? (copy.missingTargetRole ?? copy.missingTarget)
                        : issues.targetBodyKey
                    }
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      clearSubmissionErrors()
                      field.handleChange(event.currentTarget.value)
                    }}
                  >
                    {!options.some(
                      (option) =>
                        holeTargetBodyKey(option.featureId, option.outputRole) ===
                        field.state.value,
                    ) ? (
                      <option value={field.state.value}>{copy.missingTarget}</option>
                    ) : null}
                    {options.map((option) => (
                      <option
                        key={holeTargetBodyKey(option.featureId, option.outputRole)}
                        value={holeTargetBodyKey(option.featureId, option.outputRole)}
                      >
                        {option.label}
                      </option>
                    ))}
                  </NativeSelectField>
                )
              }}
            </form.Field>
            <form.Subscribe
              selector={(formState) =>
                [formState.values.sketchId, formState.values.pointIds] as const
              }
            >
              {([sketchId, pointIds]) => (
                <HolePoints
                  sketch={sketches.find(({ id }) => id === sketchId)}
                  selected={pointIds}
                  copy={copy}
                  error={issues.pointIds}
                  onChange={changePoints}
                />
              )}
            </form.Subscribe>
            <form.Field name="diameter">
              {(field) => (
                <LengthExpressionField
                  id="hole-diameter"
                  name={field.name}
                  value={field.state.value}
                  label={copy.diameter}
                  description={copy.expressionDescription}
                  error={issues.diameter}
                  suggestions={suggestions}
                  onBlur={field.handleBlur}
                  onValueChange={(value) => {
                    clearSubmissionErrors()
                    field.handleChange(value)
                  }}
                />
              )}
            </form.Field>
            <form.Field name="extent">
              {(field) => (
                <NativeSelectField
                  name={field.name}
                  value={field.state.value}
                  label={copy.extent}
                  onChange={(event) => {
                    clearSubmissionErrors()
                    field.handleChange(
                      event.currentTarget.value === "blind" ? "blind" : "through-all",
                    )
                  }}
                >
                  <option value="blind">{copy.blind}</option>
                  <option value="through-all">{copy.throughAll}</option>
                </NativeSelectField>
              )}
            </form.Field>
            <form.Subscribe selector={(formState) => formState.values.extent}>
              {(extent) =>
                extent === "blind" ? (
                  <form.Field name="depth">
                    {(field) => (
                      <LengthExpressionField
                        id="hole-depth"
                        name={field.name}
                        value={field.state.value}
                        label={copy.depth}
                        description={copy.expressionDescription}
                        error={issues.depth}
                        suggestions={suggestions}
                        onBlur={field.handleBlur}
                        onValueChange={(value) => {
                          clearSubmissionErrors()
                          field.handleChange(value)
                        }}
                      />
                    )}
                  </form.Field>
                ) : null
              }
            </form.Subscribe>
            <form.Field name="direction">
              {(field) => (
                <NativeSelectField
                  name={field.name}
                  value={field.state.value}
                  label={copy.direction}
                  onChange={(event) => {
                    clearSubmissionErrors()
                    field.handleChange(
                      event.currentTarget.value === "forward" ? "forward" : "reverse",
                    )
                  }}
                >
                  <option value="forward">{copy.forward}</option>
                  <option value="reverse">{copy.reverse}</option>
                </NativeSelectField>
              )}
            </form.Field>
          </ParameterPanel>
        )}
      </form.Subscribe>
    </Form>
  )
}
