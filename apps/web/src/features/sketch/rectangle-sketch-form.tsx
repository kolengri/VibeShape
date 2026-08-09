import {
  createRectangleSketch,
  type LengthQuantity,
  MAX_SKETCH_COORDINATE_MM,
  rectangleSketchDefinition,
  type SketchConstraintId,
  type SketchEntityId,
  type SketchId,
  type SketchRecord,
  updateRectangleSketch,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useRef, useState } from "react"
import type { SketchMutationResult } from "../../document/document-controller"
import { LengthExpressionField } from "../part-design/length-expression-field"
import {
  featureSubmissionMessage,
  parsePrimitiveLengthExpression,
  quantityExpression,
} from "../part-design/primitive-form"
import {
  RectangleSketchParameterPanel,
  type RectangleSketchParameterPanelCopy,
} from "./rectangle-sketch-parameter-panel"

type DimensionField = "width" | "height"

export type RectangleSketchPreview = Readonly<{
  height: number
  plane: SketchRecord["plane"]
  width: number
}>

type RectangleSketchFormCopy = RectangleSketchParameterPanelCopy &
  Readonly<{
    expressionDescription: string
    height: string
    invalidDimension: string
    invalidExpression: string
    invalidRange: string
    plane: string
    planeDescription: string
    planeXy: string
    planeXz: string
    planeYz: string
    saveFailed: string
    staleRevision: string
    submit: string
    validationSummary: string
    width: string
  }>

type RectangleSketchFormValues = Readonly<{
  height: string
  plane: SketchRecord["plane"]
  width: string
}>

type ParsedRectangleValues = Readonly<{
  height: LengthQuantity
  plane: SketchRecord["plane"]
  width: LengthQuantity
}>

type FieldIssues = Readonly<Partial<Record<DimensionField, string>>>

const DEFAULT_VALUES: RectangleSketchFormValues = {
  width: "40 mm",
  height: "30 mm",
  plane: "xy",
}

const ignorePreview = () => undefined

export type RectangleSketchFormMode =
  | Readonly<{
      createConstraintId: () => SketchConstraintId
      createEntityId: () => SketchEntityId
      createSketchId: () => SketchId
      kind: "create"
      sketchLabel: string
    }>
  | Readonly<{
      kind: "edit"
      sketch: SketchRecord
    }>

function formValuesFromSketch(sketch: SketchRecord): RectangleSketchFormValues {
  const definition = rectangleSketchDefinition(sketch)
  if (!definition) throw new TypeError("The sketch is not a supported rectangular sketch.")
  return {
    width: quantityExpression(definition.width),
    height: quantityExpression(definition.height),
    plane: definition.plane,
  }
}

function parseRectangleValues(
  values: RectangleSketchFormValues,
  variables: readonly VariableDefinition[],
  copy: RectangleSketchFormCopy,
): { ok: true; value: ParsedRectangleValues } | { ok: false; issues: FieldIssues } {
  const accepts = (quantity: LengthQuantity) =>
    quantity.value > 0 && quantity.value <= MAX_SKETCH_COORDINATE_MM
  const parsed = {
    width: parsePrimitiveLengthExpression(values.width, variables, copy, accepts),
    height: parsePrimitiveLengthExpression(values.height, variables, copy, accepts),
  }
  const issues: Partial<Record<DimensionField, string>> = {}
  if (!parsed.width.ok) issues.width = parsed.width.message
  if (!parsed.height.ok) issues.height = parsed.height.message
  if (!parsed.width.ok || !parsed.height.ok) return { ok: false, issues }
  return {
    ok: true,
    value: { width: parsed.width.quantity, height: parsed.height.quantity, plane: values.plane },
  }
}

function sketchRecord(mode: RectangleSketchFormMode, values: ParsedRectangleValues) {
  if (mode.kind === "edit") return updateRectangleSketch(mode.sketch, values)
  return createRectangleSketch({
    ...values,
    id: mode.createSketchId(),
    label: mode.sketchLabel,
    createEntityId: mode.createEntityId,
    createConstraintId: mode.createConstraintId,
  })
}

function PreviewPublisher({
  copy,
  onPreview,
  values,
  variables,
}: {
  copy: RectangleSketchFormCopy
  onPreview: (preview: RectangleSketchPreview | null) => void
  values: RectangleSketchFormValues
  variables: readonly VariableDefinition[]
}) {
  useEffect(() => {
    const parsed = parseRectangleValues(values, variables, copy)
    onPreview(
      parsed.ok
        ? {
            width: parsed.value.width.value,
            height: parsed.value.height.value,
            plane: parsed.value.plane,
          }
        : null,
    )
  }, [copy, onPreview, values, variables])

  useEffect(() => () => onPreview(null), [onPreview])
  return null
}

export function RectangleSketchForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onPreview = ignorePreview,
  onSave,
  onSaved,
  variables,
}: {
  baseRevision: number
  copy: RectangleSketchFormCopy
  disabled?: boolean
  mode: RectangleSketchFormMode
  onCancel: () => void
  onPreview?: (preview: RectangleSketchPreview | null) => void
  onSave: (baseRevision: number, sketch: SketchRecord) => Promise<SketchMutationResult>
  onSaved: (sketch: SketchRecord) => void
  variables: readonly VariableDefinition[]
}) {
  const formElementRef = useRef<HTMLFormElement>(null)
  const [issues, setIssues] = useState<FieldIssues>({})
  const [message, setMessage] = useState<string | null>(null)
  const defaultValues = mode.kind === "edit" ? formValuesFromSketch(mode.sketch) : DEFAULT_VALUES
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const parsed = parseRectangleValues(value, variables, copy)
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(copy.validationSummary)
        const firstField = (["width", "height"] as const).find((field) => parsed.issues[field])
        if (firstField) {
          formElementRef.current?.querySelector<HTMLElement>(`[name="${firstField}"]`)?.focus()
        }
        return
      }
      setIssues({})
      setMessage(null)
      const sketch = sketchRecord(mode, parsed.value)
      const result = await onSave(baseRevision, sketch)
      const resultMessage = featureSubmissionMessage(result, copy)
      setMessage(resultMessage)
      if (!resultMessage) onSaved(sketch)
    },
  })

  const clearSubmissionErrors = () => {
    if (Object.keys(issues).length > 0) setIssues({})
    if (message) setMessage(null)
  }

  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <form.Subscribe selector={(formState) => formState.values}>
        {(values) => (
          <PreviewPublisher
            copy={copy}
            onPreview={onPreview}
            values={values}
            variables={variables}
          />
        )}
      </form.Subscribe>
      <RectangleSketchParameterPanel
        copy={copy}
        disabled={disabled}
        message={message}
        planeField={
          <form.Field name="plane">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="rectangle-sketch-plane" required>
                  {copy.plane}
                </FieldLabel>
                <NativeSelect
                  id="rectangle-sketch-plane"
                  name={field.name}
                  value={field.state.value}
                  aria-describedby="rectangle-sketch-plane-description"
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    clearSubmissionErrors()
                    field.handleChange(event.currentTarget.value as SketchRecord["plane"])
                  }}
                >
                  <option value="xy">{copy.planeXy}</option>
                  <option value="xz">{copy.planeXz}</option>
                  <option value="yz">{copy.planeYz}</option>
                </NativeSelect>
                <p
                  id="rectangle-sketch-plane-description"
                  className="text-xs leading-4 text-muted-foreground"
                >
                  {copy.planeDescription}
                </p>
              </Field>
            )}
          </form.Field>
        }
        fields={
          <>
            <form.Field name="width">
              {(field) => (
                <LengthExpressionField
                  id="rectangle-sketch-width"
                  name={field.name}
                  value={field.state.value}
                  label={copy.width}
                  description={copy.expressionDescription}
                  error={issues.width}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    clearSubmissionErrors()
                    field.handleChange(event.currentTarget.value)
                  }}
                />
              )}
            </form.Field>
            <form.Field name="height">
              {(field) => (
                <LengthExpressionField
                  id="rectangle-sketch-height"
                  name={field.name}
                  value={field.state.value}
                  label={copy.height}
                  description={copy.expressionDescription}
                  error={issues.height}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    clearSubmissionErrors()
                    field.handleChange(event.currentTarget.value)
                  }}
                />
              )}
            </form.Field>
          </>
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
