import {
  coneFeatureParametersSchema,
  coneFeatureType,
  type DocumentDisplayUnits,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type LengthQuantity,
  pyramidFeatureParametersSchema,
  pyramidFeatureType,
  sphereFeatureParametersSchema,
  sphereFeatureType,
  torusFeatureParametersSchema,
  torusFeatureType,
  type VariableDefinition,
} from "@vibeshape/domain"
import { TextField } from "@vibeshape/ui/components/text-field"
import { Form, useStore } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import { defaultLengthExpression } from "../../document/document-display-units"
import { cadFormValidationLogic, useCadForm } from "./cad-form"
import { isFeaturePreviewReady } from "./feature-preview-readiness"
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

export type BasicPrimitiveKind = "sphere" | "cone" | "torus" | "pyramid"
const IGNORE_PREVIEW = () => undefined

type DimensionField = "radius" | "height" | "majorRadius" | "minorRadius"
type PrimitiveField = DimensionField | PrimitiveOriginField | "sides"
type PrimitiveFormValues = PrimitiveOriginFormValues &
  Readonly<Record<DimensionField, string>> &
  Readonly<{ centered: boolean; sides: string }>

export type BasicPrimitiveFormCopy = PrimitiveParameterPanelCopy &
  Readonly<Record<DimensionField | PrimitiveOriginField, string>> &
  Readonly<{
    sides: string
    sidesDescription: string
    invalidSides: string
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
  pyramid: {
    dimensions: ["radius", "height"],
    schema: pyramidFeatureParametersSchema,
    type: pyramidFeatureType.type,
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
    sides: "4",
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
  if (primitiveKind === "pyramid") {
    const parameters = pyramidFeatureParametersSchema.parse(mode.feature.parameters)
    return {
      ...values,
      ...primitiveOriginFormValues(parameters.origin),
      radius: quantityExpression(parameters.radius),
      height: quantityExpression(parameters.height),
      centered: parameters.centered,
      sides: String(parameters.sides),
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

function primitiveSideIssues(
  primitiveKind: BasicPrimitiveKind,
  values: PrimitiveFormValues,
  copy: BasicPrimitiveFormCopy,
): Partial<Record<PrimitiveField, string>> {
  if (primitiveKind !== "pyramid") return {}
  return pyramidFeatureParametersSchema.shape.sides.safeParse(Number(values.sides)).success
    ? {}
    : { sides: copy.invalidSides }
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
  const issues: Partial<Record<PrimitiveField, string>> = {
    ...dimensionIssues,
    ...(origin.ok ? {} : origin.issues),
    ...primitiveSideIssues(primitiveKind, values, copy),
  }
  if (!origin.ok || Object.keys(issues).length > 0) return { ok: false as const, issues }
  const parsed = definition.schema.safeParse({
    ...dimensions,
    ...(["cone", "pyramid"].includes(primitiveKind) ? { centered: values.centered } : {}),
    ...(primitiveKind === "pyramid" ? { sides: Number(values.sides) } : {}),
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

function useBasicPrimitiveDraft(props: BasicPrimitiveFormProps) {
  const {
    baseRevision,
    copy,
    disabled = false,
    mode,
    onPreviewChange,
    onSave,
    onSaved,
    placementRequest,
    primitiveKind,
    variables,
  } = props
  const { clearSubmissionErrors, displayUnits, message, setMessage, suggestions } =
    useParameterFormState(variables)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: initialPrimitiveValues(primitiveKind, mode, displayUnits.length),
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parsePrimitiveValues(
          primitiveKind,
          value,
          variables,
          copy,
          displayUnits.length,
        )
        return parsed.ok ? undefined : { form: copy.validationSummary, fields: parsed.issues }
      },
    },
    onSubmit: async ({ value }) => {
      if (disabled || !isFeaturePreviewReady(props.previewStatus)) return
      const parsed = parsePrimitiveValues(
        primitiveKind,
        value,
        variables,
        copy,
        displayUnits.length,
      )
      if (!parsed.ok) return
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

  const values = useStore(form.store, (state) => state.values)
  const parsed = parsePrimitiveValues(primitiveKind, values, variables, copy, displayUnits.length)
  const issues = parsed.ok ? {} : parsed.issues
  useDebouncedFeaturePreview({
    onPreviewChange: onPreviewChange ?? IGNORE_PREVIEW,
    preview: parsed.ok ? primitiveFeatureRecord(primitiveKind, mode, featureId, parsed) : null,
  })

  usePrimitivePlacementRequest({
    disabled,
    displayUnit: displayUnits.length,
    featureId,
    form,
    onBeforeChange: clearSubmissionErrors,
    placementRequest,
  })

  return { form, issues, suggestions, message, clearSubmissionErrors }
}

export function BasicPrimitiveForm(props: BasicPrimitiveFormProps) {
  const { copy, disabled = false, onCancel, previewStatus, primitiveKind } = props
  const { form, issues, suggestions, message, clearSubmissionErrors } =
    useBasicPrimitiveDraft(props)
  const dimensions = primitiveDefinitions[primitiveKind].dimensions

  const lengthField = (fieldName: Exclude<PrimitiveField, "sides">, description: string) => (
    <form.AppField key={fieldName} name={fieldName}>
      {(field) => (
        <field.LengthExpressionField
          id={`${primitiveKind}-${fieldName}`}
          label={copy[fieldName]}
          error={issues[fieldName]}
          description={description}
          suggestions={suggestions}
          onValueChange={clearSubmissionErrors}
        />
      )}
    </form.AppField>
  )

  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
        <PrimitiveParameterPanel
          previewStatus={previewStatus}
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
              {primitiveKind === "pyramid" ? (
                <form.Field name="sides">
                  {(field) => (
                    <TextField
                      id="pyramid-sides"
                      name={field.name}
                      value={field.state.value}
                      error={issues.sides}
                      onBlur={field.handleBlur}
                      type="number"
                      min={3}
                      max={64}
                      step={1}
                      required
                      label={copy.sides}
                      description={copy.sidesDescription}
                      onChange={(event) => {
                        clearSubmissionErrors()
                        field.handleChange(event.currentTarget.value)
                      }}
                    />
                  )}
                </form.Field>
              ) : null}
              {dimensions.map((field) => lengthField(field, copy.expressionDescription))}
            </>
          }
          centeredField={
            ["cone", "pyramid"].includes(primitiveKind) ? (
              <form.AppField name="centered">
                {(field) => (
                  <field.CheckboxField
                    label={copy.centered}
                    onValueChange={clearSubmissionErrors}
                  />
                )}
              </form.AppField>
            ) : null
          }
          placementFields={(["originX", "originY", "originZ"] as const).map((field) =>
            lengthField(field, copy.positionDescription),
          )}
        />
      </TaskPanelContentProvider>
    </Form>
  )
}
