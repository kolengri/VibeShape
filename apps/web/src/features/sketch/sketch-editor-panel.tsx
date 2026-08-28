import {
  appendSketchConstraint,
  removeSketchConstraints,
  removeSketchExternalReference,
  type SketchConstraintDefinition,
  type SketchConstraintId,
  type SketchDimensionValue,
  type SketchEntity,
  type SketchEntityId,
  type SketchExternalReferenceId,
  type SketchProfileSelector,
  type SketchRecord,
  setSketchDimensionValue,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { CircleAlert, Layers3, Link2, Pencil, Trash2, X } from "@vibeshape/ui/components/icons"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useMemo, useState } from "react"
import { createBrowserSketchConstraintId } from "../../document/document-controller"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { VariableExpressionField } from "../variables/variable-expression-field"
import { variableExpressionSuggestions } from "../variables/variable-expression-input"
import {
  type ExternalSketchGeometryCandidate,
  externalReferenceMatchesCandidate,
} from "./external-sketch-points"
import {
  compatibleSketchConstraintTools,
  compatibleSketchDimensionToolsForSelection,
  type SketchDimensionKind,
  selectedSketchConstraintEntities,
} from "./sketch-constraint-tools"
import {
  createSketchDimensionDefinition,
  evaluateSketchDimensionValue,
} from "./sketch-dimension-value"

type SketchEditorPanelCopy = Readonly<{
  addConstraint: string
  angle: string
  cancel: string
  coincident: string
  concentric: string
  conflict: string
  constraints: string
  diameter: string
  dimension: string
  dimensionExpression: string
  dimensionInvalid: string
  dimensions: string
  distance: string
  externalReferenceDescription: string
  externalReferences: string
  brokenExternalReference: string
  cancelReferenceRepair: string
  repairReference: string
  unavailableExternalReference: string
  attachSelectedPoint: string
  noExternalReferences: string
  editConstraint: string
  equal: string
  extrude: string
  revolve: string
  finish: string
  fixed: string
  horizontal: string
  horizontalDistance: string
  midpoint: string
  quadrant: string
  noConstraints: string
  offset: string
  parallel: string
  perpendicular: string
  plane: string
  planeFeatureFace: string
  planeXy: string
  planeXz: string
  planeYz: string
  pointOnCurve: string
  pointOnLine: string
  profile: (number: number) => string
  profiles: string
  primaryAxisDiameter: string
  radius: string
  remove: string
  replaceSupport: string
  saveDimension: string
  selectionHint: string
  secondaryAxisDiameter: string
  symmetric: string
  tangent: string
  useExternalGeometry: string
  vertical: string
  verticalDistance: string
}>

type DimensionOption = Readonly<{ kind: SketchDimensionKind; label: string }>
function constraintName(
  type: SketchRecord["constraints"][number]["type"],
  copy: SketchEditorPanelCopy,
) {
  return {
    coincident: copy.coincident,
    horizontal: copy.horizontal,
    "horizontal-points": copy.horizontal,
    midpoint: copy.midpoint,
    "arc-midpoint": copy.midpoint,
    "ellipse-quadrant": copy.quadrant,
    vertical: copy.vertical,
    "vertical-points": copy.vertical,
    parallel: copy.parallel,
    perpendicular: copy.perpendicular,
    equal: copy.equal,
    tangent: copy.tangent,
    symmetric: copy.symmetric,
    concentric: copy.concentric,
    "point-on-line": copy.pointOnLine,
    "point-on-curve": copy.pointOnCurve,
    fixed: copy.fixed,
    "horizontal-distance": copy.horizontalDistance,
    offset: copy.offset,
    "vertical-distance": copy.verticalDistance,
    distance: copy.distance,
    angle: copy.angle,
    radius: copy.radius,
    diameter: copy.diameter,
    "primary-axis-diameter": copy.primaryAxisDiameter,
    "secondary-axis-diameter": copy.secondaryAxisDiameter,
  }[type]
}

function constraintValue(constraint: SketchRecord["constraints"][number]) {
  if (!("value" in constraint)) return null
  return (
    constraint.value.source.expression ??
    `${constraint.value.source.value} ${constraint.value.source.unit}`
  )
}

function dimensionOptions(kinds: readonly SketchDimensionKind[], copy: SketchEditorPanelCopy) {
  const labels: Record<SketchDimensionKind, string> = {
    angle: copy.angle,
    diameter: copy.diameter,
    distance: copy.distance,
    "horizontal-distance": copy.horizontalDistance,
    offset: copy.offset,
    "primary-axis-diameter": copy.primaryAxisDiameter,
    radius: copy.radius,
    "secondary-axis-diameter": copy.secondaryAxisDiameter,
    "vertical-distance": copy.verticalDistance,
  }
  return kinds.map((kind) => ({ kind, label: labels[kind] }))
}

function SketchDimensionForm({
  copy,
  entities,
  onAdd,
  options,
  variables,
}: {
  copy: SketchEditorPanelCopy
  entities: readonly SketchEntity[]
  onAdd: (definition: SketchConstraintDefinition) => void
  options: readonly DimensionOption[]
  variables: readonly VariableDefinition[]
}) {
  const displayUnits = useDocumentDisplayUnits()
  const [message, setMessage] = useState<string | null>(null)
  const firstOption = options[0]
  const suggestions = variableExpressionSuggestions(variables)
  const form = useAppForm({
    defaultValues: {
      kind: firstOption?.kind ?? ("distance" as SketchDimensionKind),
      expression:
        firstOption?.kind === "angle"
          ? defaultAngleExpression(Math.PI / 2, displayUnits.angle)
          : defaultLengthExpression(10, displayUnits.length),
    },
    onSubmit: ({ value }) => {
      const definition = createSketchDimensionDefinition(
        value.kind,
        value.expression,
        entities,
        variables,
        displayUnits,
      )
      if (!definition) {
        setMessage(copy.dimensionInvalid)
        return
      }
      setMessage(null)
      onAdd(definition)
    },
  })
  if (!firstOption) return null
  return (
    <Form form={form} aria-label={copy.dimensions} className="mt-2 gap-2">
      <form.Field name="kind">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="sketch-dimension-kind">{copy.dimension}</FieldLabel>
            <NativeSelect
              id="sketch-dimension-kind"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value as SketchDimensionKind)
              }
            >
              {options.map((option) => (
                <option key={option.kind} value={option.kind}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </form.Field>
      <form.Field name="expression">
        {(field) => (
          <VariableExpressionField
            id="sketch-dimension-expression"
            name={field.name}
            label={copy.dimensionExpression}
            value={field.state.value}
            error={message ?? undefined}
            suggestions={suggestions}
            inputClassName="font-mono tabular-nums"
            onBlur={field.handleBlur}
            onValueChange={(value) => {
              setMessage(null)
              field.handleChange(value)
            }}
          />
        )}
      </form.Field>
      <form.SubmitButton size="xs" requireDirty={false}>
        {copy.addConstraint}
      </form.SubmitButton>
    </Form>
  )
}

function SketchSetupSection({
  copy,
  disabled,
  draft,
  supportLabel,
  onDraftChange,
  onSupportReplace,
}: {
  copy: SketchEditorPanelCopy
  disabled: boolean
  draft: SketchRecord
  supportLabel: string | null
  onDraftChange: (draft: SketchRecord) => void
  onSupportReplace: () => void
}) {
  return (
    <section className="grid gap-2">
      <Field>
        <FieldLabel htmlFor="sketch-plane">{copy.plane}</FieldLabel>
        <div className="flex items-center gap-2">
          <NativeSelect
            id="sketch-plane"
            className="min-w-0 flex-1"
            value={draft.support ? "feature-face" : draft.plane}
            disabled={disabled || draft.support !== undefined || draft.entities.length > 0}
            onChange={(event) =>
              onDraftChange({ ...draft, plane: event.currentTarget.value as SketchRecord["plane"] })
            }
          >
            {draft.support ? (
              <option value="feature-face">{supportLabel ?? copy.planeFeatureFace}</option>
            ) : null}
            <option value="xy">{copy.planeXy}</option>
            <option value="xz">{copy.planeXz}</option>
            <option value="yz">{copy.planeYz}</option>
          </NativeSelect>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={disabled}
                aria-label={copy.replaceSupport}
                onClick={onSupportReplace}
              >
                <Layers3 aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copy.replaceSupport}</TooltipContent>
          </Tooltip>
        </div>
      </Field>
    </section>
  )
}

function ConstraintAction({
  definition,
  label,
  onAdd,
}: {
  definition: SketchConstraintDefinition | null
  label: string
  onAdd: (definition: SketchConstraintDefinition) => void
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={!definition}
      onClick={() => {
        if (definition) onAdd(definition)
      }}
    >
      {label}
    </Button>
  )
}

function SketchConstraintSection({
  copy,
  entities,
  onAdd,
  options,
  selectionKey,
  variables,
}: {
  copy: SketchEditorPanelCopy
  entities: readonly SketchEntity[]
  onAdd: (definition: SketchConstraintDefinition) => void
  options: readonly DimensionOption[]
  selectionKey: string
  variables: readonly VariableDefinition[]
}) {
  const availableActions = compatibleSketchConstraintTools(entities).map(
    ({ definition, kind }) => ({ definition, kind, label: constraintName(kind, copy) }),
  )
  return (
    <section className="grid gap-2 border-t pt-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {copy.addConstraint}
      </h3>
      {availableActions.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {availableActions.map(({ definition, kind, label }) => (
            <ConstraintAction key={kind} definition={definition} label={label} onAdd={onAdd} />
          ))}
        </div>
      ) : (
        <p className="text-xs leading-4 text-muted-foreground">{copy.selectionHint}</p>
      )}
      <SketchDimensionForm
        key={`${selectionKey}:${options.map(({ kind }) => kind).join(":")}`}
        copy={copy}
        entities={entities}
        options={options}
        variables={variables}
        onAdd={onAdd}
      />
    </section>
  )
}

function ConstraintRowActions({
  copy,
  editable,
  isEditing,
  onEdit,
  onRemove,
}: {
  copy: SketchEditorPanelCopy
  editable: boolean
  isEditing: boolean
  onEdit: (editing: boolean) => void
  onRemove: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {editable ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant={isEditing ? "secondary" : "ghost"}
              aria-label={isEditing ? copy.cancel : copy.editConstraint}
              aria-pressed={isEditing}
              onClick={() => onEdit(!isEditing)}
            >
              {isEditing ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isEditing ? copy.cancel : copy.editConstraint}</TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={copy.remove}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copy.remove}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function AppliedConstraintRow({
  constraint,
  copy,
  failed,
  isEditing,
  onEdit,
  onRemove,
  onSave,
  onSelect,
  selected,
  variables,
}: {
  constraint: SketchRecord["constraints"][number]
  copy: SketchEditorPanelCopy
  failed: boolean
  isEditing: boolean
  onEdit: (editing: boolean) => void
  onRemove: () => void
  onSave: (value: SketchDimensionValue) => void
  onSelect: () => void
  selected: boolean
  variables: readonly VariableDefinition[]
}) {
  const value = constraintValue(constraint)
  return (
    <li
      aria-invalid={failed || undefined}
      data-selected={selected || undefined}
      className="grid min-w-0 gap-2 rounded-sm border px-2 py-1 transition-colors data-[selected=true]:border-primary data-[selected=true]:bg-accent/60 aria-invalid:border-destructive aria-invalid:text-destructive"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="min-w-0 flex-1 justify-start truncate px-0 font-normal hover:bg-transparent"
          onClick={onSelect}
        >
          {constraintName(constraint.type, copy)}
          {value ? ` · ${value}` : ""}
          {failed ? ` · ${copy.conflict}` : ""}
        </Button>
        <ConstraintRowActions
          copy={copy}
          editable={value !== null}
          isEditing={isEditing}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      </div>
      {isEditing && "value" in constraint ? (
        <SketchDimensionEditForm
          constraint={constraint}
          copy={copy}
          variables={variables}
          onSave={onSave}
        />
      ) : null}
    </li>
  )
}

function SketchDimensionEditForm({
  constraint,
  copy,
  onSave,
  variables,
}: {
  constraint: Extract<SketchRecord["constraints"][number], { value: unknown }>
  copy: SketchEditorPanelCopy
  onSave: (value: SketchDimensionValue) => void
  variables: readonly VariableDefinition[]
}) {
  const displayUnits = useDocumentDisplayUnits()
  const [message, setMessage] = useState<string | null>(null)
  const suggestions = variableExpressionSuggestions(variables)
  const expressionId = `sketch-dimension-expression-${constraint.id}`
  const form = useAppForm({
    defaultValues: { expression: constraintValue(constraint) ?? "" },
    onSubmit: ({ value }) => {
      const nextValue = evaluateSketchDimensionValue(
        constraint.type,
        value.expression,
        variables,
        displayUnits,
      )
      if (!nextValue) {
        setMessage(copy.dimensionInvalid)
        return
      }
      setMessage(null)
      onSave(nextValue)
    },
  })
  return (
    <Form form={form} aria-label={copy.editConstraint} className="gap-2 border-t pt-2">
      <form.Field name="expression">
        {(field) => (
          <VariableExpressionField
            autoFocus
            id={expressionId}
            name={field.name}
            label={copy.dimensionExpression}
            value={field.state.value}
            error={message ?? undefined}
            suggestions={suggestions}
            inputClassName="font-mono tabular-nums"
            onBlur={field.handleBlur}
            onValueChange={(nextValue) => {
              setMessage(null)
              field.handleChange(nextValue)
            }}
          />
        )}
      </form.Field>
      <form.SubmitButton size="xs" requireDirty>
        {copy.saveDimension}
      </form.SubmitButton>
    </Form>
  )
}

function AppliedConstraintsSection({
  copy,
  draft,
  failedConstraintIds,
  onDraftChange,
  onSelectedConstraintChange,
  selectedConstraintId,
  variables,
}: {
  copy: SketchEditorPanelCopy
  draft: SketchRecord
  failedConstraintIds: readonly string[]
  onDraftChange: (draft: SketchRecord) => void
  onSelectedConstraintChange: (constraintId: SketchConstraintId | null) => void
  selectedConstraintId: SketchConstraintId | null
  variables: readonly VariableDefinition[]
}) {
  return (
    <section className="grid gap-2 border-t pt-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {copy.constraints}
      </h3>
      {draft.constraints.length > 0 ? (
        <ul className="grid gap-1">
          {draft.constraints.map((constraint) => (
            <AppliedConstraintRow
              key={constraint.id}
              constraint={constraint}
              copy={copy}
              failed={failedConstraintIds.includes(constraint.id)}
              isEditing={selectedConstraintId === constraint.id && "value" in constraint}
              selected={selectedConstraintId === constraint.id}
              variables={variables}
              onEdit={(editing) => onSelectedConstraintChange(editing ? constraint.id : null)}
              onRemove={() => {
                if (selectedConstraintId === constraint.id) onSelectedConstraintChange(null)
                onDraftChange(removeSketchConstraints(draft, [constraint.id]))
              }}
              onSelect={() => onSelectedConstraintChange(constraint.id)}
              onSave={(value) => {
                onDraftChange(setSketchDimensionValue(draft, constraint.id, value))
                onSelectedConstraintChange(null)
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{copy.noConstraints}</p>
      )}
    </section>
  )
}

function SketchProfilesSection({
  copy,
  onSelectedProfileChange,
  profiles,
  selectedProfile,
}: {
  copy: SketchEditorPanelCopy
  onSelectedProfileChange: (profile: SketchProfileSelector | null) => void
  profiles: readonly SketchProfileSelector[]
  selectedProfile: SketchProfileSelector | null
}) {
  if (profiles.length === 0) return null
  return (
    <section className="grid gap-2 border-t pt-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {copy.profiles}
      </h3>
      <div className="flex flex-wrap gap-1">
        {profiles.map((profile, index) => (
          <Button
            key={profile.outerBoundaryEntityIds.join(":")}
            type="button"
            size="xs"
            variant={selectedProfile === profile ? "secondary" : "outline"}
            aria-pressed={selectedProfile === profile}
            onClick={() => onSelectedProfileChange(profile)}
          >
            {copy.profile(index + 1)}
          </Button>
        ))}
      </div>
    </section>
  )
}

function SketchEditorFooter({
  canCreateFeature,
  copy,
  disabled,
  message,
  onCancel,
  onExtrude,
  onFinish,
  onRevolve,
}: {
  canCreateFeature: boolean
  copy: SketchEditorPanelCopy
  disabled: boolean
  message: string | null
  onCancel: () => void
  onExtrude: () => Promise<boolean>
  onFinish: () => Promise<void>
  onRevolve: () => Promise<boolean>
}) {
  return (
    <div className="mt-auto grid gap-2 border-t pt-3">
      <div className="grid gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {copy.cancel}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={canCreateFeature ? "outline" : "default"}
          disabled={disabled}
          onClick={onFinish}
        >
          {copy.finish}
        </Button>
        {canCreateFeature ? (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="sm" disabled={disabled} onClick={onExtrude}>
              {copy.extrude}
            </Button>
            <Button type="button" size="sm" disabled={disabled} onClick={onRevolve}>
              {copy.revolve}
            </Button>
          </div>
        ) : null}
      </div>
      {message ? (
        <p className="text-xs leading-4 text-destructive" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  )
}

function ExternalReferencesSection({
  candidates,
  copy,
  draft,
  labels,
  missingReferenceIds,
  onDraftChange,
  onReferenceRepairChange,
  repairReferenceId,
}: {
  candidates: readonly ExternalSketchGeometryCandidate[]
  copy: SketchEditorPanelCopy
  draft: SketchRecord
  labels: ReadonlyMap<string, string>
  missingReferenceIds: ReadonlySet<SketchExternalReferenceId>
  onDraftChange: (draft: SketchRecord) => void
  onReferenceRepairChange: (referenceId: SketchExternalReferenceId | null) => void
  repairReferenceId: SketchExternalReferenceId | null
}) {
  const references = draft.externalReferences ?? []

  function referenceLabel(reference: (typeof references)[number]) {
    const resolvedLabel = labels.get(reference.id)
    if (resolvedLabel) return resolvedLabel
    const candidate = candidates.find((value) =>
      externalReferenceMatchesCandidate(reference, value),
    )
    if (candidate) return candidate.label
    return copy.unavailableExternalReference
  }

  function repairable(reference: (typeof references)[number]) {
    return reference.kind !== "model-intersection"
  }

  return (
    <section className="grid gap-2 border-t pt-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {copy.externalReferences}
      </h3>
      <p className="text-xs leading-4 text-muted-foreground">{copy.externalReferenceDescription}</p>
      {references.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.noExternalReferences}</p>
      ) : (
        <ul className="grid gap-1">
          {references.map((reference) => {
            const missing = missingReferenceIds.has(reference.id)
            return (
              <li
                key={reference.id}
                className={
                  missing
                    ? "flex items-center gap-2 rounded-sm border border-destructive/50 bg-destructive/5 px-2 py-1 text-destructive"
                    : "flex items-center gap-2 rounded-sm border px-2 py-1"
                }
                data-external-reference-status={missing ? "missing" : "resolved"}
              >
                {missing ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleAlert
                        aria-label={copy.brokenExternalReference}
                        className="size-3.5 shrink-0"
                      />
                    </TooltipTrigger>
                    <TooltipContent>{copy.brokenExternalReference}</TooltipContent>
                  </Tooltip>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-xs">{referenceLabel(reference)}</span>
                {repairable(reference) ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={
                          repairReferenceId === reference.id
                            ? copy.cancelReferenceRepair
                            : copy.repairReference
                        }
                        aria-pressed={repairReferenceId === reference.id}
                        onClick={() =>
                          onReferenceRepairChange(
                            repairReferenceId === reference.id ? null : reference.id,
                          )
                        }
                      >
                        <Link2 aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {repairReferenceId === reference.id
                        ? copy.cancelReferenceRepair
                        : copy.repairReference}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={copy.remove}
                      onClick={() => {
                        if (repairReferenceId === reference.id) onReferenceRepairChange(null)
                        onDraftChange(removeSketchExternalReference(draft, reference.id))
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copy.remove}</TooltipContent>
                </Tooltip>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

type SketchEditorPanelState = Readonly<{
  disabled: boolean
  draft: SketchRecord
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  externalReferenceLabels: ReadonlyMap<string, string>
  missingExternalReferenceIds: ReadonlySet<SketchExternalReferenceId>
  extrusionAvailable: boolean
  failedConstraintIds: readonly string[]
  message: string | null
  profiles: readonly SketchProfileSelector[]
  repairReferenceId: SketchExternalReferenceId | null
  selectedEntityIds: readonly SketchEntityId[]
  selectedConstraintId: SketchConstraintId | null
  selectedProfile: SketchProfileSelector | null
  supportLabel: string | null
  variables: readonly VariableDefinition[]
}>

type SketchEditorPanelActions = Readonly<{
  onCancel: () => void
  onDraftChange: (draft: SketchRecord) => void
  onExtrude: () => Promise<boolean>
  onFinish: () => Promise<void>
  onRevolve: () => Promise<boolean>
  onReferenceRepairChange: (referenceId: SketchExternalReferenceId | null) => void
  onSupportReplace: () => void
  onSelectedConstraintChange: (constraintId: SketchConstraintId | null) => void
  onSelectedProfileChange: (profile: SketchProfileSelector | null) => void
}>

export function SketchEditorPanel({
  actions,
  copy,
  state,
}: {
  actions: SketchEditorPanelActions
  copy: SketchEditorPanelCopy
  state: SketchEditorPanelState
}) {
  const {
    disabled,
    draft,
    externalPointCandidates,
    externalReferenceLabels,
    missingExternalReferenceIds,
    extrusionAvailable,
    failedConstraintIds,
    message,
    profiles,
    repairReferenceId,
    selectedEntityIds,
    selectedConstraintId,
    selectedProfile,
    supportLabel,
    variables,
  } = state
  const {
    onCancel,
    onDraftChange,
    onExtrude,
    onFinish,
    onRevolve,
    onReferenceRepairChange,
    onSupportReplace,
    onSelectedConstraintChange,
    onSelectedProfileChange,
  } = actions
  const entities = useMemo(
    () => selectedSketchConstraintEntities(draft, selectedEntityIds),
    [draft, selectedEntityIds],
  )
  const optionKinds = compatibleSketchDimensionToolsForSelection(draft, selectedEntityIds)
  const options = dimensionOptions(optionKinds, copy)
  const apply = (definition: SketchConstraintDefinition) => {
    onDraftChange(appendSketchConstraint(draft, definition, createBrowserSketchConstraintId))
  }

  return (
    <div className="flex min-h-full flex-col gap-4">
      <div className="grid gap-4">
        <SketchSetupSection
          copy={copy}
          disabled={disabled}
          draft={draft}
          supportLabel={supportLabel}
          onDraftChange={onDraftChange}
          onSupportReplace={onSupportReplace}
        />
        <ExternalReferencesSection
          candidates={externalPointCandidates}
          copy={copy}
          draft={draft}
          labels={externalReferenceLabels}
          missingReferenceIds={missingExternalReferenceIds}
          onDraftChange={onDraftChange}
          onReferenceRepairChange={onReferenceRepairChange}
          repairReferenceId={repairReferenceId}
        />
        <SketchConstraintSection
          copy={copy}
          entities={entities}
          options={options}
          selectionKey={selectedEntityIds.join(":")}
          variables={variables}
          onAdd={apply}
        />
        <AppliedConstraintsSection
          copy={copy}
          draft={draft}
          failedConstraintIds={failedConstraintIds}
          selectedConstraintId={selectedConstraintId}
          variables={variables}
          onDraftChange={onDraftChange}
          onSelectedConstraintChange={onSelectedConstraintChange}
        />
        <SketchProfilesSection
          copy={copy}
          profiles={profiles}
          selectedProfile={selectedProfile}
          onSelectedProfileChange={onSelectedProfileChange}
        />
      </div>
      <SketchEditorFooter
        canCreateFeature={extrusionAvailable}
        copy={copy}
        disabled={disabled}
        message={message}
        onCancel={onCancel}
        onExtrude={onExtrude}
        onFinish={onFinish}
        onRevolve={onRevolve}
      />
    </div>
  )
}
