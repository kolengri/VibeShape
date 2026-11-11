import type { FeatureRecord } from "@vibeshape/domain"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"
import { thickenOperations, thickenSides } from "@vibeshape/domain/part-design-thicken"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
import {
  PreviewedParameterPanel,
  type PreviewedParameterPanelCopy,
} from "../part-design/previewed-parameter-panel"
import {
  type FeatureParameterFormProps,
  type PrimitiveLengthCopy,
  submitFeatureOrReport,
} from "../part-design/primitive-form"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import { BodyFaceFormSync, BodyFaceStatusNotes } from "../shell/body-face-form-sync"
import { BodyFaceChecklist, type BodyFaceChecklistCopy } from "../shell/body-face-selection"
import type { ShellPickingContext, ShellPickRequest } from "../shell/shell-picking"
import {
  type ThickenFormMode,
  type ThickenFormValues,
  thickenFormFeature,
  thickenFormIssues,
  thickenInitialSelection,
  thickenInitialValues,
  thickenTargetBody,
  toggleThickenFace,
} from "./thicken-form-model"

export type ThickenFormCopy = PreviewedParameterPanelCopy &
  PrimitiveLengthCopy & {
    faces: BodyFaceChecklistCopy
    thickness: string
    thicknessDescription: string
    side: string
    sideDescription: string
    sides: Readonly<Record<(typeof thickenSides)[number], string>>
    operation: string
    operationDescription: string
    operations: Readonly<Record<(typeof thickenOperations)[number], string>>
    repair: string
    unavailable: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }
type ThickenFormProps = FeatureParameterFormProps<ThickenFormMode, ThickenFormCopy> & {
  evidence: ModelBodyTopologyEvidence | null
  allowSemanticRebinding?: boolean
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
  /** Exact worker reason for a failed preview, shown instead of the generic advice. */
  previewDiagnostic?: string | undefined
  pickingRequest?: ShellPickRequest | null
  onPickingContextChange?: ((context: ShellPickingContext | null) => void) | undefined
}

/** Owns the Thicken task state: stable feature identity and the validated, single-flight form. */
function useThickenForm(props: ThickenFormProps) {
  const { copy, evidence, mode, variables } = props
  const allowSemanticRebinding = props.allowSemanticRebinding ?? true
  const state = useParameterFormState(variables)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const feature = (values: ThickenFormValues) =>
    thickenFormFeature({
      mode,
      featureId,
      values,
      evidence,
      variables,
      units: state.displayUnits,
      copy,
      allowSemanticRebinding,
    })
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: thickenInitialValues(mode, evidence, state.displayUnits, allowSemanticRebinding),
    validators: {
      onDynamic: ({ value }) =>
        thickenFormIssues(value.thickness, feature(value), variables, state.displayUnits, copy),
    },
    onSubmit: async ({ value }) => {
      const record = feature(value)
      if (props.disabled || !isFeaturePreviewReady(props.previewStatus) || !record) return
      await submitFeatureOrReport({
        baseRevision: props.baseRevision,
        copy,
        feature: record,
        onSave: props.onSave,
        onSaved: props.onSaved,
        setMessage: state.setMessage,
        saveFailed: copy.saveFailed,
      })
    },
  })
  return {
    state,
    form,
    feature,
    featureId,
    repair: thickenInitialSelection(mode, evidence, allowSemanticRebinding).repair,
  }
}

export function ThickenForm(props: ThickenFormProps) {
  const {
    copy,
    disabled = false,
    evidence,
    mode,
    onCancel,
    onPreviewChange,
    previewStatus,
    previewDiagnostic,
    pickingRequest = null,
    onPickingContextChange,
  } = props
  const { state, form, feature, featureId, repair } = useThickenForm(props)
  const selectFaces = (ids: string[]) => {
    state.clearSubmissionErrors()
    form.setFieldValue("faceIds", ids)
  }
  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
        <form.Subscribe selector={(formState) => formState.values}>
          {(values) => (
            <BodyFaceFormSync
              evidence={evidence}
              featureId={featureId}
              target={thickenTargetBody(mode)}
              faceIds={values.faceIds}
              preview={feature(values)}
              request={pickingRequest}
              toggle={(candidateId) => toggleThickenFace(values.faceIds, candidateId, evidence)}
              onContextChange={onPickingContextChange}
              onPreviewChange={onPreviewChange}
              onSelectionChange={selectFaces}
            />
          )}
        </form.Subscribe>
        <form.Subscribe selector={(formState) => formState.isSubmitting}>
          {(pending) => (
            <PreviewedParameterPanel
              copy={copy}
              previewStatus={previewStatus}
              disabled={disabled}
              pending={pending}
              acceptDisabled={!evidence}
              message={state.message}
              previewDiagnostic={previewDiagnostic}
              onCancel={onCancel}
            >
              <BodyFaceStatusNotes copy={copy} repair={repair} available={evidence !== null} />
              <form.Field name="faceIds">
                {(field) => (
                  <BodyFaceChecklist
                    copy={copy.faces}
                    name="thicken-faces"
                    evidence={evidence}
                    selectedIds={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={selectFaces}
                  />
                )}
              </form.Field>
              <form.AppField name="thickness">
                {(field) => (
                  <field.LengthExpressionField
                    id="thicken-thickness"
                    label={copy.thickness}
                    description={copy.thicknessDescription}
                    suggestions={state.suggestions}
                    onValueChange={state.clearSubmissionErrors}
                  />
                )}
              </form.AppField>
              <form.AppField name="side">
                {(field) => (
                  <field.ChoiceField
                    className="[&>fieldset]:grid [&>fieldset]:grid-cols-1"
                    label={copy.side}
                    description={copy.sideDescription}
                    onValueChange={state.clearSubmissionErrors}
                    options={thickenSides.map((side) => ({ value: side, label: copy.sides[side] }))}
                  />
                )}
              </form.AppField>
              <form.AppField name="operation">
                {(field) => (
                  <field.ChoiceField
                    className="[&>fieldset]:grid [&>fieldset]:grid-cols-1"
                    label={copy.operation}
                    description={copy.operationDescription}
                    onValueChange={state.clearSubmissionErrors}
                    options={thickenOperations.map((operation) => ({
                      value: operation,
                      label: copy.operations[operation],
                    }))}
                  />
                )}
              </form.AppField>
            </PreviewedParameterPanel>
          )}
        </form.Subscribe>
      </TaskPanelContentProvider>
    </Form>
  )
}
