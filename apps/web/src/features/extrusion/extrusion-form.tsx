import {
  extrusionFeatureParametersSchema,
  extrusionFeatureType,
  extrusionOperationSchema,
  type FeatureId,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
  type SketchProfileSelector,
  type TopoRef,
  type VariableDefinition,
} from "@vibeshape/domain"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useCallback, useLayoutEffect, useState } from "react"
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
  profileSelectorsEqual,
  topologyReferencesEqual,
} from "../part-design/profile-feature-selection"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
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
    missingTarget: string
    operation: string
    operationAdd: string
    operationIntersect: string
    operationNew: string
    operationRemove: string
    saveFailed: string
    staleRevision: string
    submit: string
    symmetric: string
    target: string
    targetDescription: string
    validationSummary: string
  }>

type ExtrusionFormValues = Readonly<{
  distance: string
  operation: string
  profile: SketchProfileSelector
  supportReference: TopoRef | null
  symmetric: boolean
  targetFeatureId: string
}>

export type ExtrusionTargetOption = Readonly<{
  id: FeatureId
  label: string
}>

function defaultValues(
  unit: ReturnType<typeof useDocumentDisplayUnits>["length"],
  options: readonly ExtrusionTargetOption[],
  profile: SketchProfileSelector,
  supportReference: TopoRef | undefined,
): ExtrusionFormValues {
  return {
    distance: defaultLengthExpression(10, unit),
    operation: "new",
    profile,
    supportReference: supportReference ?? null,
    symmetric: false,
    targetFeatureId: options[0]?.id ?? "",
  }
}

export type ExtrusionFormMode =
  | Readonly<{
      createFeatureId: () => FeatureId
      featureLabel: string
      kind: "create"
      profile: SketchProfileSelector
      supportReference?: TopoRef
    }>
  | Readonly<{
      feature: FeatureRecord
      kind: "edit"
      profile: SketchProfileSelector
      supportReference?: TopoRef
    }>

function valuesFromFeature(
  feature: FeatureRecord,
  profile: SketchProfileSelector,
  supportReference: TopoRef | undefined,
): ExtrusionFormValues {
  const parameters = extrusionFeatureParametersSchema.parse(feature.parameters)
  return {
    distance: quantityExpression(parameters.distance),
    operation: parameters.operation,
    profile,
    supportReference: supportReference ?? null,
    symmetric: parameters.symmetric,
    targetFeatureId: feature.dependencies[0] ?? "",
  }
}

function extrusionRecord(
  mode: ExtrusionFormMode,
  featureId: FeatureId,
  parameters: ReturnType<typeof extrusionFeatureParametersSchema.parse>,
  targetFeatureId: FeatureId | null,
  supportReference: TopoRef | null,
) {
  const references = supportReference ? [supportReference] : []
  const dependencies = [targetFeatureId, ...references.map(({ featureId }) => featureId)].flatMap(
    (item, index, values) => (item && values.indexOf(item) === index ? [item] : []),
  )
  if (mode.kind === "edit") {
    return featureRecordSchema.parse({
      ...mode.feature,
      type: extrusionFeatureType.type,
      parameters,
      dependencies,
      references,
    })
  }
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: extrusionFeatureType.type,
    parameters,
    dependencies,
    references,
    suppressed: false,
    label: mode.featureLabel,
  })
}

function ExtrusionPreviewSync({
  copy,
  displayUnit,
  featureId,
  mode,
  onPreviewChange,
  options,
  values,
  variables,
}: {
  copy: ExtrusionFormCopy
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"]
  featureId: FeatureId
  mode: ExtrusionFormMode
  onPreviewChange: (feature: FeatureRecord | null) => void
  options: readonly ExtrusionTargetOption[]
  values: ExtrusionFormValues
  variables: readonly VariableDefinition[]
}) {
  useDebouncedFeaturePreview({
    input: { copy, displayUnit, mode, options, variables },
    onPreviewChange,
    values,
    resolve: (currentValues, input) => {
      const parsed = parseValues(
        currentValues,
        input.variables,
        input.options,
        input.copy,
        input.displayUnit,
      )
      return parsed.ok
        ? extrusionRecord(
            input.mode,
            featureId,
            parsed.parameters,
            parsed.targetFeatureId,
            parsed.supportReference,
          )
        : null
    },
  })
  return null
}

function parseValues(
  values: ExtrusionFormValues,
  variables: readonly VariableDefinition[],
  options: readonly ExtrusionTargetOption[],
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
  const operation = extrusionOperationSchema.parse(values.operation)
  const availableTargetIds = new Set(options.map(({ id }) => id))
  const parsedTarget = featureIdSchema.safeParse(values.targetFeatureId)
  const targetFeatureId =
    operation === "new"
      ? null
      : parsedTarget.success && availableTargetIds.has(parsedTarget.data)
        ? parsedTarget.data
        : null
  if (operation !== "new" && !targetFeatureId) {
    return { ok: false as const, issues: { targetFeatureId: copy.missingTarget } }
  }
  return {
    ok: true as const,
    targetFeatureId,
    supportReference: values.supportReference,
    parameters: extrusionFeatureParametersSchema.parse({
      profile: values.profile,
      distance: distance.quantity,
      symmetric: values.symmetric,
      operation,
    }),
  }
}

function ExtrusionProfileSelectionSync({
  onChange,
  profile,
  supportReference,
}: Readonly<{
  onChange: (profile: SketchProfileSelector, supportReference: TopoRef | null) => void
  profile: SketchProfileSelector
  supportReference: TopoRef | null
}>) {
  useLayoutEffect(() => onChange(profile, supportReference), [onChange, profile, supportReference])
  return null
}

export function ExtrusionForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onSave,
  onSaved,
  onPreviewChange,
  options,
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
  onPreviewChange?: (feature: FeatureRecord | null) => void
  options: readonly ExtrusionTargetOption[]
  profileLabel: string
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
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues:
      mode.kind === "edit"
        ? valuesFromFeature(mode.feature, mode.profile, mode.supportReference)
        : defaultValues(displayUnits.length, options, mode.profile, mode.supportReference),
    onSubmit: async ({ value }) => {
      const parsed = parseValues(value, variables, options, copy, displayUnits.length)
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(copy.validationSummary)
        const invalidFieldName = parsed.issues.distance ? "distance" : "targetFeatureId"
        formElementRef.current?.querySelector<HTMLElement>(`[name="${invalidFieldName}"]`)?.focus()
        return
      }
      setIssues({})
      setMessage(null)
      await submitFeatureMutation({
        baseRevision,
        copy,
        feature: extrusionRecord(
          mode,
          featureId,
          parsed.parameters,
          parsed.targetFeatureId,
          parsed.supportReference,
        ),
        onSave,
        onSaved,
        setMessage,
      })
    },
  })
  const applyProfileSelection = useCallback(
    (profile: SketchProfileSelector, supportReference: TopoRef | null) => {
      if (!profileSelectorsEqual(form.getFieldValue("profile"), profile)) {
        form.setFieldValue("profile", profile)
      }
      if (!topologyReferencesEqual(form.getFieldValue("supportReference"), supportReference)) {
        form.setFieldValue("supportReference", supportReference)
      }
    },
    [form],
  )

  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <ExtrusionProfileSelectionSync
        profile={mode.profile}
        supportReference={mode.supportReference ?? null}
        onChange={applyProfileSelection}
      />
      {onPreviewChange ? (
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <ExtrusionPreviewSync
              copy={copy}
              displayUnit={displayUnits.length}
              featureId={featureId}
              mode={mode}
              onPreviewChange={onPreviewChange}
              options={options}
              values={values}
              variables={variables}
            />
          )}
        </form.Subscribe>
      ) : null}
      <ExtrusionParameterPanel
        copy={copy}
        disabled={disabled}
        message={message}
        profileLabel={profileLabel}
        operationField={
          <form.Field name="operation">
            {(field) => (
              <NativeSelectField
                name={field.name}
                value={field.state.value}
                label={copy.operation}
                disabled={disabled}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  clearSubmissionErrors()
                  field.handleChange(event.currentTarget.value)
                }}
              >
                <option value="new">{copy.operationNew}</option>
                <option value="add">{copy.operationAdd}</option>
                <option value="remove">{copy.operationRemove}</option>
                <option value="intersect">{copy.operationIntersect}</option>
              </NativeSelectField>
            )}
          </form.Field>
        }
        targetField={
          <form.Subscribe selector={(state) => state.values.operation}>
            {(operation) =>
              operation === "new" ? null : (
                <form.Field name="targetFeatureId">
                  {(field) => (
                    <NativeSelectField
                      name={field.name}
                      value={field.state.value}
                      label={copy.target}
                      description={copy.targetDescription}
                      error={issues.targetFeatureId}
                      disabled={disabled}
                      required
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        clearSubmissionErrors()
                        field.handleChange(event.currentTarget.value)
                      }}
                    >
                      {options.length === 0 ? <option value="">{copy.missingTarget}</option> : null}
                      {options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelectField>
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
        }
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
                suggestions={suggestions}
                onBlur={field.handleBlur}
                onValueChange={(value) => {
                  clearSubmissionErrors()
                  field.handleChange(value)
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
