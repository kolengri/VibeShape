import type { FeatureRecord } from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useRef, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import { exactBodyPickCandidates } from "../part-design/body-reference-picking"
import { TanStackBooleanParameterField } from "../part-design/boolean-parameter-field"
import { featureSubmissionMessage } from "../part-design/primitive-form"
import { TanStackReferencePickField } from "../part-design/tanstack-reference-pick-field"
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
  const formElementRef = useRef<HTMLFormElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues: defaultBooleanValues(mode, options),
    validators: {
      onSubmit: ({ value }) => {
        const parsed = parseBooleanValues(value, options, copy)
        return parsed.ok ? undefined : { fields: parsed.issues }
      },
    },
    onSubmitInvalid: () => {
      setMessage(copy.validationSummary)
      queueMicrotask(() => {
        formElementRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus()
      })
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
      {() => (
        <TanStackReferencePickField
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
    <Form
      ref={formElementRef}
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
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
                <TanStackBooleanParameterField
                  field={field}
                  label={copy.keepTools}
                  onBeforeChange={() => setMessage(null)}
                />
              )}
            </form.AppField>
          </>
        }
      />
    </Form>
  )
}
