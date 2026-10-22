import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import { readPatternFeatureParametersV2 } from "@vibeshape/domain/part-design-pattern"
import type { ReferenceAxis } from "@vibeshape/domain/reference-frame"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useState } from "react"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
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
import {
  type PatternFormMode,
  type PatternFormValues,
  type PatternValidationCopy,
  parsePatternForm,
  patternFeatureRecord,
  patternFormValues,
} from "./pattern-form-model"

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
  }
type Props = FeatureParameterFormProps<PatternFormMode, PatternFormCopy> & {
  sourceAvailable: boolean
  referenceOptions?: ReferenceFrameOptions | undefined
  selectedFace?: ViewerSelection | null | undefined
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}
function PatternPreview({
  values,
  variables,
  units,
  copy,
  mode,
  featureId,
  referenceAxis,
  onPreviewChange,
}: {
  values: PatternFormValues
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: PatternFormCopy
  mode: PatternFormMode
  featureId: FeatureId
  referenceAxis: ReferenceAxis | null | undefined
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  const parsed = parsePatternForm(values, variables, units, copy, referenceAxis ?? undefined)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview:
      parsed.ok && referenceAxis !== null
        ? patternFeatureRecord(mode, featureId, parsed, referenceAxis)
        : null,
  })
  return null
}
const commonExpressionFields = ["count"] as const
const linearFields = ["spacing"] as const
const circularFields = ["angle", "centerX", "centerY", "centerZ"] as const
function patternExpressionFields(
  kind: PatternFormValues["kind"],
  referenceAxis: ReferenceAxis | null | undefined,
) {
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
      if (referenceAxis === null) return
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
          feature: patternFeatureRecord(mode, featureId, parsed, referenceAxis),
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
    <Form form={form} aria-label={copy.title} className="gap-0">
      <form.FormError />
      <form.Subscribe selector={(formState) => [formState.values, formState.isSubmitting] as const}>
        {([values, pending]) => {
          const parsed = parsePatternForm(
            values,
            variables,
            state.displayUnits,
            copy,
            referenceAxis ?? undefined,
          )
          const fields = patternExpressionFields(values.kind, referenceAxis)
          const description = {
            count: copy.countDescription,
            spacing: copy.spacingDescription,
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
                  onPreviewChange={onPreviewChange}
                />
              )}
              <ParameterPanel
                copy={copy}
                legend={copy.parameters}
                disabled={disabled || pending || !sourceAvailable}
                message={panelMessage(state.message, sourceAvailable, previewStatus, copy)}
                actions={
                  <TaskPanelFormActions
                    acceptLabel={copy.submit}
                    ariaLabel={copy.title}
                    cancelLabel={copy.cancel}
                    disabled={disabled || !sourceAvailable || !parsed.ok || referenceAxis === null}
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
                      options={(["linear", "circular"] as const).map((kind) => ({
                        value: kind,
                        label: copy[kind],
                      }))}
                    />
                  )}
                </form.AppField>
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
                {fields.map((name) => (
                  <form.AppField name={name} key={name}>
                    {(field) => (
                      <field.LengthExpressionField
                        id={`pattern-${name}`}
                        label={copy[name]}
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
              </ParameterPanel>
            </>
          )
        }}
      </form.Subscribe>
    </Form>
  )
}
