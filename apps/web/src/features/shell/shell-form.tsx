import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  type PrimitiveLengthCopy,
  submitFeatureOrReport,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import { BodyFaceChecklist, BodyFacePickingSync } from "./body-face-selection"
import {
  type ShellFormMode,
  type ShellFormValues,
  shellFormFeature,
  shellInitialSelection,
  shellInitialValues,
  shellTargetBody,
} from "./shell-form-model"
import type { ShellPickingContext, ShellPickRequest } from "./shell-picking"

export type ShellFormCopy = ParameterPanelCopy &
  PrimitiveLengthCopy & {
    parameters: string
    thickness: string
    lengthDescription: string
    direction: string
    directionDescription: string
    inward: string
    outward: string
    openings: string
    cavity: string
    openCavity: string
    closedCavity: string
    openingsDescription: string
    repair: string
    unavailable: string
    validationSummary: string
    submit: string
    staleRevision: string
    saveFailed: string
    previewFailed: string
    openingCount: (values: { selected: number; total: number }) => string
    faceName: (values: { number: number }) => string
    face: (values: { number: number; area: string; x: string; y: string; z: string }) => string
  }
type ShellFormProps = FeatureParameterFormProps<ShellFormMode, ShellFormCopy> & {
  evidence: ModelBodyTopologyEvidence | null
  allowSemanticRebinding?: boolean
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
  pickingRequest?: ShellPickRequest | null
  onPickingContextChange?: ((context: ShellPickingContext | null) => void) | undefined
}

function pickedShellOpenings(
  values: ShellFormValues,
  evidence: ModelBodyTopologyEvidence | null,
  request: ShellPickRequest,
): string[] | null {
  if (values.closed) return null
  if (!evidence?.candidates.some(({ candidateId }) => candidateId === request.candidateId))
    return null
  if (values.openingIds.includes(request.candidateId))
    return values.openingIds.filter((id) => id !== request.candidateId)
  return values.openingIds.length < 64 ? [...values.openingIds, request.candidateId] : null
}
function ShellPreview(props: {
  values: ShellFormValues
  mode: ShellFormMode
  featureId: FeatureId
  evidence: ModelBodyTopologyEvidence | null
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: ShellFormCopy
  allowSemanticRebinding: boolean
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
      props.allowSemanticRebinding,
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
  pickingRequest = null,
  onPickingContextChange,
  allowSemanticRebinding = true,
  variables,
}: ShellFormProps) {
  const state = useParameterFormState(variables)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const repair = shellInitialSelection(mode, evidence, allowSemanticRebinding).repair
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: shellInitialValues(mode, evidence, state.displayUnits, allowSemanticRebinding),
    validators: {
      onDynamic: ({ value }) => {
        const feature = shellFormFeature(
          mode,
          featureId,
          value,
          evidence,
          variables,
          state.displayUnits,
          copy,
          allowSemanticRebinding,
        )
        return feature ? undefined : copy.validationSummary
      },
    },
    onSubmit: async ({ value }) => {
      if (disabled || !isFeaturePreviewReady(previewStatus)) return
      const feature = shellFormFeature(
        mode,
        featureId,
        value,
        evidence,
        variables,
        state.displayUnits,
        copy,
        allowSemanticRebinding,
      )
      if (!feature) return
      await submitFeatureOrReport({
        baseRevision,
        copy,
        feature,
        onSave,
        onSaved,
        setMessage: state.setMessage,
        saveFailed: copy.saveFailed,
      })
    },
  })
  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
        <form.Subscribe selector={(formState) => formState.values}>
          {(values) => (
            <BodyFacePickingSync
              enabled={!values.closed}
              evidence={evidence}
              featureId={featureId}
              target={shellTargetBody(mode)}
              selectedIds={values.openingIds}
              request={pickingRequest}
              onContextChange={onPickingContextChange}
              pick={(request) => pickedShellOpenings(values, evidence, request)}
              onSelectionChange={(ids) => {
                state.clearSubmissionErrors()
                form.setFieldValue("openingIds", ids)
              }}
            />
          )}
        </form.Subscribe>
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
                allowSemanticRebinding={allowSemanticRebinding}
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
              message={state.message ?? (previewStatus === "error" ? copy.previewFailed : null)}
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
              <form.AppField name="thickness">
                {(field) => (
                  <field.LengthExpressionField
                    id="shell-thickness"
                    label={copy.thickness}
                    description={copy.lengthDescription}
                    suggestions={state.suggestions}
                    onValueChange={() => {
                      state.clearSubmissionErrors()
                    }}
                  />
                )}
              </form.AppField>
              <form.AppField name="direction">
                {(field) => (
                  <field.ChoiceField
                    className="[&>fieldset]:grid [&>fieldset]:grid-cols-1"
                    label={copy.direction}
                    description={copy.directionDescription}
                    onValueChange={() => {
                      state.clearSubmissionErrors()
                    }}
                    options={(["inward", "outward"] as const).map((direction) => ({
                      value: direction,
                      label: copy[direction],
                    }))}
                  />
                )}
              </form.AppField>
              <form.Field name="closed">
                {(field) => (
                  <ChoiceField
                    className="[&>fieldset]:grid [&>fieldset]:grid-cols-1"
                    name={field.name}
                    label={copy.cavity}
                    value={String(field.state.value)}
                    onBlur={field.handleBlur}
                    onValueChange={(value) => {
                      state.clearSubmissionErrors()
                      field.handleChange(value === "true")
                    }}
                    options={([false, true] as const).map((closed) => ({
                      value: String(closed),
                      label: closed ? copy.closedCavity : copy.openCavity,
                    }))}
                  />
                )}
              </form.Field>
              <form.Subscribe selector={(formState) => formState.values.closed}>
                {(closed) =>
                  closed ? null : (
                    <form.Field name="openingIds">
                      {(field) => (
                        <BodyFaceChecklist
                          copy={{
                            legend: copy.openings,
                            description: copy.openingsDescription,
                            count: copy.openingCount,
                            faceName: copy.faceName,
                            face: copy.face,
                          }}
                          name="openings"
                          evidence={evidence}
                          selectedIds={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(ids) => {
                            state.clearSubmissionErrors()
                            field.handleChange(ids)
                          }}
                        />
                      )}
                    </form.Field>
                  )
                }
              </form.Subscribe>
            </ParameterPanel>
          )}
        </form.Subscribe>
      </TaskPanelContentProvider>
    </Form>
  )
}
