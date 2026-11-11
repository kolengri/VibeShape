import type { FeatureRecord } from "@vibeshape/domain"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import { exactBodyPickCandidates } from "../part-design/body-reference-picking"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import type { ExactBodyOption } from "../part-design/exact-body-options"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
import { LengthExpressionField } from "../part-design/length-expression-field"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { ReferencePickField } from "../part-design/reference-pick-field"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { ReferenceFrameOptions } from "../reference-geometry/reference-frame-options"
import {
  type CoilFormMode,
  type CoilFormValues,
  type CoilValidationCopy,
  coilFeatureRecord,
  coilFormValues,
  parseCoilForm,
} from "./coil-form-model"
import { HelixFields, type HelixFieldsCopy } from "./helix-fields"

export type CoilFormCopy = ParameterPanelCopy &
  CoilValidationCopy &
  HelixFieldsCopy &
  Readonly<{
    submit: string
    parameters: string
    section: string
    circular: string
    rectangular: string
    diameter: string
    sectionWidth: string
    sectionHeight: string
    sectionDescription: string
    operation: string
    operationNew: string
    operationAdd: string
    operationRemove: string
    operationIntersect: string
    target: string
    targetDescription: string
    previewFailed: string
    staleRevision: string
    saveFailed: string
  }>
type Props = FeatureParameterFormProps<CoilFormMode, CoilFormCopy> & {
  targets: readonly ExactBodyOption[]
  axisOptions?: ReferenceFrameOptions | undefined
  previewDiagnostic?: string | undefined
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}

function CoilPreview({
  feature,
  onPreviewChange,
}: {
  feature: FeatureRecord | null
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({ preview: feature, onPreviewChange })
  return null
}

const operations = ["new", "add", "remove", "intersect"] as const
const operationLabels = {
  new: "operationNew",
  add: "operationAdd",
  remove: "operationRemove",
  intersect: "operationIntersect",
} as const

export function CoilForm({
  axisOptions,
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewDiagnostic,
  previewStatus,
  targets,
  variables,
}: Props) {
  const state = useParameterFormState(variables)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const parse = (values: CoilFormValues) =>
    parseCoilForm(values, targets, variables, state.displayUnits, copy)
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: coilFormValues(mode, state.displayUnits, targets),
    validators: {
      onDynamic: ({ value }) => (parse(value).ok ? undefined : copy.validationSummary),
    },
    onSubmit: async ({ value }) => {
      if (disabled || !isFeaturePreviewReady(previewStatus)) return
      const parsed = parse(value)
      if (!parsed.ok) return
      state.clearSubmissionErrors()
      await submitFeatureMutation({
        baseRevision,
        copy,
        feature: coilFeatureRecord(mode, featureId, parsed.parameters),
        onSave,
        onSaved,
        setMessage: state.setMessage,
      }).catch(() => state.setMessage(copy.saveFailed))
    },
  })
  const update = (changes: Partial<CoilFormValues>) => {
    state.clearSubmissionErrors()
    for (const [key, value] of Object.entries(changes))
      form.setFieldValue(key as keyof CoilFormValues, value as never)
  }
  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
        <form.Subscribe
          selector={(formState) => [formState.values, formState.isSubmitting] as const}
        >
          {([values, pending]) => {
            const parsed = parse(values)
            const issues = parsed.ok ? {} : parsed.issues
            const locked = disabled || pending
            const message =
              state.message ??
              (previewStatus === "error" ? (previewDiagnostic ?? copy.previewFailed) : null)
            const sizeField = (field: "diameter" | "sectionWidth" | "sectionHeight") => (
              <LengthExpressionField
                key={field}
                id={`coil-${field}`}
                label={copy[field]}
                description={copy.sectionDescription}
                error={issues[field]}
                suggestions={state.suggestions}
                disabled={locked}
                value={values[field]}
                onValueChange={(value) => update({ [field]: value })}
              />
            )
            return (
              <>
                {onPreviewChange && (
                  <CoilPreview
                    feature={
                      parsed.ok ? coilFeatureRecord(mode, featureId, parsed.parameters) : null
                    }
                    onPreviewChange={onPreviewChange}
                  />
                )}
                <ParameterPanel
                  previewStatus={previewStatus}
                  copy={copy}
                  legend={copy.parameters}
                  disabled={locked}
                  message={message}
                  actions={
                    <TaskPanelFormActions
                      acceptLabel={copy.submit}
                      ariaLabel={copy.title}
                      cancelLabel={copy.cancel}
                      disabled={disabled || !parsed.ok}
                      onCancel={onCancel}
                      previewStatus={previewStatus}
                    />
                  }
                >
                  <ChoiceField
                    id="coil-operation"
                    label={copy.operation}
                    value={values.operation}
                    disabled={locked}
                    onValueChange={(value) => {
                      const operation = operations.find((candidate) => candidate === value)
                      if (operation) update({ operation })
                    }}
                    options={operations.map((operation) => ({
                      value: operation,
                      label: copy[operationLabels[operation]],
                    }))}
                  />
                  {values.operation !== "new" && (
                    <ReferencePickField
                      id="coil-target-body"
                      label={copy.target}
                      placeholder={copy.missingTarget}
                      value={values.targetId}
                      options={targets.map(({ id, label }) => ({ value: id, label }))}
                      candidates={exactBodyPickCandidates(targets)}
                      description={copy.targetDescription}
                      error={issues.targetId}
                      disabled={locked}
                      required
                      onValueChange={(targetId) => update({ targetId })}
                    />
                  )}
                  <HelixFields
                    idPrefix="coil"
                    values={values}
                    issues={issues}
                    copy={copy}
                    axisOptions={axisOptions}
                    suggestions={state.suggestions}
                    disabled={locked}
                    onChange={update}
                  />
                  <ChoiceField
                    id="coil-section"
                    label={copy.section}
                    value={values.sectionKind}
                    disabled={locked}
                    onValueChange={(value) =>
                      update({ sectionKind: value === "rectangular" ? "rectangular" : "circular" })
                    }
                    options={[
                      { value: "circular", label: copy.circular },
                      { value: "rectangular", label: copy.rectangular },
                    ]}
                  />
                  {values.sectionKind === "circular"
                    ? sizeField("diameter")
                    : [sizeField("sectionWidth"), sizeField("sectionHeight")]}
                </ParameterPanel>
              </>
            )
          }}
        </form.Subscribe>
      </TaskPanelContentProvider>
    </Form>
  )
}
