import {
  cylinderFeatureParametersSchema,
  cylinderFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultLengthExpression,
  type useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { TanStackBooleanParameterField } from "../part-design/boolean-parameter-field"
import { LengthExpressionField } from "../part-design/length-expression-field"
import {
  parsePrimitiveLengthExpression,
  quantityExpression,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import {
  PrimitiveParameterPanel,
  type PrimitiveParameterPanelCopy,
} from "../part-design/primitive-parameter-panel"
import { useParameterFormState } from "../part-design/use-parameter-form-state"

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

function defaultCylinderValues(
  unit: ReturnType<typeof useDocumentDisplayUnits>["length"],
): CylinderFormValues {
  return {
    radius: defaultLengthExpression(10, unit),
    height: defaultLengthExpression(20, unit),
    centered: false,
  }
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
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"],
) {
  const radius = parsePrimitiveLengthExpression(
    values.radius,
    variables,
    copy,
    (quantity) => cylinderFeatureParametersSchema.shape.radius.safeParse(quantity).success,
    displayUnit,
  )
  const height = parsePrimitiveLengthExpression(
    values.height,
    variables,
    copy,
    (quantity) => cylinderFeatureParametersSchema.shape.height.safeParse(quantity).success,
    displayUnit,
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
  const {
    clearSubmissionErrors,
    displayUnits,
    formElementRef,
    issues,
    message,
    setIssues,
    setMessage,
    suggestions,
  } = useParameterFormState(variables)
  const defaultValues =
    mode.kind === "edit"
      ? cylinderFormValuesFromFeature(mode.feature)
      : defaultCylinderValues(displayUnits.length)
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const parsed = parseCylinderValues(value, variables, copy, displayUnits.length)
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
      await submitFeatureMutation({
        baseRevision,
        copy,
        feature: cylinderFeatureRecord(mode, parsed.parameters),
        onSave,
        onSaved,
        setMessage,
      })
    },
  })

  const dimensionField = (fieldName: DimensionField, label: string) => (
    <form.Field name={fieldName}>
      {(field) => (
        <LengthExpressionField
          id={`cylinder-${fieldName}`}
          name={field.name}
          value={field.state.value}
          label={label}
          description={copy.expressionDescription}
          error={issues[fieldName]}
          suggestions={suggestions}
          onBlur={field.handleBlur}
          onValueChange={(value) => {
            clearSubmissionErrors()
            field.handleChange(value)
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
            {dimensionField("radius", copy.radius)}
            {dimensionField("height", copy.height)}
          </>
        }
        centeredField={
          <form.Field name="centered">
            {(field) => (
              <TanStackBooleanParameterField
                field={field}
                label={copy.centered}
                onBeforeChange={clearSubmissionErrors}
              />
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
