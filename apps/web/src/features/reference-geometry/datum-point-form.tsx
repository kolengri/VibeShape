import {
  type DatumPointParameters,
  datumPointFeatureType,
  datumPointParametersSchema,
  datumPointSupportFeatureId,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  readDatumPointFeatureParameters,
} from "@vibeshape/domain"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import {
  defaultLengthExpression,
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
import type { DatumPointOptions } from "./datum-point-options"

type PointMode = DatumPointParameters["mode"]
type Variables = Parameters<typeof parsePrimitiveLengthExpression>[1]
type DisplayUnits = ReturnType<typeof useDocumentDisplayUnits>

/** The saved reference stays authoritative until the user explicitly picks a replacement. */
const SAVED_REFERENCE = "saved"

export type DatumPointFormMode =
  | Readonly<{ kind: "create"; createFeatureId: () => FeatureId; featureLabel: string }>
  | Readonly<{ kind: "edit"; feature: FeatureRecord }>

export type DatumPointSavedReferenceStatus = "resolved" | "missing" | "ambiguous" | "not-circular"

export type DatumPointFormCopy = ParameterPanelCopy &
  Readonly<{
    parameters: string
    mode: string
    modeDescription: string
    modeCoordinates: string
    modeVertex: string
    modeCircleCenter: string
    x: string
    y: string
    z: string
    coordinateDescription: string
    vertex: string
    vertexDescription: string
    circle: string
    circleDescription: string
    savedReference: string
    unavailableReference: string
    chooseReference: string
    noCandidates: string
    submit: string
    invalidExpression: string
    invalidDimension: string
    invalidRange: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }>

type Values = Readonly<{
  mode: PointMode
  x: string
  y: string
  z: string
  vertexKey: string
  circleKey: string
}>

type ParseContext = Readonly<{
  copy: DatumPointFormCopy
  displayUnits: DisplayUnits
  featureId: FeatureId
  mode: DatumPointFormMode
  options: DatumPointOptions
  savedStatus: DatumPointSavedReferenceStatus | null
  variables: Variables
}>

function savedParameters(mode: DatumPointFormMode) {
  return mode.kind === "edit" ? readDatumPointFeatureParameters(mode.feature) : null
}

function initialValues(context: ParseContext): Values {
  const saved = savedParameters(context.mode)
  const origin = defaultLengthExpression(0, context.displayUnits.length)
  const coordinates =
    saved?.mode === "coordinates"
      ? {
          x: quantityExpression(saved.position.x),
          y: quantityExpression(saved.position.y),
          z: quantityExpression(saved.position.z),
        }
      : { x: origin, y: origin, z: origin }
  return {
    mode: saved?.mode ?? "coordinates",
    ...coordinates,
    vertexKey: saved?.mode === "vertex" ? SAVED_REFERENCE : "",
    circleKey: saved?.mode === "circle-center" ? SAVED_REFERENCE : "",
  }
}

function parseCoordinates(values: Values, context: ParseContext) {
  const issues: Record<string, string> = {}
  const position: Record<string, unknown> = {}
  for (const axis of ["x", "y", "z"] as const) {
    const parsed = parsePrimitiveLengthExpression(
      values[axis],
      context.variables,
      context.copy,
      (quantity) => Math.abs(quantity.value) <= 100_000,
      context.displayUnits.length,
    )
    if (parsed.ok) position[axis] = parsed.quantity
    else issues[axis] = parsed.message
  }
  return Object.keys(issues).length > 0
    ? { ok: false as const, issues }
    : { ok: true as const, parameters: { mode: "coordinates", position } }
}

function parseReference(values: Values, context: ParseContext) {
  const field = values.mode === "vertex" ? "vertexKey" : "circleKey"
  const key = values[field]
  const saved = savedParameters(context.mode)
  if (key === SAVED_REFERENCE && saved?.mode === values.mode) {
    // A missing or ambiguous saved reference blocks save until it is explicitly replaced.
    return context.savedStatus === "resolved"
      ? { ok: true as const, parameters: saved }
      : { ok: false as const, issues: { [field]: context.copy.unavailableReference } }
  }
  const list = values.mode === "vertex" ? context.options.vertices : context.options.circles
  const option = list.find((candidate) => candidate.key === key)
  return option
    ? { ok: true as const, parameters: { mode: values.mode, reference: option.reference } }
    : { ok: false as const, issues: { [field]: context.copy.chooseReference } }
}

function parseValues(values: Values, context: ParseContext) {
  const parsed =
    values.mode === "coordinates"
      ? parseCoordinates(values, context)
      : parseReference(values, context)
  if (!parsed.ok) return parsed
  const parameters = datumPointParametersSchema.safeParse(parsed.parameters)
  if (!parameters.success)
    return { ok: false as const, issues: { mode: context.copy.invalidRange } }
  const owner = datumPointSupportFeatureId(parameters.data)
  const { mode, featureId } = context
  const feature = featureRecordSchema.parse({
    ...(mode.kind === "edit"
      ? mode.feature
      : { schemaVersion: 0, id: featureId, suppressed: false, label: mode.featureLabel }),
    type: datumPointFeatureType.type,
    parameters: parameters.data,
    dependencies: owner ? [owner] : [],
    references: [],
  })
  return { ok: true as const, feature }
}

function DatumPointPreviewSync({
  context,
  onPreviewChange,
  values,
}: Readonly<{
  context: ParseContext
  onPreviewChange: (feature: FeatureRecord | null) => void
  values: Values
}>) {
  const parsed = parseValues(values, context)
  useDebouncedFeaturePreview({ onPreviewChange, preview: parsed.ok ? parsed.feature : null })
  return null
}

function ReferenceOptions({
  copy,
  list,
  mode,
  savedStatus,
}: Readonly<{
  copy: DatumPointFormCopy
  list: DatumPointOptions["vertices"] | DatumPointOptions["circles"]
  mode: DatumPointFormMode
  savedStatus: DatumPointSavedReferenceStatus | null
}>) {
  return (
    <>
      <option value="">{list.length > 0 ? copy.chooseReference : copy.noCandidates}</option>
      {mode.kind === "edit" && savedStatus !== null ? (
        <option value={SAVED_REFERENCE}>
          {savedStatus === "resolved" ? copy.savedReference : copy.unavailableReference}
        </option>
      ) : null}
      {list.map((option) => (
        <option key={option.key} value={option.key}>
          {option.label}
        </option>
      ))}
    </>
  )
}

export function DatumPointForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onSave,
  onSaved,
  onPreviewChange,
  options,
  previewStatus,
  savedStatus,
  variables,
}: FeatureParameterFormProps<DatumPointFormMode, DatumPointFormCopy> &
  Readonly<{
    onPreviewChange?: (feature: FeatureRecord | null) => void
    options: DatumPointOptions
    savedStatus: DatumPointSavedReferenceStatus | null
  }>) {
  const { clearSubmissionErrors, displayUnits, message, setMessage, suggestions } =
    useParameterFormState(variables)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const context: ParseContext = {
    copy,
    displayUnits,
    featureId,
    mode,
    options,
    savedStatus,
    variables,
  }
  const [initial] = useState(() => initialValues(context))
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: initial,
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parseValues(value, context)
        return parsed.ok ? undefined : { form: copy.validationSummary, fields: parsed.issues }
      },
    },
    onSubmit: async ({ value }) => {
      if (disabled || !isFeaturePreviewReady(previewStatus)) return
      const parsed = parseValues(value, context)
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
  const coordinateField = (axis: "x" | "y" | "z") => (
    <form.AppField key={axis} name={axis}>
      {(field) => (
        <field.LengthExpressionField
          id={`datum-point-${axis}`}
          label={copy[axis]}
          description={copy.coordinateDescription}
          suggestions={suggestions}
          onValueChange={() => {
            clearSubmissionErrors()
          }}
        />
      )}
    </form.AppField>
  )
  const referenceField = (field: "vertexKey" | "circleKey") => {
    const vertex = field === "vertexKey"
    return (
      <form.AppField name={field}>
        {(fieldApi) => (
          <fieldApi.NativeSelectField
            label={vertex ? copy.vertex : copy.circle}
            description={vertex ? copy.vertexDescription : copy.circleDescription}
            onValueChange={clearSubmissionErrors}
          >
            <ReferenceOptions
              copy={copy}
              list={vertex ? options.vertices : options.circles}
              mode={mode}
              savedStatus={
                savedParameters(mode)?.mode === (vertex ? "vertex" : "circle-center")
                  ? savedStatus
                  : null
              }
            />
          </fieldApi.NativeSelectField>
        )}
      </form.AppField>
    )
  }
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
              <DatumPointPreviewSync
                context={context}
                onPreviewChange={onPreviewChange}
                values={values}
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
          <form.AppField name="mode">
            {(field) => (
              <field.NativeSelectField
                label={copy.mode}
                description={copy.modeDescription}
                onValueChange={clearSubmissionErrors}
              >
                <option value="coordinates">{copy.modeCoordinates}</option>
                <option value="vertex">{copy.modeVertex}</option>
                <option value="circle-center">{copy.modeCircleCenter}</option>
              </field.NativeSelectField>
            )}
          </form.AppField>
          <form.Subscribe selector={(state) => state.values.mode}>
            {(pointMode) =>
              pointMode === "coordinates"
                ? (["x", "y", "z"] as const).map(coordinateField)
                : referenceField(pointMode === "vertex" ? "vertexKey" : "circleKey")
            }
          </form.Subscribe>
        </ParameterPanel>
      </TaskPanelContentProvider>
    </Form>
  )
}
