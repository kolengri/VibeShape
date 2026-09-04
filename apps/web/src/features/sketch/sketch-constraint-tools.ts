import type {
  SketchConstraintDefinition,
  SketchDimensionValue,
  SketchEntity,
  SketchEntityId,
  SketchRecord,
} from "@vibeshape/domain"
import { projectedExternalSketchEntities } from "@vibeshape/domain"

export type SketchDimensionKind =
  | "distance"
  | "horizontal-distance"
  | "vertical-distance"
  | "angle"
  | "radius"
  | "diameter"
  | "primary-axis-diameter"
  | "secondary-axis-diameter"
  | "offset"

export type SketchConstraintToolKind =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "equal"
  | "tangent"
  | "concentric"
  | "midpoint"
  | "symmetric"
  | "fixed"
  | "point-on-line"
  | "point-on-curve"

const mandatorySketchConstraintTools = [
  "coincident",
  "horizontal",
  "vertical",
  "parallel",
  "perpendicular",
  "equal",
  "tangent",
  "concentric",
  "midpoint",
  "symmetric",
  "fixed",
  "point-on-line",
  "point-on-curve",
] as const satisfies readonly SketchConstraintToolKind[]

export type SketchConstraintSelectionResult = Readonly<{
  selectedEntityIds: readonly SketchEntityId[]
  definition: SketchConstraintDefinition | null
}>

export function selectedSketchEntities(sketch: SketchRecord, ids: readonly SketchEntityId[]) {
  const selected = new Set<string>(ids)
  return sketch.entities.filter(({ id }) => selected.has(id))
}

export function selectedSketchConstraintEntities(
  sketch: SketchRecord,
  ids: readonly SketchEntityId[],
) {
  const selected = new Set<string>(ids)
  return [
    ...sketch.entities,
    ...projectedExternalSketchEntities(sketch.externalReferences ?? []),
  ].filter(({ id }) => selected.has(id))
}

export function selectedSketchLineId(sketch: SketchRecord, ids: readonly SketchEntityId[]) {
  const selected = selectedSketchEntities(sketch, ids)
  const line = selected[0]
  return selected.length === 1 && line?.type === "line" ? line.id : null
}

function entitiesOfType<Type extends SketchEntity["type"]>(
  entities: readonly SketchEntity[],
  type: Type,
): Array<Extract<SketchEntity, { type: Type }>> {
  return entities.filter(
    (entity): entity is Extract<SketchEntity, { type: Type }> => entity.type === type,
  )
}

function single<Value>(values: readonly Value[]): Value | null {
  return values.length === 1 ? (values[0] ?? null) : null
}

function pair<Value>(values: readonly Value[]): readonly [Value, Value] | null {
  const first = values[0]
  const second = values[1]
  return values.length === 2 && first !== undefined && second !== undefined ? [first, second] : null
}

type SketchPointEntity = Extract<SketchEntity, { type: "point" }>

function selectedPointAndTarget(
  entities: readonly SketchEntity[],
): Readonly<{ point: SketchPointEntity; target: SketchEntity }> | null {
  const selected = pair(entities)
  if (!selected) return null
  const [first, second] = selected
  if (first.type === "point" && second.type !== "point") {
    return { point: first, target: second }
  }
  if (second.type === "point" && first.type !== "point") {
    return { point: second, target: first }
  }
  return null
}

function roundCurves(entities: readonly SketchEntity[]) {
  return entities.filter(
    (entity): entity is Extract<SketchEntity, { type: "arc" | "circle" }> =>
      entity.type === "arc" || entity.type === "circle",
  )
}

type ConstraintBuilder = (entities: readonly SketchEntity[]) => SketchConstraintDefinition | null

function axisConstraint(
  type: "horizontal" | "vertical",
  entities: readonly SketchEntity[],
): SketchConstraintDefinition | null {
  const line = single(entitiesOfType(entities, "line"))
  if (entities.length === 1 && line) {
    return { type, lineId: line.id }
  }
  const points = pair(entitiesOfType(entities, "point"))
  return entities.length === 2 && points
    ? {
        type: type === "horizontal" ? "horizontal-points" : "vertical-points",
        firstPointId: points[0].id,
        secondPointId: points[1].id,
      }
    : null
}

function pairedLineConstraint(
  type: "parallel" | "perpendicular",
  entities: readonly SketchEntity[],
): SketchConstraintDefinition | null {
  const selected = pair(entitiesOfType(entities, "line"))
  return entities.length === 2 && selected
    ? { type, firstEntityId: selected[0].id, secondEntityId: selected[1].id }
    : null
}

const constraintBuilders = {
  coincident: (entities) => {
    const selected = pair(entitiesOfType(entities, "point"))
    return entities.length === 2 && selected
      ? {
          type: "coincident",
          firstPointId: selected[0].id,
          secondPointId: selected[1].id,
        }
      : null
  },
  concentric: (entities) => {
    const selected = pair(roundCurves(entities))
    return entities.length === 2 && selected
      ? {
          type: "concentric",
          firstEntityId: selected[0].id,
          secondEntityId: selected[1].id,
        }
      : null
  },
  equal: (entities) => {
    const selected = pair(entitiesOfType(entities, "line")) ?? pair(roundCurves(entities))
    return entities.length === 2 && selected
      ? { type: "equal", firstEntityId: selected[0].id, secondEntityId: selected[1].id }
      : null
  },
  fixed: (entities) => {
    const point = single(entitiesOfType(entities, "point"))
    return entities.length === 1 && point ? { type: "fixed", pointId: point.id } : null
  },
  horizontal: (entities) => axisConstraint("horizontal", entities),
  midpoint: (entities) => {
    const selection = selectedPointAndTarget(entities)
    if (!selection) return null
    if (selection.target.type === "line") {
      return {
        type: "midpoint",
        pointId: selection.point.id,
        lineId: selection.target.id,
      }
    }
    return selection.target.type === "arc"
      ? {
          type: "arc-midpoint",
          pointId: selection.point.id,
          arcId: selection.target.id,
        }
      : null
  },
  parallel: (entities) => pairedLineConstraint("parallel", entities),
  perpendicular: (entities) => pairedLineConstraint("perpendicular", entities),
  "point-on-curve": (entities) => {
    const selection = selectedPointAndTarget(entities)
    if (!selection) return null
    switch (selection.target.type) {
      case "arc":
      case "circle":
        return {
          type: "point-on-curve",
          pointId: selection.point.id,
          curveId: selection.target.id,
        }
      case "ellipse":
        return {
          type: "point-on-ellipse",
          pointId: selection.point.id,
          ellipseId: selection.target.id,
        }
      case "elliptical-arc":
        return {
          type: "point-on-elliptical-arc",
          pointId: selection.point.id,
          ellipticalArcId: selection.target.id,
        }
      default:
        return null
    }
  },
  "point-on-line": (entities) => {
    const selection = selectedPointAndTarget(entities)
    return selection?.target.type === "line"
      ? {
          type: "point-on-line",
          pointId: selection.point.id,
          lineId: selection.target.id,
        }
      : null
  },
  symmetric: (entities) => {
    const points = pair(entitiesOfType(entities, "point"))
    const line = single(entitiesOfType(entities, "line"))
    return entities.length === 3 && points && line
      ? {
          type: "symmetric",
          firstPointId: points[0].id,
          secondPointId: points[1].id,
          lineId: line.id,
        }
      : null
  },
  tangent: (entities) => {
    const line = single(entitiesOfType(entities, "line"))
    const arc = single(entitiesOfType(entities, "arc"))
    return entities.length === 2 && line && arc
      ? { type: "tangent", lineId: line.id, arcId: arc.id }
      : null
  },
  vertical: (entities) => axisConstraint("vertical", entities),
} satisfies Record<SketchConstraintToolKind, ConstraintBuilder>

const MAX_CONSTRAINT_SELECTION = 3

function containsAuthoredEntity(
  authoredIds: ReadonlySet<SketchEntityId>,
  ids: readonly SketchEntityId[],
): boolean {
  return ids.some((id) => authoredIds.has(id))
}

function representativeCompletionEntities(
  entities: readonly SketchEntity[],
  selectedIds: ReadonlySet<SketchEntityId>,
  authoredIds: ReadonlySet<SketchEntityId>,
  remainingSlots: number,
) {
  const buckets = new Map<
    SketchEntity["type"],
    { authored: SketchEntity[]; external: SketchEntity[] }
  >()
  for (const entity of entities) {
    if (selectedIds.has(entity.id)) continue
    const bucket = buckets.get(entity.type) ?? { authored: [], external: [] }
    const candidates = authoredIds.has(entity.id) ? bucket.authored : bucket.external
    if (candidates.length < remainingSlots) candidates.push(entity)
    buckets.set(entity.type, bucket)
  }
  return [...buckets.values()].flatMap(({ authored, external }) => [...authored, ...external])
}

function canCompleteConstraintSelection(
  kind: SketchConstraintToolKind,
  ids: readonly SketchEntityId[],
  entities: readonly SketchEntity[],
  authoredIds: ReadonlySet<SketchEntityId>,
): boolean {
  if (ids.length === 0 || ids.length > MAX_CONSTRAINT_SELECTION) return false
  const selectedIds = new Set(ids)
  const remaining = representativeCompletionEntities(
    entities,
    selectedIds,
    authoredIds,
    MAX_CONSTRAINT_SELECTION - ids.length,
  )
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]))
  const entitiesForIds = (candidateIds: readonly SketchEntityId[]) =>
    candidateIds.flatMap((id) => {
      const entity = entitiesById.get(id)
      return entity ? [entity] : []
    })
  const selectedEntities = entitiesForIds(ids)

  function search(start: number, additions: readonly SketchEntityId[]): boolean {
    const candidateIds = [...ids, ...additions]
    const candidateEntities = entitiesForIds(candidateIds)
    if (
      containsAuthoredEntity(authoredIds, candidateIds) &&
      constraintBuilders[kind](candidateEntities) !== null
    ) {
      return true
    }
    if (candidateIds.length >= MAX_CONSTRAINT_SELECTION) return false
    for (let index = start; index < remaining.length; index += 1) {
      const id = remaining[index]?.id
      if (id && search(index + 1, [...additions, id])) return true
    }
    return false
  }

  return (
    (containsAuthoredEntity(authoredIds, ids) &&
      constraintBuilders[kind](selectedEntities) !== null) ||
    search(0, [])
  )
}

/**
 * Advance a repeatable constraint tool by one canvas pick.
 * Completed definitions clear the selection so the same tool can be applied again.
 */
export function nextSketchConstraintSelection(
  sketch: SketchRecord,
  kind: SketchConstraintToolKind,
  currentIds: readonly SketchEntityId[],
  clickedEntityId: SketchEntityId,
): SketchConstraintSelectionResult {
  const availableIds = [
    ...sketch.entities.map(({ id }) => id),
    ...projectedExternalSketchEntities(sketch.externalReferences ?? []).map(({ id }) => id),
  ]
  const available = new Set(availableIds)
  const authoredIds = new Set(sketch.entities.map(({ id }) => id))
  if (!available.has(clickedEntityId)) return { selectedEntityIds: [], definition: null }

  const validCurrentIds = currentIds.filter(
    (id, index, ids) => available.has(id) && ids.indexOf(id) === index,
  )
  if (validCurrentIds.includes(clickedEntityId)) {
    return {
      selectedEntityIds: validCurrentIds.filter((id) => id !== clickedEntityId),
      definition: null,
    }
  }

  const candidateIds = [...validCurrentIds, clickedEntityId]
  const candidateEntities = selectedSketchConstraintEntities(sketch, candidateIds)
  const definition = constraintBuilders[kind](candidateEntities)
  if (definition && containsAuthoredEntity(authoredIds, candidateIds)) {
    return { selectedEntityIds: [], definition }
  }

  const allEntities = selectedSketchConstraintEntities(sketch, availableIds)
  if (canCompleteConstraintSelection(kind, candidateIds, allEntities, authoredIds)) {
    return { selectedEntityIds: candidateIds, definition: null }
  }
  return canCompleteConstraintSelection(kind, [clickedEntityId], allEntities, authoredIds)
    ? { selectedEntityIds: [clickedEntityId], definition: null }
    : { selectedEntityIds: [], definition: null }
}

export function compatibleSketchConstraintTools(entities: readonly SketchEntity[]) {
  return mandatorySketchConstraintTools.flatMap((kind) => {
    const definition = constraintBuilders[kind](entities)
    return definition ? [{ kind, definition }] : []
  })
}

export function compatibleSketchConstraintToolsForSelection(
  sketch: SketchRecord,
  ids: readonly SketchEntityId[],
) {
  const authoredIds = new Set(sketch.entities.map(({ id }) => id))
  if (!ids.some((id) => authoredIds.has(id))) return []
  return compatibleSketchConstraintTools(selectedSketchConstraintEntities(sketch, ids))
}

export function compatibleSketchDimensionTools(
  entities: readonly SketchEntity[],
): readonly SketchDimensionKind[] {
  const selection = entities
    .map(({ type }) => type)
    .sort()
    .join(":")
  return (
    (
      {
        arc: ["radius", "diameter"],
        circle: ["radius", "diameter"],
        ellipse: ["primary-axis-diameter", "secondary-axis-diameter"],
        "elliptical-arc": ["primary-axis-diameter", "secondary-axis-diameter"],
        line: ["distance"],
        "line:line": ["angle"],
        "point:point": ["distance", "horizontal-distance", "vertical-distance"],
      } satisfies Record<string, readonly SketchDimensionKind[]>
    )[selection] ?? []
  )
}

export function compatibleSketchDimensionToolsForSelection(
  sketch: SketchRecord,
  ids: readonly SketchEntityId[],
) {
  const authoredIds = new Set(sketch.entities.map(({ id }) => id))
  if (!ids.some((id) => authoredIds.has(id))) return []
  return compatibleSketchDimensionTools(selectedSketchConstraintEntities(sketch, ids))
}

export function nextSketchDimensionSelection(
  sketch: SketchRecord,
  currentIds: readonly SketchEntityId[],
  entityId: SketchEntityId,
) {
  if (currentIds.includes(entityId)) {
    return currentIds.filter((candidate) => candidate !== entityId)
  }
  const candidateIds = [...currentIds, entityId]
  if (
    compatibleSketchDimensionToolsForSelection(sketch, candidateIds).length > 0 ||
    currentIds.length === 0
  ) {
    return candidateIds
  }
  return [entityId]
}

export function createSketchDimensionConstraint(
  kind: SketchDimensionKind,
  entities: readonly SketchEntity[],
  value: SketchDimensionValue,
): SketchConstraintDefinition | null {
  if (kind === "offset") return null
  if (!compatibleSketchDimensionTools(entities).includes(kind)) return null
  if (kind === "angle") return createAngleDimensionConstraint(entities, value)
  if (kind === "radius" || kind === "diameter") {
    return createRoundDimensionConstraint(kind, entities, value)
  }
  if (kind === "primary-axis-diameter" || kind === "secondary-axis-diameter") {
    return createEllipseAxisDimensionConstraint(kind, entities, value)
  }
  return createLinearDimensionConstraint(kind, entities, value)
}

export function createSketchReferenceDimensionConstraint(
  kind: SketchDimensionKind,
  entities: readonly SketchEntity[],
): SketchConstraintDefinition | null {
  if (
    kind === "offset" ||
    kind === "primary-axis-diameter" ||
    kind === "secondary-axis-diameter" ||
    !compatibleSketchDimensionTools(entities).includes(kind)
  ) {
    return null
  }
  if (kind === "angle") return createReferenceAngleDimension(entities)
  if (kind === "radius" || kind === "diameter") {
    return createReferenceRadialDimension(kind, entities)
  }
  return createReferenceLinearDimension(kind, entities)
}

function createReferenceAngleDimension(
  entities: readonly SketchEntity[],
): SketchConstraintDefinition | null {
  const lines = pair(entitiesOfType(entities, "line"))
  return lines
    ? {
        type: "angle",
        firstEntityId: lines[0].id,
        secondEntityId: lines[1].id,
        mode: "reference",
      }
    : null
}

function createReferenceRadialDimension(
  kind: "radius" | "diameter",
  entities: readonly SketchEntity[],
): SketchConstraintDefinition | null {
  const curve = roundCurves(entities)[0]
  if (!curve) return null
  return kind === "radius"
    ? { type: "radius", curveId: curve.id, mode: "reference" }
    : { type: "diameter", curveId: curve.id, mode: "reference" }
}

function createReferenceLinearDimension(
  kind: "distance" | "horizontal-distance" | "vertical-distance",
  entities: readonly SketchEntity[],
): SketchConstraintDefinition | null {
  const points = pair(entitiesOfType(entities, "point"))
  const line = entitiesOfType(entities, "line")[0]
  const pointIds = points
    ? ([points[0].id, points[1].id] as const)
    : kind === "distance" && line
      ? ([line.startPointId, line.endPointId] as const)
      : null
  if (!pointIds) return null
  const ids = { firstPointId: pointIds[0], secondPointId: pointIds[1] }
  if (kind === "distance") return { type: "distance", ...ids, mode: "reference" }
  if (kind === "horizontal-distance") {
    return { type: "horizontal-distance", ...ids, mode: "reference" }
  }
  return { type: "vertical-distance", ...ids, mode: "reference" }
}

function createAngleDimensionConstraint(
  entities: readonly SketchEntity[],
  value: SketchDimensionValue,
): SketchConstraintDefinition | null {
  const lines = pair(entitiesOfType(entities, "line"))
  return lines && value.dimension === "angle"
    ? {
        type: "angle",
        firstEntityId: lines[0].id,
        secondEntityId: lines[1].id,
        value,
      }
    : null
}

function createRoundDimensionConstraint(
  kind: "radius" | "diameter",
  entities: readonly SketchEntity[],
  value: SketchDimensionValue,
): SketchConstraintDefinition | null {
  const curve = roundCurves(entities)[0]
  return curve && value.dimension === "length" && value.value > 0
    ? kind === "radius"
      ? { type: "radius", curveId: curve.id, value }
      : { type: "diameter", curveId: curve.id, value }
    : null
}

function createEllipseAxisDimensionConstraint(
  kind: "primary-axis-diameter" | "secondary-axis-diameter",
  entities: readonly SketchEntity[],
  value: SketchDimensionValue,
): SketchConstraintDefinition | null {
  const curve = entities.find(
    (entity): entity is Extract<SketchEntity, { type: "ellipse" | "elliptical-arc" }> =>
      entity.type === "ellipse" || entity.type === "elliptical-arc",
  )
  return curve && value.dimension === "length" && value.value > 0
    ? { type: kind, curveId: curve.id, value }
    : null
}

function createLinearDimensionConstraint(
  kind: "distance" | "horizontal-distance" | "vertical-distance",
  entities: readonly SketchEntity[],
  value: SketchDimensionValue,
): SketchConstraintDefinition | null {
  if (value.dimension !== "length" || value.value <= 0) return null
  const points = pair(entitiesOfType(entities, "point"))
  const line = entitiesOfType(entities, "line")[0]
  const pointIds = points
    ? ([points[0].id, points[1].id] as const)
    : kind === "distance" && line
      ? ([line.startPointId, line.endPointId] as const)
      : null
  if (!pointIds) return null
  const ids = { firstPointId: pointIds[0], secondPointId: pointIds[1], value }
  if (kind === "distance") return { type: "distance", ...ids }
  if (kind === "horizontal-distance") return { type: "horizontal-distance", ...ids }
  return { type: "vertical-distance", ...ids }
}
