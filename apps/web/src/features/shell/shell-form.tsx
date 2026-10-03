import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
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
  formatShellMeasurement,
  type ShellFormMode,
  type ShellFormValues,
  shellFormFeature,
  shellInitialSelection,
  shellInitialValues,
} from "./shell-form-model"

export type ShellFormCopy = ParameterPanelCopy &
  PrimitiveLengthCopy & {
    parameters: string
    thickness: string
    lengthDescription: string
    direction: string
    inward: string
    outward: string
    openings: string
    openingsDescription: string
    repair: string
    unavailable: string
    validationSummary: string
    submit: string
    staleRevision: string
    saveFailed: string
    face: (values: { number: number; area: string; x: string; y: string; z: string }) => string
  }
type ShellFormProps = FeatureParameterFormProps<ShellFormMode, ShellFormCopy> & {
  evidence: ModelBodyTopologyEvidence | null
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}
function ShellPreview(props: {
  values: ShellFormValues
  mode: ShellFormMode
  featureId: FeatureId
  evidence: ModelBodyTopologyEvidence | null
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: ShellFormCopy
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({
    onPreviewChange: props.onPreviewChange,
    preview: shellFormFeature(
      props.mode,
      props.featureId,
      props.values,
      props.evidence,
      props.variables,
      props.units,
      props.copy,
    ),
  })
  return null
}
export function ShellForm({
  baseRevision,
  copy,
  disabled = false,
  evidence,
  mode,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewStatus,
  variables,
}: ShellFormProps) {
  const state = useParameterFormState(variables)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const repair = shellInitialSelection(mode, evidence).repair
  const form = useAppForm({
    defaultValues: shellInitialValues(mode, evidence, state.displayUnits),
    onSubmit: async ({ value }) => {
      const feature = shellFormFeature(
        mode,
        featureId,
        value,
        evidence,
        variables,
        state.displayUnits,
        copy,
      )
      if (!feature) {
        state.setMessage(copy.validationSummary)
        return
      }
      state.setMessage(null)
      try {
        await submitFeatureMutation({
          baseRevision,
          copy,
          feature,
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
    <Form ref={state.formElementRef} form={form} aria-label={copy.title} className="gap-0">
      {onPreviewChange && (
        <form.Subscribe selector={(formState) => formState.values}>
          {(values) => (
            <ShellPreview
              values={values}
              mode={mode}
              featureId={featureId}
              evidence={evidence}
              variables={variables}
              units={state.displayUnits}
              copy={copy}
              onPreviewChange={onPreviewChange}
            />
          )}
        </form.Subscribe>
      )}
      <form.Subscribe selector={(formState) => formState.isSubmitting}>
        {(pending) => (
          <ParameterPanel
            copy={copy}
            legend={copy.parameters}
            disabled={disabled || pending}
            message={state.message}
            actions={
              <TaskPanelFormActions
                acceptLabel={copy.submit}
                ariaLabel={copy.title}
                cancelLabel={copy.cancel}
                disabled={disabled || !evidence}
                onCancel={onCancel}
                previewStatus={previewStatus}
              />
            }
          >
            {repair && (
              <p role="status" className="text-sm text-muted-foreground">
                {copy.repair}
              </p>
            )}
            {!evidence && (
              <p role="status" className="text-sm text-muted-foreground">
                {copy.unavailable}
              </p>
            )}
            <form.Field name="thickness">
              {(field) => (
                <LengthExpressionField
                  id="shell-thickness"
                  name="thickness"
                  label={copy.thickness}
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
            <form.Field name="direction">
              {(field) => (
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-xs font-medium">{copy.direction}</legend>
                  {(["inward", "outward"] as const).map((direction) => (
                    <label key={direction} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="direction"
                        checked={field.state.value === direction}
                        onBlur={field.handleBlur}
                        onChange={() => {
                          state.clearSubmissionErrors()
                          field.handleChange(direction)
                        }}
                      />
                      {copy[direction]}
                    </label>
                  ))}
                </fieldset>
              )}
            </form.Field>
            <form.Field name="openingIds">
              {(field) => (
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-xs font-medium">{copy.openings}</legend>
                  <p className="text-xs text-muted-foreground">{copy.openingsDescription}</p>
                  {evidence?.candidates.map((candidate, index) => (
                    <label key={candidate.candidateId} className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        name="openings"
                        checked={field.state.value.includes(candidate.candidateId)}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          state.clearSubmissionErrors()
                          field.handleChange(
                            event.currentTarget.checked
                              ? [...field.state.value, candidate.candidateId]
                              : field.state.value.filter((id) => id !== candidate.candidateId),
                          )
                        }}
                      />
                      {copy.face({
                        number: index + 1,
                        area: formatShellMeasurement(candidate.signature.measure),
                        x: formatShellMeasurement(candidate.signature.centroid[0]),
                        y: formatShellMeasurement(candidate.signature.centroid[1]),
                        z: formatShellMeasurement(candidate.signature.centroid[2]),
                      })}
                    </label>
                  ))}
                </fieldset>
              )}
            </form.Field>
          </ParameterPanel>
        )}
      </form.Subscribe>
    </Form>
  )
}
