import {
  type FeatureId,
  type FeatureRecord,
  featureIdSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import { useReferencePicking } from "../../shell/reference-pick-context"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import { submitFeatureMutation } from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import type { EdgeTreatmentPreselection } from "./edge-treatment-activation"
import { type EdgeTreatmentGeometry, edgeTreatmentCandidates } from "./edge-treatment-candidates"
import { EdgeTreatmentControls } from "./edge-treatment-controls"
import {
  initialTreatmentValues,
  promoteTreatmentTargets,
  type TreatmentValues,
  treatmentFeature,
  treatmentUsesV3,
} from "./edge-treatment-model"
import { type EdgeTreatmentTargetOption, edgeTreatmentOptionOwner } from "./edge-treatment-options"
import {
  applyTreatmentPick,
  type EdgeTreatmentPick,
  type EdgeTreatmentPickingContext,
  type EdgeTreatmentPickRequest,
} from "./edge-treatment-picking"

export type { EdgeTreatmentTargetOption } from "./edge-treatment-options"
export type {
  EdgeTreatmentPickingContext,
  EdgeTreatmentPickRequest,
} from "./edge-treatment-picking"

export type EdgeTreatmentOperation = "fillet" | "chamfer"

export type EdgeTreatmentFormCopy = ParameterPanelCopy &
  Readonly<{
    scopeLabel: string
    allEdges: string
    selectedEdges: string
    selectedEdgesDescription: string
    selectedEdgeCount: (count: number) => string
    edgeLabel: (ordinal: number) => string
    removeEdge: string
    removeEdgeLabel: (edge: string) => string
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

export type EdgeTreatmentFormMode =
  | Readonly<{
      kind: "create"
      createFeatureId: () => FeatureId
      featureLabel: string
      targetFeatureId?: FeatureId | null | undefined
      edgeSelection?: EdgeTreatmentPreselection | undefined
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

type FormState = ReturnType<typeof useParameterFormState>
function TreatmentPreview({
  feature,
  onChange,
}: {
  feature: FeatureRecord | null
  onChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({ preview: feature, onPreviewChange: onChange })
  return null
}

function treatmentValidationCopy(
  copy: EdgeTreatmentFormCopy,
  t: ReturnType<typeof useTranslations<"app.shell.taskPanel.edgeTreatment">>,
) {
  return {
    ...copy,
    missingCatalogue: t("missingCatalogue"),
    missingSideFace: t("sideFaceRequired"),
    planarOnly: t("planarOnly"),
    invalidAngle: t("invalidAngle"),
    invalidAdvancedRange: t("invalidAdvancedRange"),
  }
}

function useTreatmentFields(
  props: EdgeTreatmentFormProps,
  values: TreatmentValues,
  featureId: FeatureId,
  state: FormState,
  onChange: (value: TreatmentValues) => void,
) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  const sharedPicker = useReferencePicking()
  const [pick, setPick] = useState<EdgeTreatmentPick | null>({ kind: "edges" })
  const [pickIssue, setPickIssue] = useState<string | null>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const lastSequence = useRef<number | null>(null)
  useEffect(() => {
    if (props.disabled || values.scope !== "selected") return
    const button = state.formElementRef.current?.querySelector<HTMLButtonElement>(
      "#edge-treatment-pick-edges",
    )
    button?.focus()
    returnFocus.current = button ?? null
  }, [featureId, props.disabled, values.scope, state.formElementRef])
  const candidates = useMemo(
    () =>
      edgeTreatmentCandidates(props.options, props.topologyCandidates ?? [], (kind, ordinal) =>
        kind === "edge" ? props.copy.edgeLabel(ordinal) : t("faceLabel", { ordinal }),
      ),
    [props.options, props.topologyCandidates, props.copy.edgeLabel, t],
  )
  const context = {
    featureId,
    mode: props.mode,
    operation: props.operation,
    options: props.options,
    candidates,
    variables: props.variables,
    unit: state.displayUnits.length,
    copy: treatmentValidationCopy(props.copy, t),
  }
  const parsed = treatmentFeature(values, context)
  const normalize = (next: TreatmentValues) => {
    const option = props.options.find(({ id }) => id === next.targetFeatureId)
    return props.operation === "chamfer" && treatmentUsesV3(next, option)
      ? promoteTreatmentTargets(next, candidates)
      : next
  }
  const apply = (request: EdgeTreatmentPickRequest) => {
    const result = applyTreatmentPick(values, request, candidates, props.options)
    if ("issue" in result) {
      const labels = {
        ambiguous: props.copy.ambiguousEdge,
        missing: props.copy.missingEdge,
        "wrong-body": t("sideFaceWrongBody"),
        limit: t("selectionLimit"),
      }
      setPickIssue(labels[result.issue])
      return
    }
    setPickIssue(null)
    state.clearSubmissionErrors()
    onChange(normalize(result.values))
  }
  useEffect(() => {
    const option = props.options.find(({ id }) => id === values.targetFeatureId)
    const owner = featureIdSchema.safeParse(edgeTreatmentOptionOwner(option))
    props.onPickingContextChange?.({
      featureId,
      targetFeatureId: owner.success ? owner.data : null,
      targetOptionId: values.targetFeatureId,
      references: values.references,
      scope: values.scope,
      options: props.options,
      targets: values.targets,
      directionOverrides: values.directionOverrides,
      pick: props.disabled ? null : pick,
    })
  }, [
    featureId,
    props.disabled,
    props.onPickingContextChange,
    props.options,
    values.references,
    values.targets,
    values.directionOverrides,
    values.scope,
    values.targetFeatureId,
    pick,
  ])
  useEffect(
    () => () => props.onPickingContextChange?.(null),
    [featureId, props.onPickingContextChange],
  )
  useEffect(() => {
    const request = props.pickingRequest
    if (!request || request.featureId !== featureId || lastSequence.current === request.sequence)
      return
    lastSequence.current = request.sequence
    if (props.disabled || values.scope !== "selected") return
    apply(request)
  }, [props.pickingRequest, props.disabled, featureId, values, candidates, props.options])
  const onEscape = (event: KeyboardEvent<HTMLFormElement>) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      sharedPicker?.activeOwner ||
      !pick
    )
      return
    event.preventDefault()
    event.stopPropagation()
    setPick(null)
    returnFocus.current?.focus()
  }
  return {
    candidates,
    parsed,
    pick,
    pickIssue,
    onEscape,
    onArm: (next: EdgeTreatmentPick, element: HTMLButtonElement) => {
      element.focus()
      returnFocus.current = element
      setPick((current) => (JSON.stringify(current) === JSON.stringify(next) ? null : next))
      setPickIssue(null)
    },
    onPick: (candidate: (typeof candidates)[number], intent: EdgeTreatmentPick) =>
      apply({
        featureId,
        sequence: 0,
        reference: candidate.reference,
        optionId: candidate.optionId,
        pick: intent,
      }),
    change: (next: TreatmentValues) => {
      state.clearSubmissionErrors()
      setPickIssue(null)
      onChange(normalize(next))
    },
  }
}

function TreatmentFields({
  props,
  values,
  featureId,
  state,
  onChange,
  setEscape,
}: {
  props: EdgeTreatmentFormProps
  values: TreatmentValues
  featureId: FeatureId
  state: FormState
  onChange: (values: TreatmentValues) => void
  setEscape: (handler: ((event: KeyboardEvent<HTMLFormElement>) => void) | null) => void
}) {
  const fields = useTreatmentFields(props, values, featureId, state, onChange)
  useEffect(() => {
    setEscape(fields.onEscape)
    return () => setEscape(null)
  }, [fields.onEscape, setEscape])
  const option = props.options.find(({ id }) => id === values.targetFeatureId)
  const v3 = props.operation === "chamfer" && treatmentUsesV3(values, option)
  const issues = {
    ...state.issues,
    ...(v3 && !fields.parsed.ok && fields.parsed.issues.references
      ? { references: fields.parsed.issues.references }
      : {}),
  }
  return (
    <>
      {props.onPreviewChange && (
        <TreatmentPreview
          feature={fields.parsed.ok ? fields.parsed.feature : null}
          onChange={props.onPreviewChange}
        />
      )}
      {fields.pickIssue && (
        <p role="alert" className="text-xs text-destructive">
          {fields.pickIssue}
        </p>
      )}
      <EdgeTreatmentControls
        values={values}
        onChange={fields.change}
        candidates={fields.candidates}
        options={props.options}
        operation={props.operation}
        copy={props.copy}
        issues={issues}
        disabled={Boolean(props.disabled)}
        suggestions={state.suggestions}
        pick={fields.pick}
        onArm={fields.onArm}
        onPick={fields.onPick}
      />
    </>
  )
}

export function EdgeTreatmentForm(props: EdgeTreatmentFormProps) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  const state = useParameterFormState(props.variables)
  const [initial] = useState(() => ({
    featureId: props.mode.kind === "edit" ? props.mode.feature.id : props.mode.createFeatureId(),
    values: initialTreatmentValues(
      props.mode,
      props.operation,
      props.options,
      state.displayUnits.length,
    ),
  }))
  const escapeHandler = useRef<((event: KeyboardEvent<HTMLFormElement>) => void) | null>(null)
  const form = useAppForm({
    defaultValues: { draft: initial.values },
    onSubmit: async ({ value }) => {
      if (props.disabled || (props.previewStatus !== undefined && props.previewStatus !== "ready"))
        return
      const candidates = edgeTreatmentCandidates(
        props.options,
        props.topologyCandidates ?? [],
        (kind, ordinal) =>
          kind === "edge" ? props.copy.edgeLabel(ordinal) : t("faceLabel", { ordinal }),
      )
      const result = treatmentFeature(value.draft, {
        featureId: initial.featureId,
        mode: props.mode,
        operation: props.operation,
        options: props.options,
        candidates,
        variables: props.variables,
        unit: state.displayUnits.length,
        copy: treatmentValidationCopy(props.copy, t),
      })
      if (!result.ok) {
        state.setIssues(result.issues)
        state.setMessage(props.copy.validationSummary)
        const key = ["distance", "secondDistance", "angle", "targetFeatureId", "references"].find(
          (field) => result.issues[field as keyof typeof result.issues],
        )
        const selector = key === "references" ? "#edge-treatment-pick-edges" : `[name="${key}"]`
        state.formElementRef.current?.querySelector<HTMLElement>(selector)?.focus()
        return
      }
      state.setIssues({})
      state.setMessage(null)
      try {
        await submitFeatureMutation({
          baseRevision: props.baseRevision,
          copy: props.copy,
          feature: result.feature,
          onSave: props.onSave,
          onSaved: props.onSaved,
          setMessage: state.setMessage,
        })
      } catch {
        state.setMessage(props.copy.saveFailed)
      }
    },
  })
  return (
    <Form
      ref={state.formElementRef}
      form={form}
      aria-label={props.copy.title}
      className="gap-0"
      onKeyDown={(event) => escapeHandler.current?.(event)}
    >
      <ParameterPanel
        copy={props.copy}
        disabled={Boolean(props.disabled)}
        legend={props.copy.scopeLabel}
        message={state.message}
        actions={
          <TaskPanelFormActions
            acceptLabel={props.copy.submit}
            ariaLabel={props.copy.title}
            cancelLabel={props.copy.cancel}
            disabled={Boolean(props.disabled)}
            onCancel={props.onCancel}
            previewStatus={props.previewStatus}
          />
        }
      >
        <form.Field name="draft">
          {(field) => (
            <TreatmentFields
              props={props}
              values={field.state.value}
              featureId={initial.featureId}
              state={state}
              onChange={field.handleChange}
              setEscape={(handler) => {
                escapeHandler.current = handler
              }}
            />
          )}
        </form.Field>
      </ParameterPanel>
    </Form>
  )
}
