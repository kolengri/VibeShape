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
import type { ComponentProps, ReactNode } from "react"
import { useMemo, useState } from "react"
import { createBrowserSketchConstraintId } from "../../document/document-controller"
import type { SketchEditorTool } from "./sketch-tool"

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
  arc: string
  cancel: string
  circle: string
  coincident: string
  concentric: string
  conflict: string
  construction: string
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
  geometry: string
  horizontal: string
  horizontalDistance: string
  line: string
  noConstraints: string
  parallel: string
  perpendicular: string
  plane: string
  planeXy: string
  planeXz: string
  planeYz: string
  pointOnCurve: string
  pointOnLine: string
  point: string
  profile: (number: number) => string
  profiles: string
  radius: string
  rectangle: string
  redo: string
  remove: string
  select: string
  tangent: string
  undo: string
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
) {
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  if (!evaluatedVariables.ok) return null
  const evaluated = evaluateExpression(expression.trim(), evaluatedVariables.valuesByName)
  if (!evaluated.ok) return null
  return kind === "angle"
    ? angleDimensionDefinition(expression, entities, evaluated.value)
    : lengthDimensionDefinition(kind, expression, entities, evaluated.value)
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
  const [message, setMessage] = useState<string | null>(null)
  const firstOption = options[0]
  const form = useAppForm({
    defaultValues: {
      kind: firstOption?.kind ?? ("distance" as DimensionKind),
      expression: firstOption?.kind === "angle" ? "90 deg" : "10 mm",
    },
    onSubmit: ({ value }) => {
      const definition = dimensionDefinition(value.kind, value.expression, entities, variables)
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

function ToolButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={active ? "secondary" : "outline"}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function SketchGeometrySection({
  construction,
  copy,
  draft,
  editorTool,
  onConstructionChange,
  onDraftChange,
  onEditorToolChange,
  onRedo,
  onUndo,
  redoAvailable,
  undoAvailable,
}: {
  construction: boolean
  copy: SketchEditorPanelCopy
  draft: SketchRecord
  editorTool: SketchEditorTool
  onConstructionChange: (construction: boolean) => void
  onDraftChange: (draft: SketchRecord) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  onRedo: () => void
  onUndo: () => void
  redoAvailable: boolean
  undoAvailable: boolean
}) {
  const tools = [
    ["select", copy.select],
    ["point", copy.point],
    ["line", copy.line],
    ["rectangle", copy.rectangle],
    ["circle", copy.circle],
    ["arc", copy.arc],
  ] as const
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {copy.geometry}
      </h3>
      <div className="flex flex-wrap gap-1">
        {tools.map(([tool, label]) => (
          <ToolButton
            key={tool}
            active={editorTool === tool}
            onClick={() => onEditorToolChange(tool)}
          >
            {label}
          </ToolButton>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Button type="button" size="xs" variant="ghost" disabled={!undoAvailable} onClick={onUndo}>
          {copy.undo}
        </Button>
        <Button type="button" size="xs" variant="ghost" disabled={!redoAvailable} onClick={onRedo}>
          {copy.redo}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={construction}
          onChange={(event) => onConstructionChange(event.currentTarget.checked)}
        />
        {copy.construction}
      </label>
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
  return (
    <section className="grid gap-2 border-t pt-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {copy.addConstraint}
      </h3>
      <div className="flex flex-wrap gap-1">
        {geometricActions.map(([kind, label]) => (
          <ConstraintAction
            key={kind}
            definition={geometricConstraintDefinition(kind, entities)}
            label={label}
            onAdd={onAdd}
          />
        ))}
        {pointActions.map(([kind, label]) => (
          <ConstraintAction
            key={kind}
            definition={pointEntityConstraintDefinition(kind, entities)}
            label={label}
            onAdd={onAdd}
          />
        ))}
      </div>
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
    <>
      <div className="grid grid-cols-2 gap-2 border-t pt-3">
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
    </>
  )
}

type SketchEditorPanelState = Readonly<{
  construction: boolean
  disabled: boolean
  draft: SketchRecord
  editorTool: SketchEditorTool
  failedConstraintIds: readonly string[]
  message: string | null
  profiles: readonly SketchProfileSelector[]
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  redoAvailable: boolean
  undoAvailable: boolean
  variables: readonly VariableDefinition[]
}>

type SketchEditorPanelActions = Readonly<{
  onCancel: () => void
  onConstructionChange: (construction: boolean) => void
  onDraftChange: (draft: SketchRecord) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  onFinish: () => Promise<void>
  onRedo: () => void
  onSelectedProfileChange: (profile: SketchProfileSelector | null) => void
  onUndo: () => void
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
    construction,
    disabled,
    draft,
    editorTool,
    failedConstraintIds,
    message,
    profiles,
    redoAvailable,
    selectedEntityIds,
    selectedProfile,
    undoAvailable,
    variables,
  } = state
  const {
    onCancel,
    onConstructionChange,
    onDraftChange,
    onEditorToolChange,
    onFinish,
    onRedo,
    onSelectedProfileChange,
    onUndo,
  } = actions
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
      <SketchGeometrySection
        construction={construction}
        copy={copy}
        draft={draft}
        editorTool={editorTool}
        redoAvailable={redoAvailable}
        undoAvailable={undoAvailable}
        onConstructionChange={onConstructionChange}
        onDraftChange={onDraftChange}
        onEditorToolChange={onEditorToolChange}
        onRedo={onRedo}
        onUndo={onUndo}
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
