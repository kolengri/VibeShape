import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import { Button } from "@vibeshape/ui/components/button"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import { featureEditPreview } from "../part-design/feature-edit-preview"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import type { FeatureParameterFormProps } from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
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
import type { PlacementManipulator, PlacementSourceBounds } from "./placement-manipulator"
import { PlacementManipulatorBinding } from "./placement-manipulator-binding"
import { usePlacementDraft } from "./use-placement-draft"

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
    unavailable: string
  }

type PlacementFormProps = FeatureParameterFormProps<PlacementFormMode, PlacementFormCopy> & {
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
  alignmentFaces?: PlacementAlignmentFaces | undefined
  selectedFace?: ViewerSelection | null | undefined
  sourceBounds?: PlacementSourceBounds | null | undefined
  onManipulatorChange?: ((value: PlacementManipulator | null) => void) | undefined
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
    retainValidPreview: true,
    preview: featureEditPreview(
      mode,
      values,
      placementFormValues(mode, units),
      previewEnabled && parsed.ok ? placementFeatureRecord(mode, featureId, parsed) : null,
    ),
  })
  return null
}
export function PlacementForm(props: PlacementFormProps) {
  const {
    alignmentFaces,
    copy,
    disabled = false,
    mode,
    onPreviewChange,
    previewStatus,
    selectedFace,
    sourceBounds,
    onManipulatorChange,
    variables,
  } = props
  const draft = usePlacementDraft(props)
  const { form, state } = draft
  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
        {onManipulatorChange && (
          <form.Subscribe selector={(s) => [s.values, s.isSubmitting] as const}>
            {([values, pending]) => (
              <PlacementManipulatorBinding
                values={values}
                variables={variables}
                units={state.displayUnits}
                copy={copy}
                featureId={draft.featureId}
                sourceBounds={sourceBounds}
                axis={draft.manipulationAxis}
                disabled={disabled || pending || !draft.previewEnabled || !draft.interactive}
                onManipulatorChange={onManipulatorChange}
                onTranslationChange={draft.changeTranslation}
                onRotationChange={draft.changeRotation}
              />
            )}
          </form.Subscribe>
        )}
        {onPreviewChange && (
          <form.Subscribe selector={(formState) => formState.values}>
            {(values) => (
              <PlacementPreview
                values={values}
                variables={variables}
                units={state.displayUnits}
                copy={copy}
                mode={mode}
                featureId={draft.featureId}
                onPreviewChange={onPreviewChange}
                previewEnabled={draft.previewEnabled}
              />
            )}
          </form.Subscribe>
        )}
        <form.Subscribe selector={(formState) => formState.isSubmitting}>
          {(pending) => (
            <>
              <ParameterPanel
                copy={copy}
                legend={copy.parameters}
                disabled={disabled || pending || sourceBounds === null}
                message={state.message ?? (sourceBounds === null ? copy.unavailable : null)}
                actions={
                  <TaskPanelFormActions
                    acceptLabel={copy.submit}
                    ariaLabel={copy.title}
                    cancelLabel={copy.cancel}
                    disabled={disabled || sourceBounds === null}
                    onCancel={draft.cancel}
                    previewStatus={previewStatus}
                  />
                }
              >
                {onManipulatorChange && sourceBounds && (
                  <fieldset className="flex min-w-0 flex-wrap gap-1" aria-label={copy.parameters}>
                    {(["translation", ...placementAxes] as const).map((axis) => (
                      <Button
                        key={axis}
                        type="button"
                        size="xs"
                        variant="outline"
                        aria-pressed={draft.manipulationAxis === axis}
                        onClick={() => draft.selectAxis(axis)}
                      >
                        {axis === "translation"
                          ? copy.translation
                          : copy[placementFieldName("rotation", axis)]}
                      </Button>
                    ))}
                  </fieldset>
                )}
                {alignmentFaces && (
                  <PlacementAlignmentFields
                    faces={alignmentFaces}
                    selectedFace={selectedFace}
                    units={state.displayUnits}
                    variables={variables}
                    copy={copy}
                    onPickFaces={draft.pickFaces}
                    previewPaused={!draft.previewEnabled}
                    onAlign={draft.align}
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
                        <form.AppField key={name} name={name}>
                          {(field) => (
                            <field.LengthExpressionField
                              id={`placement-${name}`}
                              label={copy[name]}
                              description={
                                group === "translation"
                                  ? copy.lengthDescription
                                  : copy.angleDescription
                              }
                              suggestions={state.suggestions}
                              onValueChange={() => {
                                draft.beforeEdit()
                              }}
                            />
                          )}
                        </form.AppField>
                      )
                    })}
                  </fieldset>
                ))}
              </ParameterPanel>
            </>
          )}
        </form.Subscribe>
      </TaskPanelContentProvider>
    </Form>
  )
}
