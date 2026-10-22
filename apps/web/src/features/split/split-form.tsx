import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import type { ReferencePlane } from "@vibeshape/domain/reference-frame"
import { Button } from "@vibeshape/ui/components/button"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { LengthExpressionField } from "../part-design/length-expression-field"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import type { FeatureParameterFormProps, PrimitiveLengthCopy } from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import type { ReferenceFrameOptions } from "../reference-geometry/reference-frame-options"
import { ReferencePlaneSelection } from "../reference-geometry/reference-support-fields"
import {
  parseSplitForm,
  type SplitBounds,
  type SplitFormMode,
  type SplitFormValues,
  splitFeatureRecord,
} from "./split-form-model"
import {
  type SplitManipulator,
  type SplitPlaneResolver,
  splitSupportPlane,
} from "./split-manipulator"
import { SplitManipulatorBinding } from "./split-manipulator-binding"
import { useSplitDraft } from "./use-split-draft"

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
  onManipulatorChange?: ((value: SplitManipulator | null) => void) | undefined
  resolvePlane?: SplitPlaneResolver | undefined
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
  resolvePlane,
}: {
  values: SplitFormValues
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: SplitFormCopy
  mode: SplitFormMode
  featureId: FeatureId
  referencePlane: ReferencePlane | null | undefined
  onPreviewChange: (feature: FeatureRecord | null) => void
  resolvePlane: SplitPlaneResolver | undefined
}) {
  const parsed = parseSplitForm(values, variables, units, copy)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview:
      parsed.ok &&
      referencePlane !== null &&
      splitSupportPlane(referencePlane, values.plane, resolvePlane)
        ? splitFeatureRecord(mode, featureId, parsed, referencePlane)
        : null,
  })
  return null
}
export function SplitForm(props: SplitFormProps) {
  const {
    copy,
    disabled = false,
    mode,
    referenceOptions,
    selectedFace,
    sourceBounds,
    onPreviewChange,
    onManipulatorChange,
    resolvePlane,
    previewStatus,
    variables,
  } = props
  const draft = useSplitDraft(props)
  const { form, state } = draft
  return (
    <Form
      ref={state.formElementRef}
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      {onManipulatorChange && (
        <form.Subscribe selector={(s) => [s.values, s.isSubmitting] as const}>
          {([values, pending]) => (
            <SplitManipulatorBinding
              values={values}
              variables={variables}
              units={state.displayUnits}
              copy={copy}
              featureId={draft.featureId}
              sourceBounds={sourceBounds}
              referencePlane={draft.referencePlane}
              resolvePlane={resolvePlane}
              disabled={disabled || pending || !draft.interactive}
              onManipulatorChange={onManipulatorChange}
              onOffsetChange={draft.changeOffset}
            />
          )}
        </form.Subscribe>
      )}
      {onPreviewChange && sourceBounds && (
        <form.Subscribe selector={(formState) => formState.values}>
          {(values) => (
            <SplitPreview
              values={values}
              variables={variables}
              units={state.displayUnits}
              copy={copy}
              mode={mode}
              featureId={draft.featureId}
              referencePlane={draft.referencePlane}
              resolvePlane={resolvePlane}
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
            message={
              state.message ??
              (!sourceBounds || !draft.referenceAvailable ? copy.unavailable : null)
            }
            actions={
              <TaskPanelFormActions
                acceptLabel={copy.submit}
                ariaLabel={copy.title}
                cancelLabel={copy.cancel}
                disabled={disabled || !sourceBounds || !draft.referenceAvailable}
                onCancel={draft.cancel}
                previewStatus={previewStatus}
              />
            }
          >
            <ReferencePlaneSelection
              options={referenceOptions}
              value={draft.referencePlane}
              selectedFace={selectedFace}
              onChange={draft.setReference}
            >
              <form.Field name="plane">
                {(field) => (
                  <ChoiceField
                    name={field.name}
                    label={copy.plane}
                    description={copy.planeDescription}
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
              disabled={!sourceBounds || draft.referencePlane !== undefined}
              onClick={draft.midpoint}
            >
              {copy.midpoint}
            </Button>
          </ParameterPanel>
        )}
      </form.Subscribe>
    </Form>
  )
}
