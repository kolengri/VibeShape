import {
  appendSketchConstraint,
  createAngleQuantity,
  createLengthQuantity,
  evaluateExpression,
  evaluateVariableDefinitions,
  removeSketchConstraints,
  type SketchConstraintDefinition,
  type SketchEntity,
  type SketchEntityId,
  type SketchProfileSelector,
  type SketchRecord,
  type VariableDefinition,
} from "@vibeshape/domain"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { TextField } from "@vibeshape/ui/components/text-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import type { ComponentProps } from "react"
import { useMemo, useState } from "react"
import { createBrowserSketchConstraintId } from "../../document/document-controller"
import {
  defaultAngleExpression,
  defaultLengthExpression,
  normalizeExpressionWithDisplayUnit,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"

type DimensionKind =
  | "distance"
  | "horizontal-distance"
  | "vertical-distance"
  | "angle"
  | "radius"
  | "diameter"

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
  equal: string
  finish: string
  fixed: string
  horizontal: string
  horizontalDistance: string
  noConstraints: string
  parallel: string
  perpendicular: string
  plane: string
  planeXy: string
  planeXz: string
  planeYz: string
  pointOnCurve: string
  pointOnLine: string
  profile: (number: number) => string
  profiles: string
  radius: string
  remove: string
  selectionHint: string
  tangent: string
  vertical: string
  verticalDistance: string
}>

type DimensionOption = Readonly<{ kind: DimensionKind; label: string }>

function constraintName(
  type: SketchRecord["constraints"][number]["type"],
  copy: SketchEditorPanelCopy,
) {
  return {
    coincident: copy.coincident,
    horizontal: copy.horizontal,
    vertical: copy.vertical,
    parallel: copy.parallel,
    perpendicular: copy.perpendicular,
    equal: copy.equal,
    tangent: copy.tangent,
    concentric: copy.concentric,
    "point-on-line": copy.pointOnLine,
    "point-on-curve": copy.pointOnCurve,
    fixed: copy.fixed,
    "horizontal-distance": copy.horizontalDistance,
    "vertical-distance": copy.verticalDistance,
    distance: copy.distance,
    angle: copy.angle,
    radius: copy.radius,
    diameter: copy.diameter,
  }[type]
}

function constraintValue(constraint: SketchRecord["constraints"][number]) {
  if (!("value" in constraint)) return null
  return (
    constraint.value.source.expression ??
    `${constraint.value.source.value} ${constraint.value.source.unit}`
  )
}

function selectedEntities(sketch: SketchRecord, ids: readonly SketchEntityId[]) {
  const selected = new Set<string>(ids)
  return sketch.entities.filter(({ id }) => selected.has(id))
}

function entitiesOfType<Type extends SketchEntity["type"]>(
  entities: readonly SketchEntity[],
  type: Type,
): Array<Extract<SketchEntity, { type: Type }>> {
  return entities.filter(
    (entity): entity is Extract<SketchEntity, { type: Type }> => entity.type === type,
  )
}

function pair<T>(values: readonly T[]): readonly [T, T] | null {
  const first = values[0]
  const second = values[1]
  return values.length === 2 && first && second ? [first, second] : null
}

function curves(entities: readonly SketchEntity[]) {
  return entities.filter(
    (entity): entity is Extract<SketchEntity, { type: "arc" | "circle" }> =>
      entity.type === "arc" || entity.type === "circle",
  )
}

type GeometricConstraintKind = Exclude<
  SketchConstraintDefinition["type"],
  DimensionKind | "point-on-curve" | "point-on-line" | "fixed"
>

type ConstraintBuilder = (entities: readonly SketchEntity[]) => SketchConstraintDefinition | null

function axisConstraint(
  type: "horizontal" | "vertical",
  entities: readonly SketchEntity[],
): SketchConstraintDefinition | null {
  const lines = entitiesOfType(entities, "line")
  return lines.length === 1 && lines[0] ? { type, lineId: lines[0].id } : null
}

function pairedLineConstraint(
  type: "parallel" | "perpendicular",
  entities: readonly SketchEntity[],
): SketchConstraintDefinition | null {
  const selected = pair(entitiesOfType(entities, "line"))
  return selected ? { type, firstEntityId: selected[0].id, secondEntityId: selected[1].id } : null
}

const geometricConstraintBuilders = {
  coincident: (entities) => {
    const selected = pair(entitiesOfType(entities, "point"))
    return selected
      ? {
          type: "coincident",
          firstPointId: selected[0].id,
          secondPointId: selected[1].id,
        }
      : null
  },
  concentric: (entities) => {
    const selected = pair(curves(entities))
    return selected
      ? {
          type: "concentric",
          firstEntityId: selected[0].id,
          secondEntityId: selected[1].id,
        }
      : null
  },
  equal: (entities) => {
    const selected = pair(entitiesOfType(entities, "line")) ?? pair(curves(entities))
    return selected
      ? { type: "equal", firstEntityId: selected[0].id, secondEntityId: selected[1].id }
      : null
  },
  horizontal: (entities) => axisConstraint("horizontal", entities),
  parallel: (entities) => pairedLineConstraint("parallel", entities),
  perpendicular: (entities) => pairedLineConstraint("perpendicular", entities),
  tangent: (entities) => {
    const lines = entitiesOfType(entities, "line")
    const arcs = entitiesOfType(entities, "arc")
    return lines.length === 1 && lines[0] && arcs.length === 1 && arcs[0]
      ? { type: "tangent", lineId: lines[0].id, arcId: arcs[0].id }
      : null
  },
  vertical: (entities) => axisConstraint("vertical", entities),
} satisfies Record<GeometricConstraintKind, ConstraintBuilder>

function geometricConstraintDefinition(
  kind: GeometricConstraintKind,
  entities: readonly SketchEntity[],
) {
  return geometricConstraintBuilders[kind](entities)
}

const pointConstraintBuilders = {
  fixed: (entities) => {
    const points = entitiesOfType(entities, "point")
    return points.length === 1 && points[0]
      ? { type: "fixed" as const, pointId: points[0].id }
      : null
  },
  "point-on-curve": (entities) => {
    const points = entitiesOfType(entities, "point")
    const targets = curves(entities)
    return points.length === 1 && points[0] && targets.length === 1 && targets[0]
      ? { type: "point-on-curve" as const, pointId: points[0].id, curveId: targets[0].id }
      : null
  },
  "point-on-line": (entities) => {
    const points = entitiesOfType(entities, "point")
    const lines = entitiesOfType(entities, "line")
    return points.length === 1 && points[0] && lines.length === 1 && lines[0]
      ? { type: "point-on-line" as const, pointId: points[0].id, lineId: lines[0].id }
      : null
  },
} satisfies Record<"point-on-curve" | "point-on-line" | "fixed", ConstraintBuilder>

function pointEntityConstraintDefinition(
  kind: keyof typeof pointConstraintBuilders,
  entities: readonly SketchEntity[],
) {
  return pointConstraintBuilders[kind](entities)
}

function dimensionOptions(entities: readonly SketchEntity[], copy: SketchEditorPanelCopy) {
  const selection = entities
    .map(({ type }) => type)
    .sort()
    .join(":")
  return (
    (
      {
        arc: [
          { kind: "radius", label: copy.radius },
          { kind: "diameter", label: copy.diameter },
        ],
        circle: [
          { kind: "radius", label: copy.radius },
          { kind: "diameter", label: copy.diameter },
        ],
        "line:line": [{ kind: "angle", label: copy.angle }],
        "point:point": [
          { kind: "distance", label: copy.distance },
          { kind: "horizontal-distance", label: copy.horizontalDistance },
          { kind: "vertical-distance", label: copy.verticalDistance },
        ],
      } satisfies Record<string, DimensionOption[]>
    )[selection] ?? []
  )
}

function SketchDimensionField(props: ComponentProps<typeof TextField>) {
  return <TextField {...props} />
}

function angleDimensionDefinition(
  expression: string,
  entities: readonly SketchEntity[],
  value: Readonly<{ dimension: string; value: number }>,
) {
  const linesPair = pair(entitiesOfType(entities, "line"))
  if (!linesPair || value.dimension !== "angle") return null
  return {
    type: "angle",
    firstEntityId: linesPair[0].id,
    secondEntityId: linesPair[1].id,
    value: createAngleQuantity(value.value, "rad", expression.trim()),
  } as const
}

function lengthDimensionDefinition(
  kind: Exclude<DimensionKind, "angle">,
  expression: string,
  entities: readonly SketchEntity[],
  evaluated: Readonly<{ dimension: string; value: number }>,
) {
  if (evaluated.dimension !== "length" || evaluated.value <= 0) return null
  const value = createLengthQuantity(evaluated.value, "mm", expression.trim())
  if (kind === "radius" || kind === "diameter") {
    const curve = curves(entities)[0]
    return curve ? ({ type: kind, curveId: curve.id, value } as const) : null
  }
  const pointsPair = pair(entitiesOfType(entities, "point"))
  return pointsPair
    ? ({
        type: kind,
        firstPointId: pointsPair[0].id,
        secondPointId: pointsPair[1].id,
        value,
      } as const)
    : null
}

function dimensionDefinition(
  kind: DimensionKind,
  expression: string,
  entities: readonly SketchEntity[],
  variables: readonly VariableDefinition[],
  displayUnits: ReturnType<typeof useDocumentDisplayUnits>,
) {
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  if (!evaluatedVariables.ok) return null
  const normalizedExpression = normalizeExpressionWithDisplayUnit(
    expression,
    kind === "angle" ? displayUnits.angle : displayUnits.length,
  )
  const evaluated = evaluateExpression(normalizedExpression, evaluatedVariables.valuesByName)
  if (!evaluated.ok) return null
  return kind === "angle"
    ? angleDimensionDefinition(normalizedExpression, entities, evaluated.value)
    : lengthDimensionDefinition(kind, normalizedExpression, entities, evaluated.value)
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
  const form = useAppForm({
    defaultValues: {
      kind: firstOption?.kind ?? ("distance" as DimensionKind),
      expression:
        firstOption?.kind === "angle"
          ? defaultAngleExpression(Math.PI / 2, displayUnits.angle)
          : defaultLengthExpression(10, displayUnits.length),
    },
    onSubmit: ({ value }) => {
      const definition = dimensionDefinition(
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
              onChange={(event) => field.handleChange(event.currentTarget.value as DimensionKind)}
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
          <SketchDimensionField
            id="sketch-dimension-expression"
            name={field.name}
            label={copy.dimensionExpression}
            value={field.state.value}
            error={message ?? undefined}
            onBlur={field.handleBlur}
            onChange={(event) => {
              setMessage(null)
              field.handleChange(event.currentTarget.value)
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
  draft,
  onDraftChange,
}: {
  copy: SketchEditorPanelCopy
  draft: SketchRecord
  onDraftChange: (draft: SketchRecord) => void
}) {
  return (
    <section className="grid gap-2">
      <Field>
        <FieldLabel htmlFor="sketch-plane">{copy.plane}</FieldLabel>
        <NativeSelect
          id="sketch-plane"
          value={draft.plane}
          disabled={draft.entities.length > 0}
          onChange={(event) =>
            onDraftChange({ ...draft, plane: event.currentTarget.value as SketchRecord["plane"] })
          }
        >
          <option value="xy">{copy.planeXy}</option>
          <option value="xz">{copy.planeXz}</option>
          <option value="yz">{copy.planeYz}</option>
        </NativeSelect>
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
  const geometricActions = [
    ["coincident", copy.coincident],
    ["horizontal", copy.horizontal],
    ["vertical", copy.vertical],
    ["parallel", copy.parallel],
    ["perpendicular", copy.perpendicular],
    ["equal", copy.equal],
    ["tangent", copy.tangent],
    ["concentric", copy.concentric],
  ] as const
  const pointActions = [
    ["fixed", copy.fixed],
    ["point-on-line", copy.pointOnLine],
    ["point-on-curve", copy.pointOnCurve],
  ] as const
  const availableActions = [
    ...geometricActions.map(([kind, label]) => ({
      kind,
      label,
      definition: geometricConstraintDefinition(kind, entities),
    })),
    ...pointActions.map(([kind, label]) => ({
      kind,
      label,
      definition: pointEntityConstraintDefinition(kind, entities),
    })),
  ].filter(
    (action): action is typeof action & Readonly<{ definition: SketchConstraintDefinition }> =>
      action.definition !== null,
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

function AppliedConstraintRow({
  constraint,
  copy,
  failed,
  onRemove,
}: {
  constraint: SketchRecord["constraints"][number]
  copy: SketchEditorPanelCopy
  failed: boolean
  onRemove: () => void
}) {
  const value = constraintValue(constraint)
  return (
    <li
      aria-invalid={failed || undefined}
      className="flex min-w-0 items-center justify-between gap-2 rounded-sm border px-2 py-1 aria-invalid:border-destructive aria-invalid:text-destructive"
    >
      <span className="min-w-0 truncate text-xs">
        {constraintName(constraint.type, copy)}
        {value ? ` · ${value}` : ""}
        {failed ? ` · ${copy.conflict}` : ""}
      </span>
      <Button type="button" size="xs" variant="ghost" onClick={onRemove}>
        {copy.remove}
      </Button>
    </li>
  )
}

function AppliedConstraintsSection({
  copy,
  draft,
  failedConstraintIds,
  onDraftChange,
}: {
  copy: SketchEditorPanelCopy
  draft: SketchRecord
  failedConstraintIds: readonly string[]
  onDraftChange: (draft: SketchRecord) => void
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
              onRemove={() => onDraftChange(removeSketchConstraints(draft, [constraint.id]))}
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
  copy,
  disabled,
  message,
  onCancel,
  onFinish,
}: {
  copy: SketchEditorPanelCopy
  disabled: boolean
  message: string | null
  onCancel: () => void
  onFinish: () => Promise<void>
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 grid gap-2 border-t bg-panel px-4 py-3">
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {copy.cancel}
        </Button>
        <Button type="button" size="sm" disabled={disabled} onClick={onFinish}>
          {copy.finish}
        </Button>
      </div>
      {message ? (
        <p className="text-xs leading-4 text-destructive" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  )
}

type SketchEditorPanelState = Readonly<{
  disabled: boolean
  draft: SketchRecord
  failedConstraintIds: readonly string[]
  message: string | null
  profiles: readonly SketchProfileSelector[]
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  variables: readonly VariableDefinition[]
}>

type SketchEditorPanelActions = Readonly<{
  onCancel: () => void
  onDraftChange: (draft: SketchRecord) => void
  onFinish: () => Promise<void>
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
    failedConstraintIds,
    message,
    profiles,
    selectedEntityIds,
    selectedProfile,
    variables,
  } = state
  const { onCancel, onDraftChange, onFinish, onSelectedProfileChange } = actions
  const entities = useMemo(
    () => selectedEntities(draft, selectedEntityIds),
    [draft, selectedEntityIds],
  )
  const options = dimensionOptions(entities, copy)
  const apply = (definition: SketchConstraintDefinition) => {
    onDraftChange(appendSketchConstraint(draft, definition, createBrowserSketchConstraintId))
  }

  return (
    <div className="grid gap-4">
      <SketchSetupSection copy={copy} draft={draft} onDraftChange={onDraftChange} />
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
        onDraftChange={onDraftChange}
      />
      <SketchProfilesSection
        copy={copy}
        profiles={profiles}
        selectedProfile={selectedProfile}
        onSelectedProfileChange={onSelectedProfileChange}
      />
      <SketchEditorFooter
        copy={copy}
        disabled={disabled}
        message={message}
        onCancel={onCancel}
        onFinish={onFinish}
      />
    </div>
  )
}
