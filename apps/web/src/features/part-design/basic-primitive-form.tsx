import {
  coneFeatureParametersSchema,
  coneFeatureType,
  type DocumentDisplayUnits,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type LengthQuantity,
  sphereFeatureParametersSchema,
  sphereFeatureType,
  torusFeatureParametersSchema,
  torusFeatureType,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useMemo, useState } from "react"
import { defaultLengthExpression } from "../../document/document-display-units"
import { TanStackBooleanParameterField } from "./boolean-parameter-field"
import { TanStackLengthExpressionField } from "./length-expression-field"
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
} from "./primitive-form"
import {
  PrimitiveParameterPanel,
  type PrimitiveParameterPanelCopy,
} from "./primitive-parameter-panel"
import { type PrimitivePlacementRequest, usePrimitivePlacementRequest } from "./primitive-placement"
import { TaskPanelFormActions } from "./task-panel-form-actions"
import { useDebouncedFeaturePreview } from "./use-debounced-feature-preview"
import { useParameterFormState } from "./use-parameter-form-state"

export type BasicPrimitiveKind = "sphere" | "cone" | "torus"
type DimensionField = "radius" | "height" | "majorRadius" | "minorRadius"
type PrimitiveField = DimensionField | PrimitiveOriginField
type PrimitiveFormValues = PrimitiveOriginFormValues &
  Readonly<Record<DimensionField, string>> &
  Readonly<{ centered: boolean }>

export type BasicPrimitiveFormCopy = PrimitiveParameterPanelCopy &
  Readonly<Record<DimensionField | PrimitiveOriginField, string>> &
  Readonly<{
    positionDescription: string
    expressionDescription: string
    submit: string
    invalidExpression: string
    invalidDimension: string
    invalidRange: string
    invalidPositionRange: string
    invalidTorusRadii: string
    invalidWorkspaceBounds: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }>

export type BasicPrimitiveFormMode =
  | Readonly<{
      kind: "create"
      createFeatureId: () => FeatureId
      featureLabel: string
    }>
  | Readonly<{ kind: "edit"; feature: FeatureRecord }>

const primitiveDefinitions = {
  sphere: {
    dimensions: ["radius"],
    schema: sphereFeatureParametersSchema,
    type: sphereFeatureType.type,
  },
  cone: {
    dimensions: ["radius", "height"],
    schema: coneFeatureParametersSchema,
    type: coneFeatureType.type,
  },
  torus: {
    dimensions: ["majorRadius", "minorRadius"],
    schema: torusFeatureParametersSchema,
    type: torusFeatureType.type,
  },
} as const

const dimensionSchemas = {
  radius: sphereFeatureParametersSchema.shape.radius,
  height: coneFeatureParametersSchema.shape.height,
  majorRadius: torusFeatureParametersSchema.shape.majorRadius,
  minorRadius: torusFeatureParametersSchema.shape.minorRadius,
}

function initialPrimitiveValues(
  primitiveKind: BasicPrimitiveKind,
  mode: BasicPrimitiveFormMode,
  unit: DocumentDisplayUnits["length"],
): PrimitiveFormValues {
  const values: PrimitiveFormValues = {
    radius: defaultLengthExpression(10, unit),
    height: defaultLengthExpression(20, unit),
    majorRadius: defaultLengthExpression(20, unit),
    minorRadius: defaultLengthExpression(5, unit),
    centered: false,
    ...defaultPrimitiveOriginValues(unit),
  }
  if (mode.kind === "create") return values
  if (primitiveKind === "sphere") {
    const parameters = sphereFeatureParametersSchema.parse(mode.feature.parameters)
    return {
      ...values,
      ...primitiveOriginFormValues(parameters.origin),
      radius: quantityExpression(parameters.radius),
    }
  }
  if (primitiveKind === "cone") {
    const parameters = coneFeatureParametersSchema.parse(mode.feature.parameters)
    return {
      ...values,
      ...primitiveOriginFormValues(parameters.origin),
      radius: quantityExpression(parameters.radius),
      height: quantityExpression(parameters.height),
      centered: parameters.centered,
    }
  }
  const parameters = torusFeatureParametersSchema.parse(mode.feature.parameters)
  return {
    ...values,
    ...primitiveOriginFormValues(parameters.origin),
    majorRadius: quantityExpression(parameters.majorRadius),
    minorRadius: quantityExpression(parameters.minorRadius),
  }
}

function parsePrimitiveDimensions(
  fields: readonly DimensionField[],
  values: PrimitiveFormValues,
  variables: readonly VariableDefinition[],
  copy: BasicPrimitiveFormCopy,
  displayUnit: DocumentDisplayUnits["length"],
) {
  const issues: Partial<Record<PrimitiveField, string>> = {}
  const dimensions: Partial<Record<DimensionField, LengthQuantity>> = {}
  for (const field of fields) {
    const parsed = parsePrimitiveLengthExpression(
      values[field],
      variables,
      copy,
      (quantity) => dimensionSchemas[field].safeParse(quantity).success,
      displayUnit,
    )
    if (parsed.ok) dimensions[field] = parsed.quantity
    else issues[field] = parsed.message
  }
  return { dimensions, issues }
}

function coupledPrimitiveIssues(
  primitiveKind: BasicPrimitiveKind,
  radiusOrderInvalid: boolean,
  copy: BasicPrimitiveFormCopy,
) {
  const issues: Partial<Record<PrimitiveField, string>> = {}
  const message = radiusOrderInvalid ? copy.invalidTorusRadii : copy.invalidWorkspaceBounds
  for (const field of primitiveDefinitions[primitiveKind].dimensions) issues[field] = message
  if (!radiusOrderInvalid) {
    for (const field of ["originX", "originY", "originZ"] as const) issues[field] = message
  }
  return issues
}

function parsePrimitiveValues(
  primitiveKind: BasicPrimitiveKind,
  values: PrimitiveFormValues,
  variables: readonly VariableDefinition[],
  copy: BasicPrimitiveFormCopy,
  displayUnit: DocumentDisplayUnits["length"],
) {
  const definition = primitiveDefinitions[primitiveKind]
  const origin = parsePrimitiveOriginValues(values, variables, copy, displayUnit)
  const { dimensions, issues: dimensionIssues } = parsePrimitiveDimensions(
    definition.dimensions,
    values,
    variables,
    copy,
    displayUnit,
  )
  const issues = { ...dimensionIssues, ...(origin.ok ? {} : origin.issues) }
  if (!origin.ok || Object.keys(issues).length > 0) return { ok: false as const, issues }
  const parsed = definition.schema.safeParse({
    ...dimensions,
    ...(primitiveKind === "cone" ? { centered: values.centered } : {}),
    origin: origin.origin,
  })
  if (!parsed.success) {
    const radiusOrderInvalid =
      primitiveKind === "torus" && parsed.error.issues.some(({ path }) => path[0] === "minorRadius")
    return {
      ok: false as const,
      issues: coupledPrimitiveIssues(primitiveKind, radiusOrderInvalid, copy),
    }
  }
  return { ok: true as const, parameters: parsed.data }
}

function primitiveFeatureRecord(
  primitiveKind: BasicPrimitiveKind,
  mode: BasicPrimitiveFormMode,
  featureId: FeatureId,
  parameters: Extract<ReturnType<typeof parsePrimitiveValues>, { ok: true }>,
) {
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, parameters: parameters.parameters }
      : {
          schemaVersion: 0,
          id: featureId,
          type: primitiveDefinitions[primitiveKind].type,
          parameters: parameters.parameters,
          dependencies: [],
          references: [],
          suppressed: false,
          label: mode.featureLabel,
        },
  )
}

type BasicPrimitiveFormProps = FeatureParameterFormProps<
  BasicPrimitiveFormMode,
  BasicPrimitiveFormCopy
> &
  Readonly<{
    primitiveKind: BasicPrimitiveKind
    onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
    placementRequest?: PrimitivePlacementRequest | null | undefined
  }>

function DebouncedPrimitivePreview({
  onPreviewChange,
  preview,
}: Readonly<{
  onPreviewChange: (feature: FeatureRecord | null) => void
  preview: FeatureRecord | null
}>) {
  useDebouncedFeaturePreview({ onPreviewChange, preview })
  return null
}

function PrimitiveValuesSync({
  copy,
  dirty,
  displayUnit,
  featureId,
  mode,
  onPreviewChange,
  onIssuesChange,
  primitiveKind,
  values,
  variables,
}: Readonly<{
  copy: BasicPrimitiveFormCopy
  dirty: boolean
  displayUnit: DocumentDisplayUnits["length"]
  featureId: FeatureId
  mode: BasicPrimitiveFormMode
  onPreviewChange: ((feature: FeatureRecord | null) => void) | undefined
  onIssuesChange: (issues: Partial<Record<PrimitiveField, string>>) => void
  primitiveKind: BasicPrimitiveKind
  values: PrimitiveFormValues
  variables: readonly VariableDefinition[]
}>) {
  const parsed = useMemo(
    () => parsePrimitiveValues(primitiveKind, values, variables, copy, displayUnit),
    [primitiveKind, values, variables, copy, displayUnit],
  )
  useEffect(() => {
    if (dirty) onIssuesChange(parsed.ok ? {} : parsed.issues)
  }, [dirty, onIssuesChange, parsed])
  return onPreviewChange ? (
    <DebouncedPrimitivePreview
      onPreviewChange={onPreviewChange}
      preview={parsed.ok ? primitiveFeatureRecord(primitiveKind, mode, featureId, parsed) : null}
    />
  ) : null
}

export function BasicPrimitiveForm({
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
  primitiveKind,
  variables,
}: BasicPrimitiveFormProps) {
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
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const dimensions = primitiveDefinitions[primitiveKind].dimensions
  const form = useAppForm({
    defaultValues: initialPrimitiveValues(primitiveKind, mode, displayUnits.length),
    onSubmit: async ({ value }) => {
      const parsed = parsePrimitiveValues(
        primitiveKind,
        value,
        variables,
        copy,
        displayUnits.length,
      )
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(copy.validationSummary)
        const firstField = ([...dimensions, "originX", "originY", "originZ"] as const).find(
          (field) => parsed.issues[field],
        )
        if (firstField) {
          formElementRef.current?.querySelector<HTMLElement>(`[name="${firstField}"]`)?.focus()
        }
        return
      }
      clearSubmissionErrors()
      await submitFeatureMutation({
        baseRevision,
        copy,
        feature: primitiveFeatureRecord(primitiveKind, mode, featureId, parsed),
        onSave,
        onSaved,
        setMessage,
      })
    },
  })

  usePrimitivePlacementRequest({
    disabled,
    displayUnit: displayUnits.length,
    featureId,
    form,
    onBeforeChange: clearSubmissionErrors,
    placementRequest,
  })

  const lengthField = (fieldName: PrimitiveField, description: string) => (
    <form.Field key={fieldName} name={fieldName}>
      {(field) => (
        <TanStackLengthExpressionField
          id={`${primitiveKind}-${fieldName}`}
          field={field}
          label={copy[fieldName]}
          description={description}
          error={issues[fieldName]}
          suggestions={suggestions}
          onBeforeChange={clearSubmissionErrors}
        />
      )}
    </form.Field>
  )

  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <form.Subscribe selector={(state) => [state.values, state.isDirty] as const}>
        {([values, dirty]) => (
          <PrimitiveValuesSync
            copy={copy}
            dirty={dirty}
            displayUnit={displayUnits.length}
            featureId={featureId}
            mode={mode}
            onPreviewChange={onPreviewChange}
            onIssuesChange={setIssues}
            primitiveKind={primitiveKind}
            values={values}
            variables={variables}
          />
        )}
      </form.Subscribe>
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
        fields={dimensions.map((field) => lengthField(field, copy.expressionDescription))}
        centeredField={
          primitiveKind === "cone" ? (
            <form.Field name="centered">
              {(field) => (
                <TanStackBooleanParameterField
                  field={field}
                  label={copy.centered}
                  onBeforeChange={clearSubmissionErrors}
                />
              )}
            </form.Field>
          ) : null
        }
        placementFields={(["originX", "originY", "originZ"] as const).map((field) =>
          lengthField(field, copy.positionDescription),
        )}
      />
    </Form>
  )
}
