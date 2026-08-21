import {
  datumPlaneFeatureType,
  datumPlaneParametersSchema,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type SketchFeatureFaceSupport,
} from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useRef, useState } from "react"
import {
  defaultLengthExpression,
  type useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { LengthExpressionField } from "../part-design/length-expression-field"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  parsePrimitiveLengthExpression,
  quantityExpression,
  submitFeatureMutation,
} from "../part-design/primitive-form"
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
    expressionDescription: string
    submit: string
    invalidExpression: string
    invalidDimension: string
    invalidRange: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }>

type DatumPlaneFormValues = Readonly<{ originPlane: OriginPlane; offset: string }>

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
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"],
): DatumPlaneFormValues {
  const parameters = parametersFromMode(mode)
  return {
    originPlane: parameters.support.kind === "origin-plane" ? parameters.support.plane : "xy",
    offset:
      mode.kind === "create"
        ? defaultLengthExpression(10, displayUnit)
        : quantityExpression(parameters.offset),
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

function parsedDatumPlaneRecord(
  values: DatumPlaneFormValues,
  mode: DatumPlaneFormMode,
  featureId: FeatureId,
  variables: Parameters<typeof parsePrimitiveLengthExpression>[1],
  copy: DatumPlaneFormCopy,
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"],
) {
  const offset = parsePrimitiveLengthExpression(
    values.offset,
    variables,
    copy,
    (quantity) => Math.abs(quantity.value) <= 1_000_000,
    displayUnit,
  )
  if (!offset.ok) return { ok: false as const, message: offset.message }
  const parameters = datumPlaneParametersSchema.parse({
    mode: "offset",
    support: supportFromMode(mode, values.originPlane),
    offset: offset.quantity,
  })
  return { ok: true as const, feature: datumPlaneRecord(mode, featureId, parameters) }
}

function DatumPlanePreviewSync({
  copy,
  displayUnit,
  featureId,
  mode,
  onPreviewChange,
  values,
  variables,
}: Readonly<{
  copy: DatumPlaneFormCopy
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"]
  featureId: FeatureId
  mode: DatumPlaneFormMode
  onPreviewChange: (feature: FeatureRecord | null) => void
  values: DatumPlaneFormValues
  variables: Parameters<typeof parsePrimitiveLengthExpression>[1]
}>) {
  const inputRef = useRef({ copy, displayUnit, mode, variables })
  inputRef.current = { copy, displayUnit, mode, variables }
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const input = inputRef.current
      const parsed = parsedDatumPlaneRecord(
        values,
        input.mode,
        featureId,
        input.variables,
        input.copy,
        input.displayUnit,
      )
      onPreviewChange(parsed.ok ? parsed.feature : null)
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [featureId, onPreviewChange, values])
  useEffect(() => () => onPreviewChange(null), [onPreviewChange])
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
  variables,
}: FeatureParameterFormProps<DatumPlaneFormMode, DatumPlaneFormCopy> &
  Readonly<{ onPreviewChange?: (feature: FeatureRecord | null) => void }>) {
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
  const parameters = parametersFromMode(mode)
  const faceSupported = parameters.support.kind === "feature-face"
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues: defaultValues(mode, displayUnits.length),
    onSubmit: async ({ value }) => {
      const parsed = parsedDatumPlaneRecord(
        value,
        mode,
        featureId,
        variables,
        copy,
        displayUnits.length,
      )
      if (!parsed.ok) {
        setIssues({ offset: parsed.message })
        setMessage(copy.validationSummary)
        formElementRef.current?.querySelector<HTMLElement>('[name="offset"]')?.focus()
        return
      }
      setIssues({})
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
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      {onPreviewChange ? (
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <DatumPlanePreviewSync
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
      <ParameterPanel
        copy={copy}
        disabled={disabled}
        footerAction={
          <form.SubmitButton disabled={disabled} requireDirty={false} size="sm">
            {copy.submit}
          </form.SubmitButton>
        }
        legend={copy.parameters}
        message={message}
        onCancel={onCancel}
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
        <form.Field name="offset">
          {(field) => (
            <LengthExpressionField
              id="datum-plane-offset"
              name={field.name}
              value={field.state.value}
              label={copy.offset}
              description={copy.expressionDescription}
              error={issues.offset}
              suggestions={suggestions}
              onBlur={field.handleBlur}
              onValueChange={(value) => {
                clearSubmissionErrors()
                field.handleChange(value)
              }}
            />
          )}
        </form.Field>
      </ParameterPanel>
    </Form>
  )
}
