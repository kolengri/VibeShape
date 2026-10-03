import type {
  DocumentDisplayUnits,
  FeatureId,
  FeatureRecord,
  VariableDefinition,
} from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
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
import {
  type PatternFormMode,
  type PatternFormValues,
  type PatternValidationCopy,
  parsePatternForm,
  patternFeatureRecord,
  patternFormValues,
} from "./pattern-form-model"

export type PatternFormCopy = ParameterPanelCopy &
  PatternValidationCopy & {
    parameters: string
    submit: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
    unavailable: string
    previewFailed: string
    kind: string
    linear: string
    circular: string
    axis: string
    count: string
    countDescription: string
    spacing: string
    spacingDescription: string
    angle: string
    angleDescription: string
    centerX: string
    centerY: string
    centerZ: string
    centerDescription: string
  }
type Props = FeatureParameterFormProps<PatternFormMode, PatternFormCopy> & {
  sourceAvailable: boolean
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}
function PatternPreview({
  values,
  variables,
  units,
  copy,
  mode,
  featureId,
  onPreviewChange,
}: {
  values: PatternFormValues
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: PatternFormCopy
  mode: PatternFormMode
  featureId: FeatureId
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  const parsed = parsePatternForm(values, variables, units, copy)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: parsed.ok ? patternFeatureRecord(mode, featureId, parsed) : null,
  })
  return null
}
const commonExpressionFields = ["count"] as const
const linearFields = ["spacing"] as const
const circularFields = ["angle", "centerX", "centerY", "centerZ"] as const
function panelMessage(
  message: string | null,
  sourceAvailable: boolean,
  status: FeaturePreviewState["status"] | undefined,
  copy: PatternFormCopy,
) {
  if (message) return message
  if (!sourceAvailable) return copy.unavailable
  return status === "error" ? copy.previewFailed : null
}
function fieldError(
  issues: Readonly<Record<string, string | undefined>>,
  parsed: ReturnType<typeof parsePatternForm>,
  name: keyof PatternFormValues,
) {
  return issues[name] ?? (parsed.ok ? undefined : parsed.issues[name])
}
export function PatternForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  sourceAvailable,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewStatus,
  variables,
}: Props) {
  const state = useParameterFormState(variables)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues: patternFormValues(mode, state.displayUnits),
    onSubmit: async ({ value }) => {
      const parsed = parsePatternForm(value, variables, state.displayUnits, copy)
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
          feature: patternFeatureRecord(mode, featureId, parsed),
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
      <form.Subscribe selector={(formState) => [formState.values, formState.isSubmitting] as const}>
        {([values, pending]) => {
          const parsed = parsePatternForm(values, variables, state.displayUnits, copy)
          const fields = [
            ...commonExpressionFields,
            ...(values.kind === "linear" ? linearFields : circularFields),
          ]
          const description = {
            count: copy.countDescription,
            spacing: copy.spacingDescription,
            angle: copy.angleDescription,
            centerX: copy.centerDescription,
            centerY: copy.centerDescription,
            centerZ: copy.centerDescription,
          }
          return (
            <>
              {onPreviewChange && sourceAvailable && (
                <PatternPreview
                  values={values}
                  variables={variables}
                  units={state.displayUnits}
                  copy={copy}
                  mode={mode}
                  featureId={featureId}
                  onPreviewChange={onPreviewChange}
                />
              )}
              <ParameterPanel
                copy={copy}
                legend={copy.parameters}
                disabled={disabled || pending || !sourceAvailable}
                message={panelMessage(state.message, sourceAvailable, previewStatus, copy)}
                actions={
                  <TaskPanelFormActions
                    acceptLabel={copy.submit}
                    ariaLabel={copy.title}
                    cancelLabel={copy.cancel}
                    disabled={disabled || !sourceAvailable || !parsed.ok}
                    onCancel={onCancel}
                    previewStatus={previewStatus}
                  />
                }
              >
                <form.Field name="kind">
                  {(field) => (
                    <fieldset className="grid gap-2">
                      <legend className="mb-2 text-xs font-medium">{copy.kind}</legend>
                      {(["linear", "circular"] as const).map((kind) => (
                        <label key={kind} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="kind"
                            value={kind}
                            checked={field.state.value === kind}
                            onBlur={field.handleBlur}
                            onChange={() => {
                              state.clearSubmissionErrors()
                              field.handleChange(kind)
                            }}
                          />
                          {copy[kind]}
                        </label>
                      ))}
                    </fieldset>
                  )}
                </form.Field>
                <form.Field name="axis">
                  {(field) => (
                    <fieldset className="grid gap-2">
                      <legend className="mb-2 text-xs font-medium">{copy.axis}</legend>
                      {(["X", "Y", "Z"] as const).map((axis) => (
                        <label key={axis} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="axis"
                            value={axis}
                            checked={field.state.value === axis}
                            onBlur={field.handleBlur}
                            onChange={() => {
                              state.clearSubmissionErrors()
                              field.handleChange(axis)
                            }}
                          />
                          {axis}
                        </label>
                      ))}
                    </fieldset>
                  )}
                </form.Field>
                {fields.map((name) => (
                  <form.Field name={name} key={name}>
                    {(field) => (
                      <LengthExpressionField
                        id={`pattern-${name}`}
                        name={name}
                        value={field.state.value}
                        label={copy[name]}
                        description={description[name]}
                        error={fieldError(state.issues, parsed, name)}
                        suggestions={state.suggestions}
                        onBlur={field.handleBlur}
                        onValueChange={(value) => {
                          state.clearSubmissionErrors()
                          field.handleChange(value)
                        }}
                      />
                    )}
                  </form.Field>
                ))}
              </ParameterPanel>
            </>
          )
        }}
      </form.Subscribe>
    </Form>
  )
}
