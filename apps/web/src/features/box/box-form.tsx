import {
  boxFeatureParametersSchema,
  boxFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useRef, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import { LengthExpressionField } from "../part-design/length-expression-field"
import {
  featureSubmissionMessage,
  parsePrimitiveLengthExpression,
  quantityExpression,
} from "../part-design/primitive-form"
import {
  PrimitiveParameterPanel,
  type PrimitiveParameterPanelCopy,
} from "../part-design/primitive-parameter-panel"

type DimensionField = "width" | "depth" | "height"

type BoxFormCopy = PrimitiveParameterPanelCopy &
  Readonly<{
    width: string
    depth: string
    height: string
    expressionDescription: string
    submit: string
    invalidExpression: string
    invalidDimension: string
    invalidRange: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }>

type BoxFormValues = Readonly<{
  width: string
  depth: string
  height: string
  centered: boolean
}>

type FieldIssues = Readonly<Partial<Record<DimensionField, string>>>

const DEFAULT_BOX_VALUES: BoxFormValues = {
  width: "20 mm",
  depth: "20 mm",
  height: "20 mm",
  centered: false,
}

export type BoxFormMode =
  | Readonly<{
      kind: "create"
      createFeatureId: () => FeatureId
      featureLabel: string
    }>
  | Readonly<{
      kind: "edit"
      feature: FeatureRecord
    }>

function boxFormValuesFromFeature(feature: FeatureRecord): BoxFormValues {
  const parameters = boxFeatureParametersSchema.parse(feature.parameters)
  return {
    width: quantityExpression(parameters.width),
    depth: quantityExpression(parameters.depth),
    height: quantityExpression(parameters.height),
    centered: parameters.centered,
  }
}

function boxFeatureRecord(
  mode: BoxFormMode,
  parameters: ReturnType<typeof boxFeatureParametersSchema.parse>,
) {
  if (mode.kind === "edit") {
    return featureRecordSchema.parse({ ...mode.feature, parameters })
  }
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: mode.createFeatureId(),
    type: boxFeatureType.type,
    parameters,
    dependencies: [],
    references: [],
    suppressed: false,
    label: mode.featureLabel,
  })
}

function parseBoxValues(
  values: BoxFormValues,
  variables: readonly VariableDefinition[],
  copy: BoxFormCopy,
) {
  const parsed = {
    width: parsePrimitiveLengthExpression(
      values.width,
      variables,
      copy,
      (quantity) => boxFeatureParametersSchema.shape.width.safeParse(quantity).success,
    ),
    depth: parsePrimitiveLengthExpression(
      values.depth,
      variables,
      copy,
      (quantity) => boxFeatureParametersSchema.shape.depth.safeParse(quantity).success,
    ),
    height: parsePrimitiveLengthExpression(
      values.height,
      variables,
      copy,
      (quantity) => boxFeatureParametersSchema.shape.height.safeParse(quantity).success,
    ),
  }
  const issues: Partial<Record<DimensionField, string>> = {}
  for (const field of ["width", "depth", "height"] as const) {
    const result = parsed[field]
    if (!result.ok) issues[field] = result.message
  }
  if (Object.keys(issues).length > 0) return { ok: false as const, issues }
  if (!parsed.width.ok || !parsed.depth.ok || !parsed.height.ok) {
    return { ok: false as const, issues }
  }
  return {
    ok: true as const,
    parameters: boxFeatureParametersSchema.parse({
      width: parsed.width.quantity,
      depth: parsed.depth.quantity,
      height: parsed.height.quantity,
      centered: values.centered,
    }),
  }
}

export function BoxForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onSave,
  onSaved,
  variables,
}: {
  baseRevision: number
  copy: BoxFormCopy
  disabled?: boolean
  mode: BoxFormMode
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  variables: readonly VariableDefinition[]
}) {
  const formElementRef = useRef<HTMLFormElement>(null)
  const [issues, setIssues] = useState<FieldIssues>({})
  const [message, setMessage] = useState<string | null>(null)
  const defaultValues =
    mode.kind === "edit" ? boxFormValuesFromFeature(mode.feature) : DEFAULT_BOX_VALUES
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const parsed = parseBoxValues(value, variables, copy)
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(copy.validationSummary)
        const firstField = (["width", "depth", "height"] as const).find(
          (field) => parsed.issues[field],
        )
        if (firstField) {
          formElementRef.current?.querySelector<HTMLElement>(`[name="${firstField}"]`)?.focus()
        }
        return
      }
      setIssues({})
      setMessage(null)
      const feature = boxFeatureRecord(mode, parsed.parameters)
      const result = await onSave(baseRevision, feature)
      const resultMessage = featureSubmissionMessage(result, copy)
      setMessage(resultMessage)
      if (!resultMessage) onSaved()
    },
  })

  const clearSubmissionErrors = () => {
    if (Object.keys(issues).length > 0) setIssues({})
    if (message) setMessage(null)
  }

  const dimensionField = (fieldName: DimensionField, label: string) => (
    <form.Field name={fieldName}>
      {(field) => (
        <LengthExpressionField
          id={`box-${fieldName}`}
          name={field.name}
          value={field.state.value}
          label={label}
          description={copy.expressionDescription}
          error={issues[fieldName]}
          onBlur={field.handleBlur}
          onChange={(event) => {
            clearSubmissionErrors()
            field.handleChange(event.currentTarget.value)
          }}
        />
      )}
    </form.Field>
  )

  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <PrimitiveParameterPanel
        copy={copy}
        disabled={disabled}
        message={message}
        fields={
          <>
            {dimensionField("width", copy.width)}
            {dimensionField("depth", copy.depth)}
            {dimensionField("height", copy.height)}
          </>
        }
        centeredField={
          <form.Field name="centered">
            {(field) => (
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  name={field.name}
                  type="checkbox"
                  checked={field.state.value}
                  className="size-4 rounded border-input accent-primary"
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    clearSubmissionErrors()
                    field.handleChange(event.currentTarget.checked)
                  }}
                />
                {copy.centered}
              </label>
            )}
          </form.Field>
        }
        footerAction={
          <form.SubmitButton disabled={disabled} requireDirty={false} size="sm">
            {copy.submit}
          </form.SubmitButton>
        }
        onCancel={onCancel}
      />
    </Form>
  )
}
