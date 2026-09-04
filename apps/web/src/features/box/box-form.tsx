import {
  boxFeatureParametersSchema,
  boxFeatureType,
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

type DimensionField = "width" | "depth" | "height"
type BoxField = DimensionField | PrimitiveOriginField

type BoxFormCopy = PrimitiveParameterPanelCopy &
  Readonly<{
    width: string
    depth: string
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

type BoxFormValues = PrimitiveOriginFormValues &
  Readonly<{
    width: string
    depth: string
    height: string
    centered: boolean
  }>

function defaultBoxValues(
  unit: ReturnType<typeof useDocumentDisplayUnits>["length"],
): BoxFormValues {
  const length = defaultLengthExpression(20, unit)
  return {
    width: length,
    depth: length,
    height: length,
    centered: false,
    ...defaultPrimitiveOriginValues(unit),
  }
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
    ...primitiveOriginFormValues(parameters.origin),
  }
}

function boxFeatureRecord(
  mode: BoxFormMode,
  featureId: FeatureId,
  parameters: ReturnType<typeof boxFeatureParametersSchema.parse>,
) {
  if (mode.kind === "edit") {
    return featureRecordSchema.parse({ ...mode.feature, parameters })
  }
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
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
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"],
) {
  const parsed = {
    width: parsePrimitiveLengthExpression(
      values.width,
      variables,
      copy,
      (quantity) => boxFeatureParametersSchema.shape.width.safeParse(quantity).success,
      displayUnit,
    ),
    depth: parsePrimitiveLengthExpression(
      values.depth,
      variables,
      copy,
      (quantity) => boxFeatureParametersSchema.shape.depth.safeParse(quantity).success,
      displayUnit,
    ),
    height: parsePrimitiveLengthExpression(
      values.height,
      variables,
      copy,
      (quantity) => boxFeatureParametersSchema.shape.height.safeParse(quantity).success,
      displayUnit,
    ),
  }
  const origin = parsePrimitiveOriginValues(values, variables, copy, displayUnit)
  const issues: Partial<Record<BoxField, string>> = { ...(origin.ok ? {} : origin.issues) }
  for (const field of ["width", "depth", "height"] as const) {
    const result = parsed[field]
    if (!result.ok) issues[field] = result.message
  }
  if (!parsed.width.ok || !parsed.depth.ok || !parsed.height.ok || !origin.ok) {
    return { ok: false as const, issues }
  }
  return {
    ok: true as const,
    parameters: boxFeatureParametersSchema.parse({
      width: parsed.width.quantity,
      depth: parsed.depth.quantity,
      height: parsed.height.quantity,
      centered: values.centered,
      origin: origin.origin,
    }),
  }
}

type BoxFormProps = FeatureParameterFormProps<BoxFormMode, BoxFormCopy> &
  Readonly<{
    onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
    placementRequest?: PrimitivePlacementRequest | null | undefined
  }>

function BoxPreviewSync({
  copy,
  displayUnit,
  featureId,
  mode,
  onPreviewChange,
  values,
  variables,
}: Readonly<{
  copy: BoxFormCopy
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"]
  featureId: FeatureId
  mode: BoxFormMode
  onPreviewChange: (feature: FeatureRecord | null) => void
  values: BoxFormValues
  variables: readonly VariableDefinition[]
}>) {
  const parsed = parseBoxValues(values, variables, copy, displayUnit)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: parsed.ok ? boxFeatureRecord(mode, featureId, parsed.parameters) : null,
  })
  return null
}

export function BoxForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  placementRequest,
  previewStatus,
  variables,
}: BoxFormProps) {
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
      ? boxFormValuesFromFeature(mode.feature)
      : defaultBoxValues(displayUnits.length)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const parsed = parseBoxValues(value, variables, copy, displayUnits.length)
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(copy.validationSummary)
        const firstField = (
          ["width", "depth", "height", "originX", "originY", "originZ"] as const
        ).find((field) => parsed.issues[field])
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
        feature: boxFeatureRecord(mode, featureId, parsed.parameters),
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
          id={`box-${fieldName}`}
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
          id={`box-${fieldName}`}
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
            <BoxPreviewSync
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
            previewStatus={previewStatus}
          />
        }
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
