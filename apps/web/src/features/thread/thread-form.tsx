import type { FeatureRecord } from "@vibeshape/domain"
import { metricThreadPresets } from "@vibeshape/domain/part-design-thread"
import { referenceAxisSchema } from "@vibeshape/domain/reference-frame"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { LocalizedSearchableSelectField } from "../../components/localized-searchable-select-field"
import { LengthExpressionField } from "../part-design/length-expression-field"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import type { ReferenceFrameOptions } from "../reference-geometry/reference-frame-options"
import { ReferenceAxisSelection } from "../reference-geometry/reference-support-fields"
import {
  parseThreadForm,
  type ThreadFormMode,
  type ThreadValidationCopy,
  threadAdvancedFields,
  threadCoreFields,
  threadFeatureRecord,
  threadFormValues,
} from "./thread-form-model"

export type ThreadFormCopy = ParameterPanelCopy &
  ThreadValidationCopy & {
    parameters: string
    metricSize: string
    customSize: string
    metricSizeDescription: string
    advanced: string
    kind: string
    external: string
    internal: string
    axis: string
    handedness: string
    right: string
    left: string
    nominalDiameter: string
    pitch: string
    length: string
    depth: string
    clearance: string
    originX: string
    originY: string
    originZ: string
    starts: string
    phase: string
    runIn: string
    runOut: string
    dimensionDescription: string
    pitchDescription: string
    clearanceDescription: string
    originDescription: string
    startsDescription: string
    phaseDescription: string
    allowanceDescription: string
    previewFailed: string
    unavailable: string
    submit: string
    staleRevision: string
    saveFailed: string
  }
type Props = FeatureParameterFormProps<ThreadFormMode, ThreadFormCopy> & {
  sourceAvailable: boolean
  axisOptions?: ReferenceFrameOptions | undefined
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}
function ThreadPreview({
  feature,
  onPreviewChange,
}: {
  feature: FeatureRecord | null
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({ preview: feature, onPreviewChange })
  return null
}
function panelMessage(
  message: string | null,
  sourceAvailable: boolean,
  status: FeaturePreviewState["status"] | undefined,
  copy: ThreadFormCopy,
) {
  if (message) return message
  if (!sourceAvailable) return copy.unavailable
  return status === "error" ? copy.previewFailed : null
}
function controlsDisabled(disabled: boolean, sourceAvailable: boolean, valid = true) {
  return disabled || !sourceAvailable || !valid
}
function visibleIssues(
  parsed: ReturnType<typeof parseThreadForm>,
  issues: Readonly<Record<string, string | undefined>>,
) {
  return parsed.ok ? issues : { ...issues, ...parsed.issues }
}
const descriptionKeys = {
  nominalDiameter: "dimensionDescription",
  pitch: "pitchDescription",
  length: "dimensionDescription",
  depth: "dimensionDescription",
  clearance: "clearanceDescription",
  originX: "originDescription",
  originY: "originDescription",
  originZ: "originDescription",
  starts: "startsDescription",
  phase: "phaseDescription",
  runIn: "allowanceDescription",
  runOut: "allowanceDescription",
} as const
export function ThreadForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  sourceAvailable,
  axisOptions,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewStatus,
  variables,
}: Props) {
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [metricSize, setMetricSize] = useState("custom")
  const state = useParameterFormState(variables)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues: threadFormValues(mode, state.displayUnits),
    onSubmit: async ({ value }) => {
      const parsed = parseThreadForm(value, mode, variables, state.displayUnits, copy)
      if (!parsed.ok) {
        state.setIssues(parsed.issues)
        state.setMessage(copy.validationSummary)
        return
      }
      state.clearSubmissionErrors()
      await submitFeatureMutation({
        baseRevision,
        copy,
        feature: threadFeatureRecord(mode, featureId, parsed),
        onSave,
        onSaved,
        setMessage: state.setMessage,
      }).catch(() => state.setMessage(copy.saveFailed))
    },
  })
  return (
    <Form ref={state.formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <form.Subscribe selector={(formState) => [formState.values, formState.isSubmitting] as const}>
        {([values, pending]) => {
          const parsed = parseThreadForm(values, mode, variables, state.displayUnits, copy)
          const issues = visibleIssues(parsed, state.issues)
          const advancedInvalid = threadAdvancedFields.some((field) => Boolean(issues[field]))
          const expressionField = (
            name: (typeof threadCoreFields)[number] | (typeof threadAdvancedFields)[number],
          ) => (
            <form.Field name={name} key={name}>
              {(field) => (
                <LengthExpressionField
                  id={`thread-${name}`}
                  name={name}
                  value={field.state.value}
                  label={copy[name]}
                  description={copy[descriptionKeys[name]]}
                  error={issues[name]}
                  suggestions={state.suggestions}
                  onBlur={field.handleBlur}
                  onValueChange={(value) => {
                    state.clearSubmissionErrors()
                    if (name === "nominalDiameter" || name === "pitch") setMetricSize("custom")
                    field.handleChange(value)
                  }}
                />
              )}
            </form.Field>
          )
          return (
            <>
              {onPreviewChange && sourceAvailable && (
                <ThreadPreview
                  feature={parsed.ok ? threadFeatureRecord(mode, featureId, parsed) : null}
                  onPreviewChange={onPreviewChange}
                />
              )}
              <ParameterPanel
                copy={copy}
                legend={copy.parameters}
                disabled={controlsDisabled(disabled, sourceAvailable, !pending)}
                message={panelMessage(state.message, sourceAvailable, previewStatus, copy)}
                actions={
                  <TaskPanelFormActions
                    acceptLabel={copy.submit}
                    ariaLabel={copy.title}
                    cancelLabel={copy.cancel}
                    disabled={controlsDisabled(disabled, sourceAvailable, parsed.ok)}
                    onCancel={onCancel}
                    previewStatus={previewStatus}
                  />
                }
              >
                <LocalizedSearchableSelectField
                  label={copy.metricSize}
                  description={copy.metricSizeDescription}
                  placeholder={copy.metricSize}
                  value={metricSize}
                  onValueChange={(value) => {
                    setMetricSize(value)
                    const preset = metricThreadPresets.find(({ id }) => id === value)
                    if (!preset) return
                    state.clearSubmissionErrors()
                    form.setFieldValue("nominalDiameter", `${preset.nominalDiameter} mm`)
                    form.setFieldValue("pitch", `${preset.pitch} mm`)
                  }}
                  options={[
                    { value: "custom", label: copy.customSize },
                    ...metricThreadPresets.map(({ id, pitch }) => ({
                      value: id,
                      label: `${id} × ${pitch}`,
                    })),
                  ]}
                />
                <form.Field name="kind">
                  {(field) => (
                    <ChoiceField
                      name={field.name}
                      label={copy.kind}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(value) => {
                        state.clearSubmissionErrors()
                        field.handleChange(value === "external" ? "external" : "internal")
                      }}
                      options={(["external", "internal"] as const).map((kind) => ({
                        value: kind,
                        label: copy[kind],
                      }))}
                    />
                  )}
                </form.Field>
                {threadCoreFields.map(expressionField)}
                <details
                  className="grid gap-2"
                  open={advancedExpanded || advancedInvalid}
                  onToggle={(event) => setAdvancedExpanded(event.currentTarget.open)}
                >
                  <summary className="cursor-pointer py-1 text-xs font-medium">
                    {copy.advanced}
                  </summary>
                  <div className="grid gap-2 pt-1">
                    <form.Field name="axis">
                      {(field) => (
                        <ChoiceField
                          name={field.name}
                          label={copy.axis}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onValueChange={(value) => {
                            state.clearSubmissionErrors()
                            field.handleChange(value as "X" | "Y" | "Z")
                          }}
                          options={(["X", "Y", "Z"] as const).map((axis) => ({
                            value: axis,
                            label: axis,
                          }))}
                        />
                      )}
                    </form.Field>
                    {axisOptions && (
                      <ReferenceAxisSelection
                        options={axisOptions}
                        value={values.axis === "reference" ? values.axisReference : undefined}
                        onChange={(support) => {
                          state.clearSubmissionErrors()
                          const parsed = referenceAxisSchema.safeParse(support)
                          form.setFieldValue("axis", "reference")
                          form.setFieldValue("axisReference", parsed.success ? parsed.data : null)
                        }}
                      >
                        {null}
                      </ReferenceAxisSelection>
                    )}
                    <form.Field name="handedness">
                      {(field) => (
                        <ChoiceField
                          name={field.name}
                          label={copy.handedness}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onValueChange={(value) => {
                            state.clearSubmissionErrors()
                            field.handleChange(value === "right" ? "right" : "left")
                          }}
                          options={(["right", "left"] as const).map((handedness) => ({
                            value: handedness,
                            label: copy[handedness],
                          }))}
                        />
                      )}
                    </form.Field>
                    {threadAdvancedFields
                      .filter((name) => values.axis !== "reference" || !name.startsWith("origin"))
                      .map(expressionField)}
                  </div>
                </details>
              </ParameterPanel>
            </>
          )
        }}
      </form.Subscribe>
    </Form>
  )
}
