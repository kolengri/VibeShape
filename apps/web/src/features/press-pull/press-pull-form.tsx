import type { FeatureId, FeatureRecord } from "@vibeshape/domain"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { LengthExpressionField } from "../part-design/length-expression-field"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  type PrimitiveLengthCopy,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import {
  type PressPullFormMode,
  pressPullFormFeature,
  pressPullInitialDistance,
  pressPullSourceIsCurrent,
} from "./press-pull-form-model"

export type PressPullFormCopy = ParameterPanelCopy &
  PrimitiveLengthCopy & {
    parameters: string
    distance: string
    lengthDescription: string
    unavailable: string
    validationSummary: string
    submit: string
    staleRevision: string
    saveFailed: string
    previewFailed: string
  }
type PressPullFormProps = FeatureParameterFormProps<PressPullFormMode, PressPullFormCopy> & {
  evidence: ModelBodyTopologyEvidence | null
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}
function PressPullPreview({
  feature,
  onPreviewChange,
}: {
  feature: FeatureRecord | null
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({ preview: feature, onPreviewChange })
  return null
}
export function PressPullForm(props: PressPullFormProps) {
  const {
    mode,
    evidence,
    variables,
    copy,
    disabled = false,
    onCancel,
    onPreviewChange,
    previewStatus,
  } = props
  const state = useParameterFormState(variables)
  const [featureId] = useState<FeatureId>(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const current = pressPullSourceIsCurrent(mode, evidence)
  const feature = (distance: string) =>
    pressPullFormFeature(mode, featureId, distance, evidence, variables, state.displayUnits, copy)
  const form = useAppForm({
    defaultValues: { distance: pressPullInitialDistance(mode, state.displayUnits) },
    onSubmit: async ({ value }) => {
      const candidate = feature(value.distance)
      if (!candidate) {
        state.setMessage(copy.validationSummary)
        return
      }
      state.setMessage(null)
      try {
        await submitFeatureMutation({
          baseRevision: props.baseRevision,
          copy,
          feature: candidate,
          onSave: props.onSave,
          onSaved: props.onSaved,
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
      {onPreviewChange && (
        <form.Subscribe selector={(state) => state.values.distance}>
          {(distance) => (
            <PressPullPreview feature={feature(distance)} onPreviewChange={onPreviewChange} />
          )}
        </form.Subscribe>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <ParameterPanel
            copy={copy}
            legend={copy.parameters}
            disabled={disabled || pending}
            message={state.message ?? (previewStatus === "error" ? copy.previewFailed : null)}
            actions={
              <TaskPanelFormActions
                acceptLabel={copy.submit}
                ariaLabel={copy.title}
                cancelLabel={copy.cancel}
                disabled={disabled || !current}
                onCancel={onCancel}
                previewStatus={previewStatus}
              />
            }
          >
            {!current && (
              <p role="status" className="text-sm text-muted-foreground">
                {copy.unavailable}
              </p>
            )}
            <form.Field name="distance">
              {(field) => (
                <LengthExpressionField
                  id="press-pull-distance"
                  name="distance"
                  label={copy.distance}
                  description={copy.lengthDescription}
                  value={field.state.value}
                  suggestions={state.suggestions}
                  onBlur={field.handleBlur}
                  onValueChange={(value) => {
                    state.clearSubmissionErrors()
                    field.handleChange(value)
                  }}
                />
              )}
            </form.Field>
          </ParameterPanel>
        )}
      </form.Subscribe>
    </Form>
  )
}
