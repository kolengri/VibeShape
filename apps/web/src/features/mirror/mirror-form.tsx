import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import { readMirrorFeatureParametersV3 } from "@vibeshape/domain/part-design-mirror"
import type { ReferencePlane } from "@vibeshape/domain/reference-frame"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
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
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: mirrorFormValues(mode, state.displayUnits),
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parseMirrorForm(value, variables, state.displayUnits, copy)
        return parsed.ok ? undefined : { form: copy.validationSummary, fields: parsed.issues }
      },
    },
    onSubmit: async ({ value }) => {
      if (disabled || !isFeaturePreviewReady(previewStatus)) return
      if (referencePlane === null) return
      const parsed = parseMirrorForm(value, variables, state.displayUnits, copy)
      if (!parsed.ok) return
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
  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
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
              previewStatus={previewStatus}
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
                <form.AppField name="plane">
                  {(field) => (
                    <field.ChoiceField
                      label={copy.plane}
                      onValueChange={() => {
                        state.clearSubmissionErrors()
                      }}
                      options={(["XY", "XZ", "YZ"] as const).map((plane) => ({
                        value: plane,
                        label: plane,
                      }))}
                    />
                  )}
                </form.AppField>
              </ReferencePlaneSelection>
              <form.AppField name="offset">
                {(field) => (
                  <field.LengthExpressionField
                    id="mirror-offset"
                    label={copy.offset}
                    description={copy.offsetDescription}
                    suggestions={state.suggestions}
                    onValueChange={() => {
                      state.clearSubmissionErrors()
                    }}
                  />
                )}
              </form.AppField>
              <form.AppField name="preserveSource">
                {(field) => (
                  <field.CheckboxField
                    id="mirror-preserve-source"
                    label={copy.preserveSource}
                    description={copy.preserveSourceDescription}
                    onValueChange={() => {
                      state.clearSubmissionErrors()
                    }}
                  />
                )}
              </form.AppField>
            </ParameterPanel>
          )}
        </form.Subscribe>
      </TaskPanelContentProvider>
    </Form>
  )
}
