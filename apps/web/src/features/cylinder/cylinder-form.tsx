import {
  cylinderFeatureParametersSchema,
  cylinderFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useState } from "react"
import {
  defaultLengthExpression,
  type useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { TanStackBooleanParameterField } from "../part-design/boolean-parameter-field"
import { LengthExpressionField } from "../part-design/length-expression-field"
import {
  defaultPrimitiveOriginValues,
  type FeatureParameterFormProps,
  type PrimitiveOriginField,
  type PrimitiveOriginFormValues,
  parsePrimitiveLengthExpression,
  parsePrimitiveOriginValues,
  primitiveOriginFormValues,
  quantityExpression,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import {
  PrimitiveParameterPanel,
  type PrimitiveParameterPanelCopy,
} from "../part-design/primitive-parameter-panel"
import type { PrimitivePlacementRequest } from "../part-design/primitive-placement"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"

type DimensionField = "radius" | "height"
type CylinderField = DimensionField | PrimitiveOriginField

type CylinderFormCopy = PrimitiveParameterPanelCopy &
  Readonly<{
    radius: string
    height: string
    invalidPositionRange: string
    originX: string
    originY: string
    originZ: string
    parameters: string
    placement: string
    positionDescription: string
    expressionDescription: string
    submit: string
    invalidExpression: string
    invalidDimension: string
    invalidRange: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }>

type CylinderFormValues = PrimitiveOriginFormValues &
  Readonly<{
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
    ...defaultPrimitiveOriginValues(unit),
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
    ...primitiveOriginFormValues(parameters.origin),
  }
}

function cylinderFeatureRecord(
  mode: CylinderFormMode,
  featureId: FeatureId,
  parameters: ReturnType<typeof cylinderFeatureParametersSchema.parse>,
) {
  if (mode.kind === "edit") {
    return featureRecordSchema.parse({ ...mode.feature, parameters })
  }
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
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
  const origin = parsePrimitiveOriginValues(values, variables, copy, displayUnit)
  const issues: Partial<Record<CylinderField, string>> = { ...(origin.ok ? {} : origin.issues) }
  if (!radius.ok) issues.radius = radius.message
  if (!height.ok) issues.height = height.message
  if (!radius.ok || !height.ok || !origin.ok) return { ok: false as const, issues }
  return {
    ok: true as const,
    parameters: cylinderFeatureParametersSchema.parse({
      radius: radius.quantity,
      height: height.quantity,
      centered: values.centered,
      origin: origin.origin,
    }),
  }
}

type CylinderFormProps = FeatureParameterFormProps<CylinderFormMode, CylinderFormCopy> &
  Readonly<{
    onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
    placementRequest?: PrimitivePlacementRequest | null | undefined
  }>

function CylinderPreviewSync({
  copy,
  displayUnit,
  featureId,
  mode,
  onPreviewChange,
  values,
  variables,
}: Readonly<{
  copy: CylinderFormCopy
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"]
  featureId: FeatureId
  mode: CylinderFormMode
  onPreviewChange: (feature: FeatureRecord | null) => void
  values: CylinderFormValues
  variables: readonly VariableDefinition[]
}>) {
  useDebouncedFeaturePreview({
    input: { copy, displayUnit, mode, variables },
    onPreviewChange,
    values,
    resolve: (currentValues, input) => {
      const parsed = parseCylinderValues(
        currentValues,
        input.variables,
        input.copy,
        input.displayUnit,
      )
      return parsed.ok ? cylinderFeatureRecord(input.mode, featureId, parsed.parameters) : null
    },
  })
  return null
}

export function CylinderForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  placementRequest,
  variables,
}: CylinderFormProps) {
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
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const parsed = parseCylinderValues(value, variables, copy, displayUnits.length)
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(copy.validationSummary)
        const firstField = (["radius", "height", "originX", "originY", "originZ"] as const).find(
          (field) => parsed.issues[field],
        )
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
        feature: cylinderFeatureRecord(mode, featureId, parsed.parameters),
        onSave,
        onSaved,
        setMessage,
      })
    },
  })

  useEffect(() => {
    if (disabled || !placementRequest || placementRequest.featureId !== featureId) return
    const [x, y, z] = placementRequest.position
    clearSubmissionErrors()
    form.setFieldValue("originX", defaultLengthExpression(x, displayUnits.length))
    form.setFieldValue("originY", defaultLengthExpression(y, displayUnits.length))
    form.setFieldValue("originZ", defaultLengthExpression(z, displayUnits.length))
  }, [clearSubmissionErrors, disabled, displayUnits.length, featureId, form, placementRequest])

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

  const originField = (fieldName: PrimitiveOriginField, label: string) => (
    <form.Field name={fieldName}>
      {(field) => (
        <LengthExpressionField
          id={`cylinder-${fieldName}`}
          name={field.name}
          value={field.state.value}
          label={label}
          description={copy.positionDescription}
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
      {onPreviewChange ? (
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <CylinderPreviewSync
              copy={copy}
              displayUnit={displayUnits.length}
              featureId={featureId}
              mode={mode}
              onPreviewChange={onPreviewChange}
              values={values}
              variables={variables}
            />
          )}
        </form.Subscribe>
      ) : null}
      <PrimitiveParameterPanel
        actions={
          <TaskPanelFormActions
            acceptLabel={copy.submit}
            ariaLabel={copy.title}
            cancelLabel={copy.cancel}
            disabled={disabled}
            onCancel={onCancel}
          />
        }
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
        placementFields={
          <>
            {originField("originX", copy.originX)}
            {originField("originY", copy.originY)}
            {originField("originZ", copy.originZ)}
          </>
        }
      />
    </Form>
  )
}
