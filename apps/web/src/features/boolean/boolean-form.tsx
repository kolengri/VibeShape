import type { FeatureRecord } from "@vibeshape/domain"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import { exactBodyPickCandidates } from "../part-design/body-reference-picking"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { featureSubmissionMessage } from "../part-design/primitive-form"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import {
  type BooleanFormMode,
  type BooleanInputOption,
  booleanFeatureRecord,
  defaultBooleanValues,
  parseBooleanValues,
} from "./boolean-form-model"

export type { BooleanFormMode, BooleanInputOption } from "./boolean-form-model"

import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { BooleanParameterPanel, type BooleanParameterPanelCopy } from "./boolean-parameter-panel"

type InputField = "targetFeatureId" | "toolFeatureId"

type BooleanFormCopy = BooleanParameterPanelCopy &
  Readonly<{
    target: string
    tool: string
    targetDescription: string
    toolDescription: string
    keepTools: string
    submit: string
    missingInput: string
    sameInput: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }>

function BooleanPreviewSync({
  feature,
  onPreviewChange,
}: {
  feature: FeatureRecord | null
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({ preview: feature, onPreviewChange })
  return null
}
const IGNORE_PREVIEW = () => undefined

export function BooleanForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onSave,
  onSaved,
  options,
  onPreviewChange = IGNORE_PREVIEW,
  previewStatus,
}: {
  baseRevision: number
  copy: BooleanFormCopy
  disabled?: boolean
  mode: BooleanFormMode
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  options: readonly BooleanInputOption[]
  onPreviewChange?: (feature: FeatureRecord | null) => void
  previewStatus?: FeaturePreviewState["status"]
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: defaultBooleanValues(mode, options),
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parseBooleanValues(value, options, copy)
        return parsed.ok ? undefined : { form: copy.validationSummary, fields: parsed.issues }
      },
    },
    onSubmit: async ({ value }) => {
      const parsed = parseBooleanValues(value, options, copy)
      if (!parsed.ok) return
      setMessage(null)
      const feature = booleanFeatureRecord(
        mode,
        featureId,
        parsed.target,
        parsed.tool,
        value.keepTools,
      )
      try {
        const result = await onSave(baseRevision, feature)
        const resultMessage = featureSubmissionMessage(result, copy)
        setMessage(resultMessage)
        if (!resultMessage) onSaved()
      } catch {
        setMessage(copy.saveFailed)
      }
    },
  })

  const inputField = (fieldName: InputField, label: string, description: string) => (
    <form.AppField name={fieldName}>
      {(field) => (
        <field.ReferencePickField
          id={`boolean-${fieldName}`}
          label={label}
          description={description}
          placeholder={copy.missingInput}
          options={options.map((option) => ({ value: option.id, label: option.label }))}
          candidates={exactBodyPickCandidates(options)}
          required
          onValueChange={() => setMessage(null)}
        />
      )}
    </form.AppField>
  )

  return (
    <Form form={form} aria-label={copy.title} className="gap-0">
      <form.FormError />
      <form.Subscribe selector={(state) => state.values}>
        {(values) => {
          const parsed = parseBooleanValues(values, options, copy)
          return (
            <BooleanPreviewSync
              onPreviewChange={onPreviewChange}
              feature={
                parsed.ok
                  ? booleanFeatureRecord(
                      mode,
                      featureId,
                      parsed.target,
                      parsed.tool,
                      values.keepTools,
                    )
                  : null
              }
            />
          )
        }}
      </form.Subscribe>
      <BooleanParameterPanel
        actions={
          <TaskPanelFormActions
            acceptLabel={copy.submit}
            ariaLabel={copy.title}
            cancelLabel={copy.cancel}
            disabled={disabled || options.length < 2}
            previewStatus={previewStatus}
            onCancel={onCancel}
          />
        }
        copy={copy}
        disabled={disabled}
        message={message}
        fields={
          <>
            {inputField("targetFeatureId", copy.target, copy.targetDescription)}
            {inputField("toolFeatureId", copy.tool, copy.toolDescription)}
            <form.AppField name="keepTools">
              {(field) => (
                <field.CheckboxField
                  label={copy.keepTools}
                  onValueChange={() => setMessage(null)}
                />
              )}
            </form.AppField>
          </>
        }
      />
    </Form>
  )
}
