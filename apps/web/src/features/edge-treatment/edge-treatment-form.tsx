import {
  chamferFeatureParametersSchema,
  chamferFeatureType,
  chamferFeatureTypeV2,
  createTopologyReferenceResolver,
  type EdgeTopoRef,
  type FeatureId,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
  filletFeatureParametersSchema,
  filletFeatureType,
  filletFeatureTypeV2,
  type LengthQuantity,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Button } from "@vibeshape/ui/components/button"
import {
  NativeSelectField,
  type NativeSelectFieldProps,
} from "@vibeshape/ui/components/native-select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { type ComponentProps, useEffect, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultLengthExpression,
  type useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { LengthExpressionField } from "../part-design/length-expression-field"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  parsePrimitiveLengthExpression,
  quantityExpression,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import {
  type EdgeTreatmentGeometry,
  type SelectedEdgeCandidate,
  selectedEdgeCandidates,
  toggleSelectedEdgeReference,
} from "./edge-treatment-candidates"

export type EdgeTreatmentOperation = "fillet" | "chamfer"

export type EdgeTreatmentFormCopy = ParameterPanelCopy &
  Readonly<{
    scopeLabel: string
    allEdges: string
    selectedEdges: string
    selectedEdgesDescription: string
    edgeLabel: (ordinal: number) => string
    removeEdge: string
    clearEdges: string
    pickEdges: string
    missingEdge: string
    ambiguousEdge: string
    distance: string
    expressionDescription: string
    invalidDimension: string
    invalidExpression: string
    invalidRange: string
    missingTarget: string
    saveFailed: string
    staleRevision: string
    submit: string
    target: string
    targetDescription: string
    validationSummary: string
  }>

export type EdgeTreatmentTargetOption = Readonly<{
  id: FeatureId
  label: string
}>

export type EdgeTreatmentFormMode =
  | Readonly<{
      kind: "create"
      createFeatureId: () => FeatureId
      featureLabel: string
    }>
  | Readonly<{
      kind: "edit"
      feature: FeatureRecord
    }>

export type EdgeTreatmentFormProps = Readonly<{
  baseRevision: number
  copy: EdgeTreatmentFormCopy
  disabled?: boolean
  mode: EdgeTreatmentFormMode
  onCancel: () => void
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  operation: EdgeTreatmentOperation
  options: readonly EdgeTreatmentTargetOption[]
  topologyCandidates?: readonly EdgeTreatmentGeometry[]
  pickingRequest?: EdgeTreatmentPickRequest | null
  onPickingContextChange?: ((context: EdgeTreatmentPickingContext | null) => void) | undefined
  previewStatus?: FeaturePreviewState["status"] | undefined
  variables: readonly VariableDefinition[]
}>

export type EdgeTreatmentPickingContext = Readonly<{
  featureId: FeatureId
  targetFeatureId: FeatureId
  references: readonly EdgeTopoRef[]
  scope: "all" | "selected"
}>

export type EdgeTreatmentPickRequest = Readonly<{
  sequence: number
  featureId: FeatureId
  reference: EdgeTopoRef
}>

type FormValues = Readonly<{
  distance: string
  targetFeatureId: string
  scope: "all" | "selected"
  references: readonly EdgeTopoRef[]
}>

function parametersFor(operation: EdgeTreatmentOperation, distance: LengthQuantity) {
  return operation === "fillet"
    ? filletFeatureParametersSchema.parse({ radius: distance })
    : chamferFeatureParametersSchema.parse({ distance })
}

function valuesFromFeature(feature: FeatureRecord, operation: EdgeTreatmentOperation): FormValues {
  const distance =
    operation === "fillet"
      ? filletFeatureParametersSchema.parse(feature.parameters).radius
      : chamferFeatureParametersSchema.parse(feature.parameters).distance
  return {
    distance: quantityExpression(distance),
    targetFeatureId: feature.dependencies[0] ?? "",
    scope: feature.type.schemaVersion === 2 ? "selected" : "all",
    references:
      feature.type.schemaVersion === 2
        ? feature.references.filter((ref): ref is EdgeTopoRef => ref.kind === "edge")
        : [],
  }
}

function featureRecord(
  mode: EdgeTreatmentFormMode,
  operation: EdgeTreatmentOperation,
  featureId: FeatureId,
  parameters: unknown,
  targetFeatureId: FeatureId,
  scope: "all" | "selected",
  references: readonly EdgeTopoRef[],
) {
  const type =
    scope === "selected"
      ? operation === "fillet"
        ? filletFeatureTypeV2.type
        : chamferFeatureTypeV2.type
      : operation === "fillet"
        ? filletFeatureType.type
        : chamferFeatureType.type
  if (mode.kind === "edit") {
    return featureRecordSchema.parse({
      ...mode.feature,
      type,
      parameters,
      dependencies: [targetFeatureId],
      references: scope === "selected" ? references : [],
    })
  }
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type,
    parameters,
    dependencies: [targetFeatureId],
    references: scope === "selected" ? references : [],
    suppressed: false,
    label: mode.featureLabel,
  })
}

function selectedReferenceIssue(
  values: FormValues,
  candidates: readonly SelectedEdgeCandidate[],
  copy: EdgeTreatmentFormCopy,
) {
  if (values.scope !== "selected") return undefined
  if (
    !values.references.length ||
    values.references.some((reference) => reference.featureId !== values.targetFeatureId)
  )
    return copy.missingEdge
  const resolver = createTopologyReferenceResolver(candidates.map(({ candidate }) => candidate))
  for (const reference of values.references) {
    const result = resolver(reference)
    if (result.status === "missing") return copy.missingEdge
    if (result.status === "ambiguous") return copy.ambiguousEdge
  }
  return undefined
}

function focusFirstInvalidInput(
  element: HTMLFormElement | null,
  issues: Partial<Record<keyof FormValues, string>>,
) {
  const first = (["distance", "targetFeatureId"] as const).find((key) => issues[key])
  if (first) element?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()
}

function parseValues(
  values: FormValues,
  operation: EdgeTreatmentOperation,
  variables: readonly VariableDefinition[],
  options: readonly EdgeTreatmentTargetOption[],
  copy: EdgeTreatmentFormCopy,
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"],
  candidates: readonly SelectedEdgeCandidate[],
) {
  const lengthSchema =
    operation === "fillet"
      ? filletFeatureParametersSchema.shape.radius
      : chamferFeatureParametersSchema.shape.distance
  const distance = parsePrimitiveLengthExpression(
    values.distance,
    variables,
    copy,
    (quantity) => lengthSchema.safeParse(quantity).success,
    displayUnit,
  )
  const target = featureIdSchema.safeParse(values.targetFeatureId)
  const available = options.some((option) => option.id === target.data)
  const issues: Partial<Record<keyof FormValues, string>> = {}
  if (!distance.ok) issues.distance = distance.message
  if (!target.success || !available) issues.targetFeatureId = copy.missingTarget
  const referenceIssue = selectedReferenceIssue(values, candidates, copy)
  if (referenceIssue) issues.references = referenceIssue
  if (!distance.ok || !target.success || Object.keys(issues).length > 0)
    return { ok: false as const, issues }
  return {
    ok: true as const,
    distance: distance.quantity,
    targetFeatureId: target.data,
    scope: values.scope,
    references: values.references,
  }
}

function PreviewSync({
  onPreviewChange,
  ...props
}: Omit<ComponentProps<typeof ResolvedPreviewSync>, "onPreviewChange"> &
  Readonly<{ onPreviewChange: EdgeTreatmentFormProps["onPreviewChange"] }>) {
  return onPreviewChange ? (
    <ResolvedPreviewSync {...props} onPreviewChange={onPreviewChange} />
  ) : null
}

function ResolvedPreviewSync({
  copy,
  displayUnit,
  featureId,
  mode,
  onPreviewChange,
  operation,
  options,
  candidates,
  values,
  variables,
}: Readonly<{
  copy: EdgeTreatmentFormCopy
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"]
  featureId: FeatureId
  mode: EdgeTreatmentFormMode
  onPreviewChange: (feature: FeatureRecord | null) => void
  operation: EdgeTreatmentOperation
  options: readonly EdgeTreatmentTargetOption[]
  values: FormValues
  variables: readonly VariableDefinition[]
  candidates: readonly SelectedEdgeCandidate[]
}>) {
  const parsed = parseValues(values, operation, variables, options, copy, displayUnit, candidates)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: parsed.ok
      ? featureRecord(
          mode,
          operation,
          featureId,
          parametersFor(operation, parsed.distance),
          parsed.targetFeatureId,
          parsed.scope,
          parsed.references,
        )
      : null,
  })
  return null
}

function EdgeTargetField({
  options,
  copy,
  ...props
}: Omit<NativeSelectFieldProps, "label" | "children"> &
  Readonly<{ options: readonly EdgeTreatmentTargetOption[]; copy: EdgeTreatmentFormCopy }>) {
  return (
    <NativeSelectField {...props} label={copy.target} description={copy.targetDescription} required>
      {options.length === 0 ? <option value="">{copy.missingTarget}</option> : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </NativeSelectField>
  )
}

function EdgeScopeField({
  scope,
  name,
  copy,
  disabled,
  onChange,
}: Readonly<{
  scope: FormValues["scope"]
  name: string
  copy: EdgeTreatmentFormCopy
  disabled: boolean
  onChange: (scope: FormValues["scope"]) => void
}>) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{copy.scopeLabel}</legend>
      {(["all", "selected"] as const).map((value) => (
        <label key={value} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={value}
            checked={scope === value}
            disabled={disabled}
            onChange={() => onChange(value)}
          />
          {value === "all" ? copy.allEdges : copy.selectedEdges}
        </label>
      ))}
    </fieldset>
  )
}

function SelectedEdgesField({
  scope,
  candidates,
  copy,
  disabled,
  onChange,
  references,
}: Readonly<{
  scope: FormValues["scope"]
  candidates: readonly SelectedEdgeCandidate[]
  copy: EdgeTreatmentFormCopy
  disabled: boolean
  onChange: (references: readonly EdgeTopoRef[]) => void
  references: readonly EdgeTopoRef[]
}>) {
  if (scope !== "selected") return null
  const resolver = createTopologyReferenceResolver(candidates.map(({ candidate }) => candidate))
  return (
    <fieldset className="grid gap-2" aria-label={copy.selectedEdges}>
      <legend className="text-sm font-medium">{copy.selectedEdges}</legend>
      <NativeSelectField
        label={copy.pickEdges}
        value=""
        disabled={disabled || candidates.length === 0}
        onChange={(event) => {
          const candidate = candidates.find(
            ({ candidateId }) => candidateId === event.currentTarget.value,
          )
          if (candidate)
            onChange(toggleSelectedEdgeReference(references, candidate.reference, candidates))
        }}
      >
        <option value="">{copy.pickEdges}</option>
        {candidates.map((candidate) => (
          <option key={candidate.candidateId} value={candidate.candidateId}>
            {candidate.label}
          </option>
        ))}
      </NativeSelectField>
      {references.map((reference, index) => {
        const result = resolver(reference)
        const ownerMatches = reference.featureId === candidates[0]?.reference.featureId
        const candidate =
          result.status === "resolved"
            ? candidates.find(({ candidate }) => candidate.candidateId === result.candidateId)
            : undefined
        return (
          <div key={`${reference.featureId}:${index}`} className="flex items-center gap-2 text-sm">
            <span
              className={
                result.status === "resolved" && ownerMatches ? undefined : "text-destructive"
              }
            >
              {ownerMatches
                ? (candidate?.label ??
                  (result.status === "ambiguous" ? copy.ambiguousEdge : copy.missingEdge))
                : copy.missingEdge}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(references.filter((_, item) => item !== index))}
            >
              {copy.removeEdge}
            </Button>
          </div>
        )
      })}
      {references.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          disabled={disabled}
          onClick={() => onChange([])}
        >
          {copy.clearEdges}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{copy.selectedEdgesDescription}</p>
      )}
    </fieldset>
  )
}

function EdgeTreatmentEffects({
  candidates,
  featureId,
  lastPickSequence,
  onPickingContextChange,
  pickingRequest,
  onReferencesChange,
  setLastPickSequence,
  values,
}: Readonly<{
  candidates: readonly SelectedEdgeCandidate[]
  featureId: FeatureId
  lastPickSequence: number | null
  onPickingContextChange: ((context: EdgeTreatmentPickingContext | null) => void) | undefined
  pickingRequest: EdgeTreatmentPickRequest | null
  onReferencesChange: (references: readonly EdgeTopoRef[]) => void
  setLastPickSequence: (sequence: number) => void
  values: FormValues
}>) {
  useEffect(() => {
    if (!onPickingContextChange) return
    const target = featureIdSchema.safeParse(values.targetFeatureId)
    onPickingContextChange(
      target.success
        ? {
            featureId,
            targetFeatureId: target.data,
            references: values.references,
            scope: values.scope,
          }
        : null,
    )
    return () => onPickingContextChange(null)
  }, [featureId, onPickingContextChange, values.references, values.scope, values.targetFeatureId])
  useEffect(() => {
    if (
      !pickingRequest ||
      pickingRequest.featureId !== featureId ||
      lastPickSequence === pickingRequest.sequence
    )
      return
    setLastPickSequence(pickingRequest.sequence)
    if (
      pickingRequest.reference.featureId !== values.targetFeatureId ||
      values.scope !== "selected"
    )
      return
    onReferencesChange(
      toggleSelectedEdgeReference(values.references, pickingRequest.reference, candidates),
    )
  }, [
    candidates,
    featureId,
    lastPickSequence,
    pickingRequest,
    onReferencesChange,
    setLastPickSequence,
    values.references,
    values.scope,
    values.targetFeatureId,
  ])
  return null
}

function edgeTreatmentInitialState(
  mode: EdgeTreatmentFormMode,
  operation: EdgeTreatmentOperation,
  options: readonly EdgeTreatmentTargetOption[],
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"],
) {
  if (mode.kind === "edit")
    return { featureId: mode.feature.id, values: valuesFromFeature(mode.feature, operation) }
  return {
    featureId: mode.createFeatureId(),
    values: {
      distance: defaultLengthExpression(1, displayUnit),
      targetFeatureId: options[0]?.id ?? "",
      scope: "all",
      references: [],
    } satisfies FormValues,
  }
}

async function submitEdgeTreatment(
  value: FormValues,
  context: Pick<
    EdgeTreatmentFormProps,
    "baseRevision" | "copy" | "mode" | "onSave" | "onSaved" | "operation" | "options" | "variables"
  > &
    Readonly<{
      disabled: boolean
      previewStatus: EdgeTreatmentFormProps["previewStatus"]
      topologyCandidates: readonly EdgeTreatmentGeometry[]
      featureId: FeatureId
      formState: ReturnType<typeof useParameterFormState>
    }>,
) {
  const {
    baseRevision,
    copy,
    mode,
    onSave,
    onSaved,
    operation,
    options,
    variables,
    disabled,
    previewStatus,
    topologyCandidates,
    featureId,
    formState,
  } = context
  const { displayUnits, setIssues, setMessage, formElementRef } = formState

  if (disabled || (previewStatus !== undefined && previewStatus !== "ready")) return
  const candidates = selectedEdgeCandidates(
    topologyCandidates,
    value.targetFeatureId,
    copy.edgeLabel,
  )
  const parsed = parseValues(
    value,
    operation,
    variables,
    options,
    copy,
    displayUnits.length,
    candidates,
  )
  if (!parsed.ok) {
    setIssues(parsed.issues)
    setMessage(copy.validationSummary)
    focusFirstInvalidInput(formElementRef.current, parsed.issues)
    return
  }
  setIssues({})
  setMessage(null)
  try {
    await submitFeatureMutation({
      baseRevision,
      copy,
      feature: featureRecord(
        mode,
        operation,
        featureId,
        parametersFor(operation, parsed.distance),
        parsed.targetFeatureId,
        parsed.scope,
        parsed.references,
      ),
      onSave,
      onSaved,
      setMessage,
    })
  } catch {
    setMessage(copy.saveFailed)
  }
}

export function EdgeTreatmentForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  operation,
  options,
  previewStatus,
  topologyCandidates = [],
  pickingRequest = null,
  onPickingContextChange,
  variables,
}: EdgeTreatmentFormProps) {
  const formState = useParameterFormState(variables)
  const { clearSubmissionErrors, displayUnits, formElementRef, issues, message, suggestions } =
    formState
  const [initial] = useState(() =>
    edgeTreatmentInitialState(mode, operation, options, displayUnits.length),
  )
  const { featureId } = initial
  const [lastPickSequence, setLastPickSequence] = useState<number | null>(null)
  const form = useAppForm({
    defaultValues: initial.values,
    onSubmit: ({ value }) =>
      submitEdgeTreatment(value, {
        baseRevision,
        copy,
        mode,
        onSave,
        onSaved,
        operation,
        options,
        variables,
        disabled,
        previewStatus,
        topologyCandidates,
        featureId,
        formState,
      }),
  })

  return (
    <Form ref={formElementRef} form={form} aria-label={copy.title} className="gap-0">
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <PreviewSync
            copy={copy}
            displayUnit={displayUnits.length}
            featureId={featureId}
            mode={mode}
            onPreviewChange={onPreviewChange}
            operation={operation}
            options={options}
            values={values}
            variables={variables}
            candidates={selectedEdgeCandidates(
              topologyCandidates,
              values.targetFeatureId,
              copy.edgeLabel,
            )}
          />
        )}
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <EdgeTreatmentEffects
            candidates={selectedEdgeCandidates(
              topologyCandidates,
              values.targetFeatureId,
              copy.edgeLabel,
            )}
            featureId={featureId}
            lastPickSequence={lastPickSequence}
            onPickingContextChange={onPickingContextChange}
            pickingRequest={pickingRequest}
            onReferencesChange={(references) => form.setFieldValue("references", references)}
            setLastPickSequence={(sequence) => setLastPickSequence(sequence)}
            values={values}
          />
        )}
      </form.Subscribe>
      <ParameterPanel
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
        legend={copy.scopeLabel}
        message={message}
      >
        <form.Field name="scope">
          {(field) => (
            <EdgeScopeField
              scope={field.state.value}
              name={field.name}
              copy={copy}
              disabled={disabled}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => ({
            scope: state.values.scope,
            target: state.values.targetFeatureId,
            references: state.values.references,
          })}
        >
          {({ scope, target, references }) => (
            <SelectedEdgesField
              scope={scope}
              copy={copy}
              candidates={selectedEdgeCandidates(topologyCandidates, target, copy.edgeLabel)}
              references={references}
              disabled={disabled}
              onChange={(next) => form.setFieldValue("references", next)}
            />
          )}
        </form.Subscribe>
        <form.Field name="targetFeatureId">
          {(field) => (
            <EdgeTargetField
              options={options}
              copy={copy}
              name={field.name}
              error={issues.targetFeatureId}
              value={field.state.value}
              disabled={disabled}
              onBlur={field.handleBlur}
              onChange={(event) => {
                clearSubmissionErrors()
                field.handleChange(event.currentTarget.value)
              }}
            />
          )}
        </form.Field>
        <form.Field name="distance">
          {(field) => (
            <LengthExpressionField
              id={`edge-treatment-${operation}-distance`}
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
      </ParameterPanel>
    </Form>
  )
}
