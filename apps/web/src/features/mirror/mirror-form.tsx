import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import { readMirrorFeatureParametersV3 } from "@vibeshape/domain/part-design-mirror"
import type { ReferencePlane } from "@vibeshape/domain/reference-frame"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useEffect, useState } from "react"
import { BooleanParameterField } from "../part-design/boolean-parameter-field"
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
  type MirrorFormMode,
  type MirrorFormValues,
  mirrorFeatureRecord,
  mirrorFormValues,
  parseMirrorForm,
} from "./mirror-form-model"

export type MirrorFormCopy = ParameterPanelCopy &
  PrimitiveLengthCopy & {
    parameters: string
    plane: string
    offset: string
    offsetDescription: string
    preserveSource: string
    preserveSourceDescription: string
    validationSummary: string
    submit: string
    staleRevision: string
    saveFailed: string
  }
type MirrorFormProps = FeatureParameterFormProps<MirrorFormMode, MirrorFormCopy> & {
  referenceOptions?: ReferenceFrameOptions | undefined
  selectedFace?: ViewerSelection | null | undefined
} & {
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}
function MirrorPreview({
  values,
  variables,
  units,
  copy,
  mode,
  featureId,
  referencePlane,
  onPreviewChange,
}: {
  values: MirrorFormValues
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: MirrorFormCopy
  mode: MirrorFormMode
  featureId: FeatureId
  referencePlane: ReferencePlane | null | undefined
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  const parsed = parseMirrorForm(values, variables, units, copy)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview:
      parsed.ok && referencePlane !== null
        ? mirrorFeatureRecord(mode, featureId, parsed.plane, parsed, referencePlane)
        : null,
  })
  return null
}
export function MirrorForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewStatus,
  variables,
  referenceOptions,
  selectedFace,
}: MirrorFormProps) {
  const state = useParameterFormState(variables)
  const [startingFace] = useState(selectedFace)
  const [referencePlane, setReference] = useState<ReferencePlane | null | undefined>(() =>
    mode.kind === "edit" ? readMirrorFeatureParametersV3(mode.feature)?.plane : undefined,
  )
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues: mirrorFormValues(mode, state.displayUnits),
    onSubmit: async ({ value }) => {
      if (referencePlane === null) return
      const parsed = parseMirrorForm(value, variables, state.displayUnits, copy)
      if (!parsed.ok) {
        state.setIssues(parsed.issues)
        state.setMessage(copy.validationSummary)
        return
      }
      state.clearSubmissionErrors()
      try {
        await submitFeatureMutation({
          baseRevision,
          copy,
          feature: mirrorFeatureRecord(mode, featureId, parsed.plane, parsed, referencePlane),
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
      {onPreviewChange && (
        <form.Subscribe selector={(formState) => formState.values}>
          {(values) => (
            <MirrorPreview
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
            disabled={disabled || pending}
            message={state.message}
            actions={
              <TaskPanelFormActions
                acceptLabel={copy.submit}
                ariaLabel={copy.title}
                cancelLabel={copy.cancel}
                disabled={disabled || referencePlane === null}
                onCancel={onCancel}
                previewStatus={previewStatus}
              />
            }
          >
            <ReferencePlaneSelection
              options={referenceOptions}
              value={referencePlane}
              selectedFace={selectedFace ?? startingFace}
              onChange={(value) => {
                state.clearSubmissionErrors()
                setReference(value)
              }}
            >
              <form.Field name="plane">
                {(field) => (
                  <ChoiceField
                    name={field.name}
                    label={copy.plane}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onValueChange={(value) => {
                      state.clearSubmissionErrors()
                      field.handleChange(value as "XY" | "XZ" | "YZ")
                    }}
                    options={(["XY", "XZ", "YZ"] as const).map((plane) => ({
                      value: plane,
                      label: plane,
                    }))}
                  />
                )}
              </form.Field>
            </ReferencePlaneSelection>
            <form.Field name="offset">
              {(field) => (
                <LengthExpressionField
                  id="mirror-offset"
                  name="offset"
                  value={field.state.value}
                  label={copy.offset}
                  description={copy.offsetDescription}
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
            <form.Field name="preserveSource">
              {(field) => (
                <BooleanParameterField
                  id="mirror-preserve-source"
                  name="preserveSource"
                  label={copy.preserveSource}
                  description={copy.preserveSourceDescription}
                  checked={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    state.clearSubmissionErrors()
                    field.handleChange(event.target.checked)
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
