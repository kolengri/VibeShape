import {
  createSketchProfileSet,
  extrusionFeatureParametersSchema,
  extrusionFeatureParametersV4Schema,
  extrusionFeatureType,
  extrusionFeatureTypeV4,
  extrusionOperationSchema,
  type FeatureId,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
  multiProfileExtrusionFeatureParametersSchema,
  multiProfileExtrusionFeatureType,
  type SketchProfileSelector,
  type SketchProfileSet,
  type TopoRef,
  type VariableDefinition,
} from "@vibeshape/domain"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultLengthExpression,
  positiveDirectManipulationLengthExpression,
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
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { ExtrusionDistanceRequest } from "./extrusion-distance-manipulator"
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
    missingProfile: string
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
  profiles: SketchProfileSet
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
  profiles: readonly SketchProfileSelector[],
  supportReference: TopoRef | undefined,
): ExtrusionFormValues {
  return {
    distance: defaultLengthExpression(10, unit),
    operation: "new",
    profiles: createSketchProfileSet(profiles),
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
      profiles: readonly SketchProfileSelector[]
      supportReference?: TopoRef
    }>
  | Readonly<{
      feature: FeatureRecord
      kind: "edit"
      profiles: readonly SketchProfileSelector[]
      supportReference?: TopoRef
    }>

function valuesFromFeature(
  feature: FeatureRecord,
  profiles: readonly SketchProfileSelector[],
  supportReference: TopoRef | undefined,
): ExtrusionFormValues {
  const legacy = extrusionFeatureParametersSchema.safeParse(feature.parameters)
  const multi = multiProfileExtrusionFeatureParametersSchema.safeParse(feature.parameters)
  const modifyingMulti = extrusionFeatureParametersV4Schema.safeParse(feature.parameters)
  const parameters = legacy.success
    ? legacy.data
    : multi.success
      ? multi.data
      : modifyingMulti.success
        ? modifyingMulti.data
        : null
  if (!parameters) throw new Error("Extrusion parameters are unavailable.")
  return {
    distance: quantityExpression(parameters.distance),
    operation: parameters.operation,
    profiles: createSketchProfileSet(profiles),
    supportReference: supportReference ?? null,
    symmetric: parameters.symmetric,
    targetFeatureId: feature.dependencies[0] ?? "",
  }
}

function extrusionRecord(
  mode: ExtrusionFormMode,
  featureId: FeatureId,
  parameters:
    | ReturnType<typeof extrusionFeatureParametersSchema.parse>
    | ReturnType<typeof multiProfileExtrusionFeatureParametersSchema.parse>
    | ReturnType<typeof extrusionFeatureParametersV4Schema.parse>,
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
      type: extrusionType(parameters),
      parameters,
      dependencies,
      references,
    })
  }
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: extrusionType(parameters),
    parameters,
    dependencies,
    references,
    suppressed: false,
    label: mode.featureLabel,
  })
}

function extrusionType(
  parameters:
    | ReturnType<typeof extrusionFeatureParametersSchema.parse>
    | ReturnType<typeof multiProfileExtrusionFeatureParametersSchema.parse>
    | ReturnType<typeof extrusionFeatureParametersV4Schema.parse>,
) {
  if (!("profiles" in parameters)) return extrusionFeatureType.type
  return parameters.operation === "new"
    ? multiProfileExtrusionFeatureType.type
    : extrusionFeatureTypeV4.type
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
  const [profile] = values.profiles.profiles
  if (!profile) return { ok: false as const, issues: { profiles: copy.missingProfile } }
  const distance = parsePrimitiveLengthExpression(
    values.distance,
    variables,
    copy,
    (quantity) => extrusionFeatureParametersSchema.shape.distance.safeParse(quantity).success,
    displayUnit,
  )
  if (!distance.ok) return { ok: false as const, issues: { distance: distance.message } }
  const operation = extrusionOperationSchema.parse(values.operation)
  const target = parseTarget(values.targetFeatureId, operation, options, copy)
  if (!target.ok) return target
  return {
    ok: true as const,
    targetFeatureId: target.featureId,
    supportReference: values.supportReference,
    parameters:
      values.profiles.profiles.length > 1
        ? operation === "new"
          ? multiProfileExtrusionFeatureParametersSchema.parse({
              profiles: values.profiles,
              distance: distance.quantity,
              symmetric: values.symmetric,
              operation,
            })
          : extrusionFeatureParametersV4Schema.parse({
              profiles: values.profiles,
              distance: distance.quantity,
              symmetric: values.symmetric,
              operation,
            })
        : extrusionFeatureParametersSchema.parse({
            profile,
            distance: distance.quantity,
            symmetric: values.symmetric,
            operation,
          }),
  }
}

function parseTarget(
  rawTargetFeatureId: string,
  operation: ReturnType<typeof extrusionOperationSchema.parse>,
  options: readonly ExtrusionTargetOption[],
  copy: ExtrusionFormCopy,
) {
  if (operation === "new") return { ok: true as const, featureId: null }
  const availableTargetIds = new Set(options.map(({ id }) => id))
  const target = featureIdSchema.safeParse(rawTargetFeatureId)
  return target.success && availableTargetIds.has(target.data)
    ? { ok: true as const, featureId: target.data }
    : { ok: false as const, issues: { targetFeatureId: copy.missingTarget } }
}

function ExtrusionProfileSelectionSync({
  onChange,
  profiles,
  supportReference,
}: Readonly<{
  onChange: (profiles: readonly SketchProfileSelector[], supportReference: TopoRef | null) => void
  profiles: readonly SketchProfileSelector[]
  supportReference: TopoRef | null
}>) {
  useLayoutEffect(
    () => onChange(profiles, supportReference),
    [onChange, profiles, supportReference],
  )
  return null
}

export type ExtrusionFormProps = Readonly<{
  baseRevision: number
  copy: ExtrusionFormCopy
  disabled?: boolean | undefined
  distanceRequest?: ExtrusionDistanceRequest | null | undefined
  mode: ExtrusionFormMode
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
  options: readonly ExtrusionTargetOption[]
  profileLabel: string
  profileLabels?: readonly string[] | undefined
  onProfileRemove?: ((index: number) => void) | undefined
  onProfilesClear?: (() => void) | undefined
  variables: readonly VariableDefinition[]
}>

function useExtrusionFormController(props: ExtrusionFormProps) {
  const {
    clearSubmissionErrors,
    displayUnits,
    formElementRef,
    issues,
    message,
    setIssues,
    setMessage,
    suggestions,
  } = useParameterFormState(props.variables)
  const [featureId] = useState(() =>
    props.mode.kind === "edit" ? props.mode.feature.id : props.mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues:
      props.mode.kind === "edit"
        ? valuesFromFeature(props.mode.feature, props.mode.profiles, props.mode.supportReference)
        : defaultValues(
            displayUnits.length,
            props.options,
            props.mode.profiles,
            props.mode.supportReference,
          ),
    onSubmit: async ({ value }) => {
      const parsed = parseValues(
        value,
        props.variables,
        props.options,
        props.copy,
        displayUnits.length,
      )
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(
          "profiles" in parsed.issues ? parsed.issues.profiles : props.copy.validationSummary,
        )
        const invalidFieldName =
          "distance" in parsed.issues
            ? "distance"
            : "targetFeatureId" in parsed.issues
              ? "targetFeatureId"
              : null
        if (invalidFieldName) {
          formElementRef.current
            ?.querySelector<HTMLElement>(`[name="${invalidFieldName}"]`)
            ?.focus()
        }
        return
      }
      setIssues({})
      setMessage(null)
      await submitFeatureMutation({
        baseRevision: props.baseRevision,
        copy: props.copy,
        feature: extrusionRecord(
          props.mode,
          featureId,
          parsed.parameters,
          parsed.targetFeatureId,
          parsed.supportReference,
        ),
        onSave: props.onSave,
        onSaved: props.onSaved,
        setMessage,
      })
    },
  })
  useEffect(() => {
    if (props.disabled || !props.distanceRequest || props.distanceRequest.featureId !== featureId) {
      return
    }
    clearSubmissionErrors()
    form.setFieldValue(
      "distance",
      positiveDirectManipulationLengthExpression(
        props.distanceRequest.distance,
        displayUnits.length,
      ),
    )
  }, [
    clearSubmissionErrors,
    displayUnits.length,
    featureId,
    form,
    props.disabled,
    props.distanceRequest,
  ])
  const applyProfileSelection = useCallback(
    (profiles: readonly SketchProfileSelector[], supportReference: TopoRef | null) => {
      const nextProfiles = createSketchProfileSet(profiles)
      const currentProfiles = form.getFieldValue("profiles")
      const matches =
        currentProfiles.profiles.length === nextProfiles.profiles.length &&
        currentProfiles.profiles.every((profile, index) =>
          profileSelectorsEqual(profile, nextProfiles.profiles[index] ?? null),
        )
      if (!matches) {
        form.setFieldValue("profiles", nextProfiles)
      }
      if (!topologyReferencesEqual(form.getFieldValue("supportReference"), supportReference)) {
        form.setFieldValue("supportReference", supportReference)
      }
    },
    [form],
  )
  return {
    ...props,
    applyProfileSelection,
    clearSubmissionErrors,
    disabled: props.disabled ?? false,
    displayUnits,
    featureId,
    form,
    formElementRef,
    issues,
    message,
    suggestions,
  } as const
}

type ExtrusionFormController = ReturnType<typeof useExtrusionFormController>

function ExtrusionPreviewField({ controller }: { controller: ExtrusionFormController }) {
  const { form, onPreviewChange } = controller
  if (!onPreviewChange) return null
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <ExtrusionPreviewSync
          copy={controller.copy}
          displayUnit={controller.displayUnits.length}
          featureId={controller.featureId}
          mode={controller.mode}
          onPreviewChange={onPreviewChange}
          options={controller.options}
          values={values}
          variables={controller.variables}
        />
      )}
    </form.Subscribe>
  )
}

function ExtrusionOperationField({ controller }: { controller: ExtrusionFormController }) {
  const { form } = controller
  return (
    <form.Field name="operation">
      {(field) => (
        <NativeSelectField
          name={field.name}
          value={field.state.value}
          label={controller.copy.operation}
          disabled={controller.disabled}
          onBlur={field.handleBlur}
          onChange={(event) => {
            controller.clearSubmissionErrors()
            field.handleChange(event.currentTarget.value)
          }}
        >
          <option value="new">{controller.copy.operationNew}</option>
          <option value="add">{controller.copy.operationAdd}</option>
          <option value="remove">{controller.copy.operationRemove}</option>
          <option value="intersect">{controller.copy.operationIntersect}</option>
        </NativeSelectField>
      )}
    </form.Field>
  )
}

function ExtrusionTargetField({ controller }: { controller: ExtrusionFormController }) {
  const { form } = controller
  return (
    <form.Subscribe selector={(state) => state.values.operation}>
      {(operation) =>
        operation === "new" ? null : (
          <form.Field name="targetFeatureId">
            {(field) => (
              <NativeSelectField
                name={field.name}
                value={field.state.value}
                label={controller.copy.target}
                description={controller.copy.targetDescription}
                error={controller.issues.targetFeatureId}
                disabled={controller.disabled}
                required
                onBlur={field.handleBlur}
                onChange={(event) => {
                  controller.clearSubmissionErrors()
                  field.handleChange(event.currentTarget.value)
                }}
              >
                {controller.options.length === 0 ? (
                  <option value="">{controller.copy.missingTarget}</option>
                ) : null}
                {controller.options.map((option) => (
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
  )
}

function ExtrusionDistanceField({ controller }: { controller: ExtrusionFormController }) {
  const { form } = controller
  return (
    <form.Field name="distance">
      {(field) => (
        <LengthExpressionField
          id="extrusion-distance"
          name={field.name}
          value={field.state.value}
          label={controller.copy.distance}
          description={controller.copy.expressionDescription}
          error={controller.issues.distance}
          suggestions={controller.suggestions}
          onBlur={field.handleBlur}
          onValueChange={(value) => {
            controller.clearSubmissionErrors()
            field.handleChange(value)
          }}
        />
      )}
    </form.Field>
  )
}

function ExtrusionSymmetricField({ controller }: { controller: ExtrusionFormController }) {
  const { form } = controller
  return (
    <form.Field name="symmetric">
      {(field) => (
        <TanStackBooleanParameterField
          field={field}
          label={controller.copy.symmetric}
          onBeforeChange={controller.clearSubmissionErrors}
        />
      )}
    </form.Field>
  )
}

function ExtrusionFormView({ controller }: { controller: ExtrusionFormController }) {
  const { form } = controller
  return (
    <Form
      ref={controller.formElementRef}
      form={form}
      aria-label={controller.copy.title}
      className="gap-0"
    >
      <ExtrusionProfileSelectionSync
        profiles={controller.mode.profiles}
        supportReference={controller.mode.supportReference ?? null}
        onChange={controller.applyProfileSelection}
      />
      <ExtrusionPreviewField controller={controller} />
      <ExtrusionParameterPanel
        actions={
          <TaskPanelFormActions
            acceptLabel={controller.copy.submit}
            ariaLabel={controller.copy.title}
            cancelLabel={controller.copy.cancel}
            disabled={controller.disabled}
            onCancel={controller.onCancel}
          />
        }
        copy={controller.copy}
        disabled={controller.disabled}
        message={controller.message}
        profileLabels={controller.profileLabels ?? [controller.profileLabel]}
        onProfileRemove={controller.onProfileRemove}
        onProfilesClear={controller.onProfilesClear}
        operationField={<ExtrusionOperationField controller={controller} />}
        targetField={<ExtrusionTargetField controller={controller} />}
        distanceField={<ExtrusionDistanceField controller={controller} />}
        symmetricField={<ExtrusionSymmetricField controller={controller} />}
      />
    </Form>
  )
}

export function ExtrusionForm(props: ExtrusionFormProps) {
  const controller = useExtrusionFormController(props)
  return <ExtrusionFormView controller={controller} />
}
