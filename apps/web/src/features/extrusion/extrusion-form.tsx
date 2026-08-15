import {
  extrusionFeatureParametersSchema,
  extrusionFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type SketchProfileSelector,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useRef, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultLengthExpression,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { TanStackBooleanParameterField } from "../part-design/boolean-parameter-field"
import { LengthExpressionField } from "../part-design/length-expression-field"
import {
  parsePrimitiveLengthExpression,
  quantityExpression,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import {
  ExtrusionParameterPanel,
  type ExtrusionParameterPanelCopy,
} from "./extrusion-parameter-panel"

type ExtrusionFormCopy = ExtrusionParameterPanelCopy &
  Readonly<{
    distance: string
    expressionDescription: string
    invalidDimension: string
    invalidExpression: string
    invalidRange: string
    saveFailed: string
    staleRevision: string
    submit: string
    symmetric: string
    validationSummary: string
  }>

type ExtrusionFormValues = Readonly<{
  distance: string
  symmetric: boolean
}>

type FieldIssues = Readonly<Partial<Record<"distance", string>>>

function defaultValues(
  unit: ReturnType<typeof useDocumentDisplayUnits>["length"],
): ExtrusionFormValues {
  return { distance: defaultLengthExpression(10, unit), symmetric: false }
}

export type ExtrusionFormMode =
  | Readonly<{
      createFeatureId: () => FeatureId
      featureLabel: string
      kind: "create"
      profile: SketchProfileSelector
    }>
  | Readonly<{
      feature: FeatureRecord
      kind: "edit"
    }>

function valuesFromFeature(feature: FeatureRecord): ExtrusionFormValues {
  const parameters = extrusionFeatureParametersSchema.parse(feature.parameters)
  return {
    distance: quantityExpression(parameters.distance),
    symmetric: parameters.symmetric,
  }
}

function profileForMode(mode: ExtrusionFormMode) {
  return mode.kind === "create"
    ? mode.profile
    : extrusionFeatureParametersSchema.parse(mode.feature.parameters).profile
}

function extrusionRecord(
  mode: ExtrusionFormMode,
  parameters: ReturnType<typeof extrusionFeatureParametersSchema.parse>,
) {
  if (mode.kind === "edit") return featureRecordSchema.parse({ ...mode.feature, parameters })
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: mode.createFeatureId(),
    type: extrusionFeatureType.type,
    parameters,
    dependencies: [],
    references: [],
    suppressed: false,
    label: mode.featureLabel,
  })
}

function parseValues(
  values: ExtrusionFormValues,
  profile: SketchProfileSelector,
  variables: readonly VariableDefinition[],
  copy: ExtrusionFormCopy,
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"],
) {
  const distance = parsePrimitiveLengthExpression(
    values.distance,
    variables,
    copy,
    (quantity) => extrusionFeatureParametersSchema.shape.distance.safeParse(quantity).success,
    displayUnit,
  )
  if (!distance.ok) return { ok: false as const, issues: { distance: distance.message } }
  return {
    ok: true as const,
    parameters: extrusionFeatureParametersSchema.parse({
      profile,
      distance: distance.quantity,
      symmetric: values.symmetric,
      operation: "new",
    }),
  }
}

export function ExtrusionForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onSave,
  onSaved,
  profileLabel,
  variables,
}: {
  baseRevision: number
  copy: ExtrusionFormCopy
  disabled?: boolean
  mode: ExtrusionFormMode
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  profileLabel: string
  variables: readonly VariableDefinition[]
}) {
  const formElementRef = useRef<HTMLFormElement>(null)
  const displayUnits = useDocumentDisplayUnits()
  const [issues, setIssues] = useState<FieldIssues>({})
  const [message, setMessage] = useState<string | null>(null)
  const profile = profileForMode(mode)
  const form = useAppForm({
    defaultValues:
      mode.kind === "edit" ? valuesFromFeature(mode.feature) : defaultValues(displayUnits.length),
    onSubmit: async ({ value }) => {
      const parsed = parseValues(value, profile, variables, copy, displayUnits.length)
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(copy.validationSummary)
        formElementRef.current?.querySelector<HTMLElement>('[name="distance"]')?.focus()
        return
      }
      setIssues({})
      setMessage(null)
      await submitFeatureMutation({
        baseRevision,
        copy,
        feature: extrusionRecord(mode, parsed.parameters),
        onSave,
        onSaved,
        setMessage,
      })
    },
  })

  const clearSubmissionErrors = () => {
    if (issues.distance) setIssues({})
    if (message) setMessage(null)
  }

  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <ExtrusionParameterPanel
        copy={copy}
        disabled={disabled}
        message={message}
        profileLabel={profileLabel}
        distanceField={
          <form.Field name="distance">
            {(field) => (
              <LengthExpressionField
                id="extrusion-distance"
                name={field.name}
                value={field.state.value}
                label={copy.distance}
                description={copy.expressionDescription}
                error={issues.distance}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  clearSubmissionErrors()
                  field.handleChange(event.currentTarget.value)
                }}
              />
            )}
          </form.Field>
        }
        symmetricField={
          <form.Field name="symmetric">
            {(field) => (
              <TanStackBooleanParameterField
                field={field}
                label={copy.symmetric}
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
