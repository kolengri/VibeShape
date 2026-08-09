import {
  booleanFeatureParametersSchema,
  booleanFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useRef, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import { featureSubmissionMessage } from "../part-design/primitive-form"
import { BooleanParameterPanel, type BooleanParameterPanelCopy } from "./boolean-parameter-panel"

type InputField = "targetFeatureId" | "toolFeatureId"

export type BooleanInputOption = Readonly<{
  id: FeatureId
  label: string
}>

type BooleanFormCopy = BooleanParameterPanelCopy &
  Readonly<{
    target: string
    tool: string
    targetDescription: string
    toolDescription: string
    submit: string
    missingInput: string
    sameInput: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }>

type BooleanFormValues = Readonly<{
  targetFeatureId: string
  toolFeatureId: string
}>

export type BooleanFormMode =
  | Readonly<{
      kind: "create"
      createFeatureId: () => FeatureId
      featureLabel: string
    }>
  | Readonly<{
      kind: "edit"
      feature: FeatureRecord
    }>

function defaultBooleanValues(
  mode: BooleanFormMode,
  options: readonly BooleanInputOption[],
): BooleanFormValues {
  if (mode.kind === "edit") {
    return {
      targetFeatureId: mode.feature.dependencies[0] ?? "",
      toolFeatureId: mode.feature.dependencies[1] ?? "",
    }
  }
  return {
    targetFeatureId: options[0]?.id ?? "",
    toolFeatureId: options[1]?.id ?? "",
  }
}

function parseBooleanValues(
  values: BooleanFormValues,
  options: readonly BooleanInputOption[],
  copy: BooleanFormCopy,
) {
  const availableIds = new Set(options.map(({ id }) => id))
  const targetFeatureId = featureIdSchema.safeParse(values.targetFeatureId)
  const toolFeatureId = featureIdSchema.safeParse(values.toolFeatureId)
  const issues: Partial<Record<InputField, string>> = {}
  if (!targetFeatureId.success || !availableIds.has(targetFeatureId.data)) {
    issues.targetFeatureId = copy.missingInput
  }
  if (!toolFeatureId.success || !availableIds.has(toolFeatureId.data)) {
    issues.toolFeatureId = copy.missingInput
  }
  if (
    targetFeatureId.success &&
    toolFeatureId.success &&
    targetFeatureId.data === toolFeatureId.data
  ) {
    issues.toolFeatureId = copy.sameInput
  }
  if (Object.keys(issues).length > 0) return { ok: false as const, issues }
  return {
    ok: true as const,
    targetFeatureId: targetFeatureId.data as FeatureId,
    toolFeatureId: toolFeatureId.data as FeatureId,
  }
}

function booleanFeatureRecord(
  mode: BooleanFormMode,
  targetFeatureId: FeatureId,
  toolFeatureId: FeatureId,
) {
  const parameters = booleanFeatureParametersSchema.parse({ operation: "subtract" })
  if (mode.kind === "edit") {
    return featureRecordSchema.parse({
      ...mode.feature,
      parameters,
      dependencies: [targetFeatureId, toolFeatureId],
    })
  }
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: mode.createFeatureId(),
    type: booleanFeatureType.type,
    parameters,
    dependencies: [targetFeatureId, toolFeatureId],
    references: [],
    suppressed: false,
    label: mode.featureLabel,
  })
}

export function BooleanForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onSave,
  onSaved,
  options,
}: {
  baseRevision: number
  copy: BooleanFormCopy
  disabled?: boolean
  mode: BooleanFormMode
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  options: readonly BooleanInputOption[]
}) {
  const formElementRef = useRef<HTMLFormElement>(null)
  const [message, setMessage] = useState<string | null>(null)
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
      const feature = booleanFeatureRecord(mode, parsed.targetFeatureId, parsed.toolFeatureId)
      const result = await onSave(baseRevision, feature)
      const resultMessage = featureSubmissionMessage(result, copy)
      setMessage(resultMessage)
      if (!resultMessage) onSaved()
    },
  })

  const inputField = (fieldName: InputField, label: string, description: string) => (
    <form.AppField name={fieldName}>
      {(field) => (
        <field.NativeSelectField
          label={label}
          description={description}
          required
          onValueChange={() => setMessage(null)}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </field.NativeSelectField>
      )}
    </form.AppField>
  )

  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <BooleanParameterPanel
        copy={copy}
        disabled={disabled}
        message={message}
        fields={
          <>
            {inputField("targetFeatureId", copy.target, copy.targetDescription)}
            {inputField("toolFeatureId", copy.tool, copy.toolDescription)}
          </>
        }
        footerAction={
          <form.SubmitButton
            disabled={disabled || options.length < 2}
            requireDirty={false}
            size="sm"
          >
            {copy.submit}
          </form.SubmitButton>
        }
        onCancel={onCancel}
      />
    </Form>
  )
}
