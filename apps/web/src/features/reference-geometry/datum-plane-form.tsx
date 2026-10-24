import {
  createAngleQuantity,
  datumPlaneFeatureType,
  datumPlaneParametersSchema,
  evaluateExpression,
  evaluateVariableDefinitions,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type SketchFeatureFaceSupport,
} from "@vibeshape/domain"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  normalizeExpressionWithDisplayUnit,
  type useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  parsePrimitiveLengthExpression,
  quantityExpression,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"

type OriginPlane = "xy" | "xz" | "yz"

export type DatumPlaneFormMode =
  | Readonly<{
      kind: "create"
      createFeatureId: () => FeatureId
      featureLabel: string
      support?: SketchFeatureFaceSupport
    }>
  | Readonly<{ kind: "edit"; feature: FeatureRecord }>

export type DatumPlaneFormCopy = ParameterPanelCopy &
  Readonly<{
    parameters: string
    support: string
    supportDescription: string
    selectedFace: string
    planeXy: string
    planeXz: string
    planeYz: string
    offset: string
    angle: string
    angleDescription: string
    rotationAxis: string
    rotationAxisX: string
    rotationAxisY: string
    rotationDescription: string
    expressionDescription: string
    submit: string
    invalidExpression: string
    invalidDimension: string
    invalidRange: string
    invalidAngleDimension: string
    invalidAngleRange: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }>

type DatumPlaneFormValues = Readonly<{
  originPlane: OriginPlane
  offset: string
  angle: string
  rotationAxis: "x" | "y"
}>

function parametersFromMode(mode: DatumPlaneFormMode) {
  if (mode.kind === "edit") return datumPlaneParametersSchema.parse(mode.feature.parameters)
  return datumPlaneParametersSchema.parse({
    mode: "offset",
    support: mode.support
      ? { kind: "feature-face", reference: mode.support.reference }
      : { kind: "origin-plane", plane: "xy" },
    offset: {
      schemaVersion: 0,
      dimension: "length",
      value: 10,
      unit: "mm",
      source: { value: 10, unit: "mm", expression: "10 mm" },
    },
  })
}

function defaultValues(
  mode: DatumPlaneFormMode,
  displayUnits: ReturnType<typeof useDocumentDisplayUnits>,
): DatumPlaneFormValues {
  const parameters = parametersFromMode(mode)
  return {
    originPlane: parameters.support.kind === "origin-plane" ? parameters.support.plane : "xy",
    offset:
      mode.kind === "create"
        ? defaultLengthExpression(10, displayUnits.length)
        : quantityExpression(parameters.offset),
    angle: parameters.rotation
      ? (parameters.rotation.angle.source.expression ??
        `${parameters.rotation.angle.source.value} ${parameters.rotation.angle.source.unit}`)
      : defaultAngleExpression(0, displayUnits.angle),
    rotationAxis: parameters.rotation?.axis ?? "x",
  }
}

function supportFromMode(mode: DatumPlaneFormMode, originPlane: OriginPlane) {
  if (mode.kind === "create" && mode.support) {
    return { kind: "feature-face" as const, reference: mode.support.reference }
  }
  if (mode.kind === "edit") {
    const support = parametersFromMode(mode).support
    if (support.kind === "feature-face") return support
  }
  return { kind: "origin-plane" as const, plane: originPlane }
}

function datumPlaneRecord(
  mode: DatumPlaneFormMode,
  featureId: FeatureId,
  parameters: ReturnType<typeof datumPlaneParametersSchema.parse>,
) {
  const supportReference =
    parameters.support.kind === "feature-face" ? parameters.support.reference : null
  if (mode.kind === "edit") {
    return featureRecordSchema.parse({
      ...mode.feature,
      type: datumPlaneFeatureType.type,
      parameters,
      dependencies: supportReference ? [supportReference.featureId] : [],
      references: supportReference ? [supportReference] : [],
    })
  }
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: datumPlaneFeatureType.type,
    parameters,
    dependencies: supportReference ? [supportReference.featureId] : [],
    references: supportReference ? [supportReference] : [],
    suppressed: false,
    label: mode.featureLabel,
  })
}

function parseDatumAngle(
  raw: string,
  variables: Parameters<typeof parsePrimitiveLengthExpression>[1],
  copy: DatumPlaneFormCopy,
  unit: ReturnType<typeof useDocumentDisplayUnits>["angle"],
) {
  const values = evaluateVariableDefinitions(variables)
  const expression = normalizeExpressionWithDisplayUnit(raw, unit)
  const evaluated = values.ok ? evaluateExpression(expression, values.valuesByName) : null
  if (!evaluated?.ok) return { ok: false as const, message: copy.invalidExpression }
  if (evaluated.value.dimension !== "angle")
    return { ok: false as const, message: copy.invalidAngleDimension }
  if (!Number.isFinite(evaluated.value.value) || Math.abs(evaluated.value.value) > Math.PI * 2)
    return { ok: false as const, message: copy.invalidAngleRange }
  return {
    ok: true as const,
    quantity: createAngleQuantity(evaluated.value.value, "rad", expression),
  }
}

function parsedDatumPlaneRecord(
  values: DatumPlaneFormValues,
  mode: DatumPlaneFormMode,
  featureId: FeatureId,
  variables: Parameters<typeof parsePrimitiveLengthExpression>[1],
  copy: DatumPlaneFormCopy,
  displayUnits: ReturnType<typeof useDocumentDisplayUnits>,
) {
  const offset = parsePrimitiveLengthExpression(
    values.offset,
    variables,
    copy,
    (quantity) => Math.abs(quantity.value) <= 1_000_000,
    displayUnits.length,
  )
  if (!offset.ok) return { ok: false as const, field: "offset", message: offset.message }
  const angle = parseDatumAngle(values.angle, variables, copy, displayUnits.angle)
  if (!angle.ok) return { ok: false as const, field: "angle", message: angle.message }
  const parameters = datumPlaneParametersSchema.parse({
    mode: "offset",
    support: supportFromMode(mode, values.originPlane),
    offset: offset.quantity,
    rotation: { axis: values.rotationAxis, angle: angle.quantity },
  })
  return { ok: true as const, feature: datumPlaneRecord(mode, featureId, parameters) }
}

function DatumPlanePreviewSync({
  copy,
  displayUnits,
  featureId,
  mode,
  onPreviewChange,
  values,
  variables,
}: Readonly<{
  copy: DatumPlaneFormCopy
  displayUnits: ReturnType<typeof useDocumentDisplayUnits>
  featureId: FeatureId
  mode: DatumPlaneFormMode
  onPreviewChange: (feature: FeatureRecord | null) => void
  values: DatumPlaneFormValues
  variables: Parameters<typeof parsePrimitiveLengthExpression>[1]
}>) {
  const parsed = parsedDatumPlaneRecord(values, mode, featureId, variables, copy, displayUnits)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: parsed.ok ? parsed.feature : null,
  })
  return null
}

export function DatumPlaneForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onSave,
  onSaved,
  onPreviewChange,
  previewStatus,
  variables,
}: FeatureParameterFormProps<DatumPlaneFormMode, DatumPlaneFormCopy> &
  Readonly<{ onPreviewChange?: (feature: FeatureRecord | null) => void }>) {
  const { clearSubmissionErrors, displayUnits, message, setMessage, suggestions } =
    useParameterFormState(variables)
  const parameters = parametersFromMode(mode)
  const faceSupported = parameters.support.kind === "feature-face"
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: defaultValues(mode, displayUnits),
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parsedDatumPlaneRecord(value, mode, featureId, variables, copy, displayUnits)
        return parsed.ok
          ? undefined
          : { form: copy.validationSummary, fields: { [parsed.field]: parsed.message } }
      },
    },
    onSubmit: async ({ value }) => {
      if (disabled || !isFeaturePreviewReady(previewStatus)) return
      const parsed = parsedDatumPlaneRecord(value, mode, featureId, variables, copy, displayUnits)
      if (!parsed.ok) return

      setMessage(null)
      await submitFeatureMutation({
        baseRevision,
        copy,
        feature: parsed.feature,
        onSave,
        onSaved,
        setMessage,
      })
    },
  })

  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
        {onPreviewChange ? (
          <form.Subscribe selector={(state) => state.values}>
            {(values) => (
              <DatumPlanePreviewSync
                copy={copy}
                displayUnits={displayUnits}
                featureId={featureId}
                mode={mode}
                onPreviewChange={onPreviewChange}
                values={values}
                variables={variables}
              />
            )}
          </form.Subscribe>
        ) : null}
        <ParameterPanel
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
          legend={copy.parameters}
          message={message}
        >
          <form.AppField name="originPlane">
            {(field) => (
              <field.NativeSelectField
                disabled={faceSupported}
                label={copy.support}
                description={copy.supportDescription}
                onValueChange={clearSubmissionErrors}
              >
                {faceSupported ? <option value="xy">{copy.selectedFace}</option> : null}
                {!faceSupported ? (
                  <>
                    <option value="xy">{copy.planeXy}</option>
                    <option value="xz">{copy.planeXz}</option>
                    <option value="yz">{copy.planeYz}</option>
                  </>
                ) : null}
              </field.NativeSelectField>
            )}
          </form.AppField>
          <form.AppField name="offset">
            {(field) => (
              <field.LengthExpressionField
                id="datum-plane-offset"
                label={copy.offset}
                description={copy.expressionDescription}
                suggestions={suggestions}
                onValueChange={() => {
                  clearSubmissionErrors()
                }}
              />
            )}
          </form.AppField>
          <form.AppField name="rotationAxis">
            {(field) => (
              <field.NativeSelectField
                label={copy.rotationAxis}
                description={copy.rotationDescription}
                onValueChange={clearSubmissionErrors}
              >
                <option value="x">{copy.rotationAxisX}</option>
                <option value="y">{copy.rotationAxisY}</option>
              </field.NativeSelectField>
            )}
          </form.AppField>
          <form.AppField name="angle">
            {(field) => (
              <field.VariableExpressionField
                id="datum-plane-angle"
                label={copy.angle}
                description={copy.angleDescription}
                suggestions={suggestions}
                onValueChange={() => {
                  clearSubmissionErrors()
                }}
              />
            )}
          </form.AppField>
        </ParameterPanel>
      </TaskPanelContentProvider>
    </Form>
  )
}
