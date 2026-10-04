import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import { readSplitFeatureParametersV2 } from "@vibeshape/domain/part-design-split"
import type { ReferencePlane } from "@vibeshape/domain/reference-frame"
import { Button } from "@vibeshape/ui/components/button"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useEffect, useState } from "react"
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
import type { ReferenceFrameOptions } from "../reference-geometry/reference-frame-options"
import { ReferencePlaneSelection } from "../reference-geometry/reference-support-fields"
import {
  parseSplitForm,
  type SplitBounds,
  type SplitFormMode,
  type SplitFormValues,
  splitFeatureRecord,
  splitFormValues,
  splitMidpointExpression,
} from "./split-form-model"

export type SplitFormCopy = ParameterPanelCopy &
  PrimitiveLengthCopy & {
    parameters: string
    plane: string
    offset: string
    lengthDescription: string
    planeDescription: string
    midpoint: string
    unavailable: string
    submit: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }
type SplitFormProps = FeatureParameterFormProps<SplitFormMode, SplitFormCopy> & {
  sourceBounds: SplitBounds | null
  referenceOptions?: ReferenceFrameOptions | undefined
  selectedFace?: ViewerSelection | null | undefined
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}
function SplitPreview({
  values,
  variables,
  units,
  copy,
  mode,
  featureId,
  referencePlane,
  onPreviewChange,
}: {
  values: SplitFormValues
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: SplitFormCopy
  mode: SplitFormMode
  featureId: FeatureId
  referencePlane: ReferencePlane | null | undefined
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  const parsed = parseSplitForm(values, variables, units, copy)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview:
      parsed.ok && referencePlane !== null
        ? splitFeatureRecord(mode, featureId, parsed, referencePlane)
        : null,
  })
  return null
}
export function SplitForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  referenceOptions,
  selectedFace,
  sourceBounds,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewStatus,
  variables,
}: SplitFormProps) {
  const state = useParameterFormState(variables)
  const [referencePlane, setReference] = useState<ReferencePlane | null | undefined>(() =>
    mode.kind === "edit" ? readSplitFeatureParametersV2(mode.feature)?.plane : undefined,
  )
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues: splitFormValues(mode, sourceBounds, state.displayUnits),
    onSubmit: async ({ value }) => {
      if (referencePlane === null) return
      const parsed = parseSplitForm(value, variables, state.displayUnits, copy)
      if (!parsed.ok) {
        state.setIssues(parsed.issues)
        state.setMessage(copy.validationSummary)
        return
      }
      state.setIssues({})
      state.setMessage(null)
      try {
        await submitFeatureMutation({
          baseRevision,
          copy,
          feature: splitFeatureRecord(mode, featureId, parsed, referencePlane),
          onSave,
          onSaved,
          setMessage: state.setMessage,
        })
      } catch {
        state.setMessage(copy.saveFailed)
      }
    },
  })
  const invalidOffset = Boolean(state.issues.offset)
  useEffect(() => {
    if (invalidOffset)
      state.formElementRef.current?.querySelector<HTMLInputElement>('[name="offset"]')?.focus()
  }, [invalidOffset, state.formElementRef])
  return (
    <Form ref={state.formElementRef} form={form} aria-label={copy.title} className="gap-0">
      {onPreviewChange && sourceBounds && (
        <form.Subscribe selector={(formState) => formState.values}>
          {(values) => (
            <SplitPreview
              values={values}
              variables={variables}
              units={state.displayUnits}
              copy={copy}
              mode={mode}
              featureId={featureId}
              referencePlane={referencePlane}
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
            disabled={disabled || pending || !sourceBounds}
            message={state.message ?? (!sourceBounds ? copy.unavailable : null)}
            actions={
              <TaskPanelFormActions
                acceptLabel={copy.submit}
                ariaLabel={copy.title}
                cancelLabel={copy.cancel}
                disabled={disabled || !sourceBounds || referencePlane === null}
                onCancel={onCancel}
                previewStatus={previewStatus}
              />
            }
          >
            <ReferencePlaneSelection
              options={referenceOptions}
              value={referencePlane}
              selectedFace={selectedFace}
              onChange={setReference}
            >
              <form.Field name="plane">
                {(field) => (
                  <fieldset className="grid gap-2">
                    <legend className="mb-2 text-xs font-medium">{copy.plane}</legend>
                    {(["XY", "XZ", "YZ"] as const).map((plane) => (
                      <label key={plane} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="plane"
                          value={plane}
                          checked={field.state.value === plane}
                          onBlur={field.handleBlur}
                          onChange={() => {
                            state.clearSubmissionErrors()
                            field.handleChange(plane)
                          }}
                        />
                        {plane}
                      </label>
                    ))}
                    <p className="text-xs text-muted-foreground">{copy.planeDescription}</p>
                  </fieldset>
                )}
              </form.Field>
            </ReferencePlaneSelection>
            <form.Field name="offset">
              {(field) => (
                <LengthExpressionField
                  id="split-offset"
                  name="offset"
                  value={field.state.value}
                  label={copy.offset}
                  description={copy.lengthDescription}
                  error={state.issues.offset}
                  suggestions={state.suggestions}
                  onBlur={field.handleBlur}
                  onValueChange={(value) => {
                    state.clearSubmissionErrors()
                    field.handleChange(value)
                  }}
                />
              )}
            </form.Field>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!sourceBounds || referencePlane !== undefined}
              onClick={() => {
                if (!sourceBounds) return
                state.clearSubmissionErrors()
                form.setFieldValue(
                  "offset",
                  splitMidpointExpression(
                    sourceBounds,
                    form.state.values.plane,
                    state.displayUnits,
                  ),
                )
              }}
            >
              {copy.midpoint}
            </Button>
          </ParameterPanel>
        )}
      </form.Subscribe>
    </Form>
  )
}
