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
import type { PathSketchOption } from "../sweep-loft/sweep-loft-form-model"
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
/** Publishes the chosen path sketch for viewport picking and applies each picked curve once. */
function PatternPathPicking({
  values,
  featureId,
  disabled,
  request,
  onContextChange,
  onEntityIdsChange,
}: {
  values: PatternFormValues
  featureId: FeatureId
  disabled: boolean
  request: PatternPathPickingRequest | null | undefined
  onContextChange: ((context: PatternPathPickingContext | null) => void) | undefined
  onEntityIdsChange: (ids: SketchEntityId[]) => void
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
    onEntityIdsChange(
      values.entityIds.includes(entityId)
        ? values.entityIds.filter((id) => id !== entityId)
        : [...values.entityIds, entityId].sort(),
    )
  }, [featureId, onEntityIdsChange, request, sketchId, values.entityIds])
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
) {
  if (message) return message
  if (!sourceAvailable) return copy.unavailable
  return status === "error" ? copy.previewFailed : null
}
export function PatternForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  referenceOptions,
  selectedFace,
  sourceAvailable,
  snapshot,
  paths,
  pickingRequest,
  onPickingContextChange,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewStatus,
  variables,
}: Props) {
  const state = useParameterFormState(variables)
  const [referenceAxis, setReference] = useState<ReferenceAxis | null | undefined>(() =>
    mode.kind === "edit" ? readPatternFeatureParametersV2(mode.feature)?.axis : undefined,
  )
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: patternFormValues(mode, state.displayUnits),
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parsePatternForm(
          value,
          variables,
          state.displayUnits,
          copy,
          referenceAxis ?? undefined,
        )
        return parsed.ok ? undefined : { form: copy.validationSummary, fields: parsed.issues }
      },
    },
    onSubmit: async ({ value }) => {
      if (disabled || !isFeaturePreviewReady(previewStatus)) return
      if (value.kind !== "path" && referenceAxis === null) return
      const parsed = parsePatternForm(
        value,
        variables,
        state.displayUnits,
        copy,
        referenceAxis ?? undefined,
      )
      if (!parsed.ok) return

      state.setMessage(null)
      try {
        await submitFeatureMutation({
          baseRevision,
          copy,
          feature: patternFeatureRecord(
            mode,
            featureId,
            parsed,
            referenceAxis ?? undefined,
            snapshot,
          ),
          onSave,
          onSaved,
          setMessage: state.setMessage,
        })
      } catch {
        state.setMessage(copy.saveFailed)
      }
    },
  })
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
          {([values, pending]) => {
            const parsed = parsePatternForm(
              values,
              variables,
              state.displayUnits,
              copy,
              referenceAxis ?? undefined,
            )
            const fields = patternExpressionFields(values, referenceAxis)
            const isPath = values.kind === "path"
            const labels = {
              ...copy,
              spacing: isPath ? copy.pathSpacing : copy.spacing,
            }
            const description = {
              count: copy.countDescription,
              spacing: isPath ? copy.pathSpacingDescription : copy.spacingDescription,
              startOffset: copy.startOffsetDescription,
              angle: copy.angleDescription,
              centerX: copy.centerDescription,
              centerY: copy.centerDescription,
              centerZ: copy.centerDescription,
            }
            return (
              <>
                {onPreviewChange && sourceAvailable && (
                  <PatternPreview
                    values={values}
                    variables={variables}
                    units={state.displayUnits}
                    copy={copy}
                    mode={mode}
                    featureId={featureId}
                    referenceAxis={referenceAxis}
                    snapshot={snapshot}
                    onPreviewChange={onPreviewChange}
                  />
                )}
                <PatternPathPicking
                  values={values}
                  featureId={featureId}
                  disabled={disabled || pending || !sourceAvailable}
                  request={pickingRequest}
                  onContextChange={onPickingContextChange}
                  onEntityIdsChange={(ids) => form.setFieldValue("entityIds", ids)}
                />
                <ParameterPanel
                  previewStatus={previewStatus}
                  copy={copy}
                  legend={copy.parameters}
                  disabled={disabled || pending || !sourceAvailable}
                  message={panelMessage(state.message, sourceAvailable, previewStatus, copy)}
                  actions={
                    <TaskPanelFormActions
                      acceptLabel={copy.submit}
                      ariaLabel={copy.title}
                      cancelLabel={copy.cancel}
                      disabled={
                        disabled ||
                        !sourceAvailable ||
                        !parsed.ok ||
                        (!isPath && referenceAxis === null)
                      }
                      onCancel={onCancel}
                      previewStatus={previewStatus}
                    />
                  }
                >
                  <form.AppField name="kind">
                    {(field) => (
                      <field.ChoiceField
                        label={copy.kind}
                        onValueChange={() => {
                          state.clearSubmissionErrors()
                        }}
                        options={(["linear", "circular", "path"] as const).map((kind) => ({
                          value: kind,
                          label: copy[kind],
                        }))}
                      />
                    )}
                  </form.AppField>
                  {isPath ? (
                    <PathFields
                      copy={copy}
                      values={values}
                      paths={paths}
                      error={parsed.ok ? undefined : parsed.issues.entityIds}
                      onChange={(changes) => {
                        state.clearSubmissionErrors()
                        for (const [name, value] of Object.entries(changes))
                          form.setFieldValue(name as keyof SketchPathValues, value as never)
                      }}
                    />
                  ) : (
                    <ReferenceAxisSelection
                      options={referenceOptions}
                      value={referenceAxis}
                      selectedFace={selectedFace}
                      onChange={setReference}
                    >
                      <form.AppField name="axis">
                        {(field) => (
                          <field.ChoiceField
                            label={copy.axis}
                            onValueChange={() => {
                              state.clearSubmissionErrors()
                            }}
                            options={(["X", "Y", "Z"] as const).map((axis) => ({
                              value: axis,
                              label: axis,
                            }))}
                          />
                        )}
                      </form.AppField>
                    </ReferenceAxisSelection>
                  )}
                  {isPath && (
                    <form.AppField name="spacingMode">
                      {(field) => (
                        <field.ChoiceField
                          label={copy.spacingMode}
                          onValueChange={() => {
                            state.clearSubmissionErrors()
                          }}
                          options={[
                            { value: "equal", label: copy.spacingEqual },
                            { value: "fixed", label: copy.spacingFixed },
                          ]}
                        />
                      )}
                    </form.AppField>
                  )}
                  {fields.map((name) => (
                    <form.AppField name={name} key={name}>
                      {(field) => (
                        <field.LengthExpressionField
                          id={`pattern-${name}`}
                          label={labels[name]}
                          description={description[name]}
                          error={parsed.ok ? undefined : parsed.issues[name]}
                          suggestions={state.suggestions}
                          onValueChange={() => {
                            state.clearSubmissionErrors()
                          }}
                        />
                      )}
                    </form.AppField>
                  ))}
                  {isPath && (
                    <>
                      <form.AppField name="orientation">
                        {(field) => (
                          <field.ChoiceField
                            label={copy.orientation}
                            onValueChange={() => {
                              state.clearSubmissionErrors()
                            }}
                            options={(["translate", "follow"] as const).map((value) => ({
                              value,
                              label: copy[value],
                            }))}
                          />
                        )}
                      </form.AppField>
                      <form.AppField name="reverse">
                        {(field) => (
                          <field.CheckboxField
                            id="pattern-reverse"
                            label={copy.reverse}
                            description={copy.reverseDescription}
                            onValueChange={() => {
                              state.clearSubmissionErrors()
                            }}
                          />
                        )}
                      </form.AppField>
                    </>
                  )}
                </ParameterPanel>
              </>
            )
          }}
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
