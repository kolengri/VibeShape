import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { type RefObject, useEffect, useState } from "react"
import {
  defaultAngleExpression,
  defaultLengthExpression,
} from "../../document/document-display-units"
import { LengthExpressionField } from "../part-design/length-expression-field"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import { PlacementAlignmentFields } from "./placement-alignment-fields"
import type { PlacementAlignmentFaces } from "./placement-face-alignment"
import {
  type PlacementFormMode,
  type PlacementFormValues,
  type PlacementValidationCopy,
  parsePlacementForm,
  placementAxes,
  placementFeatureRecord,
  placementFieldName,
  placementFormValues,
} from "./placement-form-model"

export type PlacementFormCopy = ParameterPanelCopy &
  PlacementValidationCopy & {
    parameters: string
    translation: string
    rotation: string
    translationX: string
    translationY: string
    translationZ: string
    rotationX: string
    rotationY: string
    rotationZ: string
    lengthDescription: string
    angleDescription: string
    submit: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }

type PlacementFormProps = FeatureParameterFormProps<PlacementFormMode, PlacementFormCopy> & {
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
  alignmentFaces?: PlacementAlignmentFaces | undefined
  selectedFace?: ViewerSelection | null | undefined
}
function PlacementPreview({
  values,
  variables,
  units,
  copy,
  mode,
  featureId,
  onPreviewChange,
  previewEnabled,
}: {
  values: PlacementFormValues
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: PlacementFormCopy
  mode: PlacementFormMode
  featureId: FeatureId
  onPreviewChange: (feature: FeatureRecord | null) => void
  previewEnabled: boolean
}) {
  const parsed = parsePlacementForm(values, variables, units, copy)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: previewEnabled && parsed.ok ? placementFeatureRecord(mode, featureId, parsed) : null,
  })
  return null
}
function PlacementErrorFocus({
  pending,
  field,
  formRef,
}: {
  pending: boolean
  field: string | undefined
  formRef: RefObject<HTMLFormElement | null>
}) {
  useEffect(() => {
    if (!pending && field) formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus()
  }, [field, pending, formRef])
  return null
}

export function PlacementForm({
  baseRevision,
  alignmentFaces,
  copy,
  disabled = false,
  mode,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewStatus,
  selectedFace,
  variables,
}: PlacementFormProps) {
  const state = useParameterFormState(variables)
  const [previewEnabled, setPreviewEnabled] = useState(true)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues: placementFormValues(mode, state.displayUnits),
    onSubmit: async ({ value }) => {
      const parsed = parsePlacementForm(value, variables, state.displayUnits, copy)
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
          feature: placementFeatureRecord(mode, featureId, parsed),
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
            <PlacementPreview
              values={values}
              variables={variables}
              units={state.displayUnits}
              copy={copy}
              mode={mode}
              featureId={featureId}
              onPreviewChange={onPreviewChange}
              previewEnabled={previewEnabled}
            />
          )}
        </form.Subscribe>
      )}
      <form.Subscribe selector={(formState) => formState.isSubmitting}>
        {(pending) => (
          <>
            <PlacementErrorFocus
              pending={pending}
              field={Object.keys(state.issues)[0]}
              formRef={state.formElementRef}
            />
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
                  disabled={disabled}
                  onCancel={onCancel}
                  previewStatus={previewStatus}
                />
              }
            >
              {alignmentFaces && (
                <PlacementAlignmentFields
                  faces={alignmentFaces}
                  selectedFace={selectedFace}
                  units={state.displayUnits}
                  variables={variables}
                  copy={copy}
                  onPickFaces={() => setPreviewEnabled(false)}
                  previewPaused={!previewEnabled}
                  onAlign={({ translation, rotation }) => {
                    setPreviewEnabled(true)
                    state.clearSubmissionErrors()
                    for (const [index, axis] of placementAxes.entries()) {
                      form.setFieldValue(
                        placementFieldName("translation", axis),
                        defaultLengthExpression(
                          translation[index] as number,
                          state.displayUnits.length,
                        ),
                      )
                      form.setFieldValue(
                        placementFieldName("rotation", axis),
                        defaultAngleExpression(rotation[index] as number, state.displayUnits.angle),
                      )
                    }
                  }}
                />
              )}
              {(["translation", "rotation"] as const).map((group) => (
                <fieldset className="grid gap-3" key={group}>
                  <legend className="mb-2 text-xs font-medium text-muted-foreground">
                    {copy[group]}
                  </legend>
                  {placementAxes.map((axis) => {
                    const name = placementFieldName(group, axis)
                    return (
                      <form.Field key={name} name={name}>
                        {(field) => (
                          <LengthExpressionField
                            id={`placement-${name}`}
                            name={name}
                            value={field.state.value}
                            label={copy[name]}
                            description={
                              group === "translation"
                                ? copy.lengthDescription
                                : copy.angleDescription
                            }
                            error={state.issues[name]}
                            suggestions={state.suggestions}
                            onBlur={field.handleBlur}
                            onValueChange={(value) => {
                              setPreviewEnabled(true)
                              state.clearSubmissionErrors()
                              field.handleChange(value)
                            }}
                          />
                        )}
                      </form.Field>
                    )
                  })}
                </fieldset>
              ))}
            </ParameterPanel>
          </>
        )}
      </form.Subscribe>
    </Form>
  )
}
