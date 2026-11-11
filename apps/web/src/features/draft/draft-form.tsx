import type { FeatureId, FeatureRecord } from "@vibeshape/domain"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"
import type { ReferencePlane } from "@vibeshape/domain/reference-frame"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
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
  submitFeatureOrReport,
} from "../part-design/primitive-form"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { ReferenceFrameOptions } from "../reference-geometry/reference-frame-options"
import { ReferencePlaneSelection } from "../reference-geometry/reference-support-fields"
import {
  BodyFaceChecklist,
  type BodyFaceChecklistCopy,
  BodyFacePickingSync,
} from "../shell/body-face-selection"
import type { ShellPickingContext, ShellPickRequest } from "../shell/shell-picking"
import {
  type DraftFormMode,
  type DraftFormValues,
  type DraftValidationCopy,
  draftFormFeature,
  draftFormIssues,
  draftInitialNeutralPlane,
  draftInitialSelection,
  draftInitialValues,
  draftTargetBody,
  toggleDraftFace,
} from "./draft-form-model"

export type DraftFormCopy = PreviewedParameterPanelCopy &
  DraftValidationCopy & {
    faces: BodyFaceChecklistCopy
    angle: string
    angleDescription: string
    flip: string
    flipDescription: string
    repair: string
    unavailable: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }
type DraftFormProps = FeatureParameterFormProps<DraftFormMode, DraftFormCopy> & {
  evidence: ModelBodyTopologyEvidence | null
  referenceOptions?: ReferenceFrameOptions | undefined
  selectedFace?: ViewerSelection | null | undefined
  allowSemanticRebinding?: boolean
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
  pickingRequest?: ShellPickRequest | null
  onPickingContextChange?: ((context: ShellPickingContext | null) => void) | undefined
}

function DraftStatusNotes({
  copy,
  repair,
  available,
}: Readonly<{ copy: DraftFormCopy; repair: boolean; available: boolean }>) {
  const note = available ? (repair ? copy.repair : null) : copy.unavailable
  return note ? (
    <p role="status" className="text-sm text-muted-foreground">
      {note}
    </p>
  ) : null
}

function DraftPreview(props: {
  feature: FeatureRecord | null
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({ onPreviewChange: props.onPreviewChange, preview: props.feature })
  return null
}

/** Keeps viewport face picking and the disposable exact preview in step with the form values. */
function DraftSync(
  props: Readonly<{
    evidence: ModelBodyTopologyEvidence | null
    featureId: FeatureId
    mode: DraftFormMode
    faceIds: string[]
    preview: FeatureRecord | null
    request: ShellPickRequest | null
    onContextChange: DraftFormProps["onPickingContextChange"]
    onPreviewChange: DraftFormProps["onPreviewChange"]
    onSelectionChange: (ids: string[]) => void
  }>,
) {
  return (
    <>
      <BodyFacePickingSync
        enabled
        evidence={props.evidence}
        featureId={props.featureId}
        target={draftTargetBody(props.mode)}
        selectedIds={props.faceIds}
        request={props.request}
        onContextChange={props.onContextChange}
        pick={(request) => toggleDraftFace(props.faceIds, request.candidateId, props.evidence)}
        onSelectionChange={props.onSelectionChange}
      />
      {props.onPreviewChange && (
        <DraftPreview feature={props.preview} onPreviewChange={props.onPreviewChange} />
      )}
    </>
  )
}

/** Owns the Draft task state: stable feature identity, neutral plane and the validated form. */
function useDraftForm(props: DraftFormProps) {
  const { copy, evidence, mode, variables } = props
  const allowSemanticRebinding = props.allowSemanticRebinding ?? true
  const state = useParameterFormState(variables)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const [neutralPlane, setNeutralPlane] = useState<ReferencePlane | null>(() =>
    draftInitialNeutralPlane(mode),
  )
  const feature = (values: DraftFormValues) =>
    draftFormFeature({
      mode,
      featureId,
      values,
      neutralPlane,
      evidence,
      variables,
      units: state.displayUnits,
      copy,
      allowSemanticRebinding,
    })
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: draftInitialValues(mode, evidence, state.displayUnits, allowSemanticRebinding),
    validators: {
      onDynamic: ({ value }) =>
        draftFormIssues(value.angle, feature(value), variables, state.displayUnits, copy),
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
    neutralPlane,
    setNeutralPlane,
    repair: draftInitialSelection(mode, evidence, allowSemanticRebinding).repair,
  }
}

export function DraftForm(props: DraftFormProps) {
  const {
    copy,
    disabled = false,
    evidence,
    mode,
    onCancel,
    onPreviewChange,
    previewStatus,
    pickingRequest = null,
    onPickingContextChange,
    referenceOptions,
    selectedFace,
  } = props
  const { state, form, feature, featureId, neutralPlane, setNeutralPlane, repair } =
    useDraftForm(props)
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
            <DraftSync
              evidence={evidence}
              featureId={featureId}
              mode={mode}
              faceIds={values.faceIds}
              preview={feature(values)}
              request={pickingRequest}
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
              acceptDisabled={!evidence || neutralPlane === null}
              message={state.message}
              onCancel={onCancel}
            >
              <DraftStatusNotes copy={copy} repair={repair} available={evidence !== null} />
              <form.Field name="faceIds">
                {(field) => (
                  <BodyFaceChecklist
                    copy={copy.faces}
                    name="draft-faces"
                    evidence={evidence}
                    selectedIds={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={selectFaces}
                  />
                )}
              </form.Field>
              <ReferencePlaneSelection
                options={referenceOptions}
                value={neutralPlane}
                selectedFace={selectedFace}
                onChange={(value) => {
                  state.clearSubmissionErrors()
                  setNeutralPlane(value)
                }}
              >
                {null}
              </ReferencePlaneSelection>
              <form.AppField name="angle">
                {(field) => (
                  <field.LengthExpressionField
                    id="draft-angle"
                    label={copy.angle}
                    description={copy.angleDescription}
                    suggestions={state.suggestions}
                    onValueChange={state.clearSubmissionErrors}
                  />
                )}
              </form.AppField>
              <form.AppField name="flip">
                {(field) => (
                  <field.CheckboxField
                    id="draft-flip"
                    label={copy.flip}
                    description={copy.flipDescription}
                    onValueChange={state.clearSubmissionErrors}
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
