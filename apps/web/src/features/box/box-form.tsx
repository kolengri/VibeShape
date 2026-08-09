import {
  boxFeatureParametersSchema,
  boxFeatureType,
  createLengthQuantity,
  evaluateExpression,
  evaluateVariableDefinitions,
  featureRecordSchema,
  type FeatureId,
  type FeatureRecord,
  type LengthQuantity,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Field, FieldError, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useRef, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import { BoxParameterPanel, type BoxParameterPanelCopy } from "./box-parameter-panel"

type DimensionField = "width" | "depth" | "height"

type BoxFormCopy = BoxParameterPanelCopy &
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

function quantityExpression(quantity: LengthQuantity) {
  return quantity.source.expression ?? `${quantity.source.value} ${quantity.source.unit}`
}

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

function parseLengthExpression(
  rawExpression: string,
  variables: readonly VariableDefinition[],
  copy: BoxFormCopy,
) {
  const expression = rawExpression.trim()
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  if (!evaluatedVariables.ok) return { ok: false as const, message: copy.invalidExpression }
  const evaluated = evaluateExpression(expression, evaluatedVariables.valuesByName)
  if (!evaluated.ok) return { ok: false as const, message: copy.invalidExpression }
  if (evaluated.value.dimension !== "length") {
    return { ok: false as const, message: copy.invalidDimension }
  }
  const quantity = createLengthQuantity(evaluated.value.value, "mm", expression)
  if (!boxFeatureParametersSchema.shape.width.safeParse(quantity).success) {
    return { ok: false as const, message: copy.invalidRange }
  }
  return { ok: true as const, quantity }
}

function parseBoxValues(
  values: BoxFormValues,
  variables: readonly VariableDefinition[],
  copy: BoxFormCopy,
) {
  const parsed = {
    width: parseLengthExpression(values.width, variables, copy),
    depth: parseLengthExpression(values.depth, variables, copy),
    height: parseLengthExpression(values.height, variables, copy),
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

function submissionMessage(result: FeatureMutationResult, copy: BoxFormCopy) {
  if (result.ok) return null
  if (
    result.diagnostic.sourceCode === "stale-revision" ||
    result.diagnostic.code === "write-access-unavailable"
  ) {
    return copy.staleRevision
  }
  return copy.saveFailed
}

function invalidAttribute(error: string | undefined) {
  return error ? (true as const) : undefined
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
      const resultMessage = submissionMessage(result, copy)
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
        <Field data-invalid={Boolean(issues[fieldName]) || undefined}>
          <FieldLabel htmlFor={`box-${fieldName}`} required>
            {label}
          </FieldLabel>
          <Input
            id={`box-${fieldName}`}
            name={field.name}
            value={field.state.value}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`box-${fieldName}-description box-${fieldName}-error`}
            aria-invalid={invalidAttribute(issues[fieldName])}
            className="font-mono tabular-nums"
            onBlur={field.handleBlur}
            onChange={(event) => {
              clearSubmissionErrors()
              field.handleChange(event.currentTarget.value)
            }}
          />
          <p
            id={`box-${fieldName}-description`}
            className="text-xs leading-4 text-muted-foreground"
          >
            {copy.expressionDescription}
          </p>
          <FieldError id={`box-${fieldName}-error`} reserveSpace>
            {issues[fieldName]}
          </FieldError>
        </Field>
      )}
    </form.Field>
  )

  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <BoxParameterPanel
        copy={copy}
        disabled={disabled}
        message={message}
        widthField={dimensionField("width", copy.width)}
        depthField={dimensionField("depth", copy.depth)}
        heightField={dimensionField("height", copy.height)}
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
