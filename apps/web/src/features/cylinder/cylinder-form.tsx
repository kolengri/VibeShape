import {
  cylinderFeatureParametersSchema,
  cylinderFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Field, FieldError, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useRef, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  invalidAttribute,
  featureSubmissionMessage,
  parsePrimitiveLengthExpression,
  quantityExpression,
} from "../part-design/primitive-form"
import {
  PrimitiveParameterPanel,
  type PrimitiveParameterPanelCopy,
} from "../part-design/primitive-parameter-panel"

type DimensionField = "radius" | "height"

type CylinderFormCopy = PrimitiveParameterPanelCopy &
  Readonly<{
    radius: string
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

type CylinderFormValues = Readonly<{
  radius: string
  height: string
  centered: boolean
}>

type FieldIssues = Readonly<Partial<Record<DimensionField, string>>>

const DEFAULT_CYLINDER_VALUES: CylinderFormValues = {
  radius: "10 mm",
  height: "20 mm",
  centered: false,
}

export type CylinderFormMode =
  | Readonly<{
      kind: "create"
      createFeatureId: () => FeatureId
      featureLabel: string
    }>
  | Readonly<{
      kind: "edit"
      feature: FeatureRecord
    }>

function cylinderFormValuesFromFeature(feature: FeatureRecord): CylinderFormValues {
  const parameters = cylinderFeatureParametersSchema.parse(feature.parameters)
  return {
    radius: quantityExpression(parameters.radius),
    height: quantityExpression(parameters.height),
    centered: parameters.centered,
  }
}

function cylinderFeatureRecord(
  mode: CylinderFormMode,
  parameters: ReturnType<typeof cylinderFeatureParametersSchema.parse>,
) {
  if (mode.kind === "edit") {
    return featureRecordSchema.parse({ ...mode.feature, parameters })
  }
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: mode.createFeatureId(),
    type: cylinderFeatureType.type,
    parameters,
    dependencies: [],
    references: [],
    suppressed: false,
    label: mode.featureLabel,
  })
}

function parseCylinderValues(
  values: CylinderFormValues,
  variables: readonly VariableDefinition[],
  copy: CylinderFormCopy,
) {
  const radius = parsePrimitiveLengthExpression(
    values.radius,
    variables,
    copy,
    (quantity) => cylinderFeatureParametersSchema.shape.radius.safeParse(quantity).success,
  )
  const height = parsePrimitiveLengthExpression(
    values.height,
    variables,
    copy,
    (quantity) => cylinderFeatureParametersSchema.shape.height.safeParse(quantity).success,
  )
  const issues: Partial<Record<DimensionField, string>> = {}
  if (!radius.ok) issues.radius = radius.message
  if (!height.ok) issues.height = height.message
  if (!radius.ok || !height.ok) return { ok: false as const, issues }
  return {
    ok: true as const,
    parameters: cylinderFeatureParametersSchema.parse({
      radius: radius.quantity,
      height: height.quantity,
      centered: values.centered,
    }),
  }
}

export function CylinderForm({
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
  copy: CylinderFormCopy
  disabled?: boolean
  mode: CylinderFormMode
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  variables: readonly VariableDefinition[]
}) {
  const formElementRef = useRef<HTMLFormElement>(null)
  const [issues, setIssues] = useState<FieldIssues>({})
  const [message, setMessage] = useState<string | null>(null)
  const defaultValues =
    mode.kind === "edit" ? cylinderFormValuesFromFeature(mode.feature) : DEFAULT_CYLINDER_VALUES
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const parsed = parseCylinderValues(value, variables, copy)
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(copy.validationSummary)
        const firstField = (["radius", "height"] as const).find((field) => parsed.issues[field])
        if (firstField) {
          formElementRef.current?.querySelector<HTMLElement>(`[name="${firstField}"]`)?.focus()
        }
        return
      }
      setIssues({})
      setMessage(null)
      const feature = cylinderFeatureRecord(mode, parsed.parameters)
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
        <Field data-invalid={Boolean(issues[fieldName]) || undefined}>
          <FieldLabel htmlFor={`cylinder-${fieldName}`} required>
            {label}
          </FieldLabel>
          <Input
            id={`cylinder-${fieldName}`}
            name={field.name}
            value={field.state.value}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`cylinder-${fieldName}-description cylinder-${fieldName}-error`}
            aria-invalid={invalidAttribute(issues[fieldName])}
            className="font-mono tabular-nums"
            onBlur={field.handleBlur}
            onChange={(event) => {
              clearSubmissionErrors()
              field.handleChange(event.currentTarget.value)
            }}
          />
          <p
            id={`cylinder-${fieldName}-description`}
            className="text-xs leading-4 text-muted-foreground"
          >
            {copy.expressionDescription}
          </p>
          <FieldError id={`cylinder-${fieldName}-error`} reserveSpace>
            {issues[fieldName]}
          </FieldError>
        </Field>
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
            {dimensionField("radius", copy.radius)}
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
