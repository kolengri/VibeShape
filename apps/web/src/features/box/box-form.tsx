import {
  boxFeatureParametersSchema,
  boxFeatureType,
  createLengthQuantity,
  evaluateExpression,
  evaluateVariableDefinitions,
  featureRecordSchema,
  type FeatureId,
  type FeatureRecord,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Field, FieldError, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useRef, useState } from "react"
import type { AddFeatureResult } from "../../document/document-controller"
import { BoxParameterPanel, type BoxParameterPanelCopy } from "./box-parameter-panel"

type DimensionField = "width" | "depth" | "height"

type BoxFormCopy = BoxParameterPanelCopy &
  Readonly<{
    width: string
    depth: string
    height: string
    expressionDescription: string
    create: string
    invalidExpression: string
    invalidDimension: string
    invalidRange: string
    validationSummary: string
    staleRevision: string
    createFailed: string
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

function submissionMessage(result: AddFeatureResult, copy: BoxFormCopy) {
  if (result.ok) return null
  if (
    result.diagnostic.sourceCode === "stale-revision" ||
    result.diagnostic.code === "write-access-unavailable"
  ) {
    return copy.staleRevision
  }
  return copy.createFailed
}

function invalidAttribute(error: string | undefined) {
  return error ? (true as const) : undefined
}

export function BoxForm({
  baseRevision,
  copy,
  createFeatureId,
  disabled = false,
  featureLabel,
  onCancel,
  onCreate,
  onCreated,
  variables,
}: {
  baseRevision: number
  copy: BoxFormCopy
  createFeatureId: () => FeatureId
  disabled?: boolean
  featureLabel: string
  onCancel: () => void
  onCreate: (baseRevision: number, feature: FeatureRecord) => Promise<AddFeatureResult>
  onCreated: () => void
  variables: readonly VariableDefinition[]
}) {
  const formElementRef = useRef<HTMLFormElement>(null)
  const [issues, setIssues] = useState<FieldIssues>({})
  const [message, setMessage] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: DEFAULT_BOX_VALUES,
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
      const feature = featureRecordSchema.parse({
        schemaVersion: 0,
        id: createFeatureId(),
        type: boxFeatureType.type,
        parameters: parsed.parameters,
        dependencies: [],
        references: [],
        suppressed: false,
        label: featureLabel,
      })
      const result = await onCreate(baseRevision, feature)
      const resultMessage = submissionMessage(result, copy)
      setMessage(resultMessage)
      if (!resultMessage) onCreated()
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
            {copy.create}
          </form.SubmitButton>
        }
        onCancel={onCancel}
      />
    </Form>
  )
}
