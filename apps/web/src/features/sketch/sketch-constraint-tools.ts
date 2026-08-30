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

function pair<Value>(values: readonly Value[]): readonly [Value, Value] | null {
  const first = values[0]
  const second = values[1]
  return values.length === 2 && first && second ? [first, second] : null
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
  const lines = entitiesOfType(entities, "line")
  if (entities.length === 1 && lines.length === 1 && lines[0]) {
    return { type, lineId: lines[0].id }
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
    const points = entitiesOfType(entities, "point")
    return entities.length === 1 && points.length === 1 && points[0]
      ? { type: "fixed", pointId: points[0].id }
      : null
  },
  horizontal: (entities) => axisConstraint("horizontal", entities),
  midpoint: (entities) => {
    const points = entitiesOfType(entities, "point")
    const lines = entitiesOfType(entities, "line")
    const arcs = entitiesOfType(entities, "arc")
    if (entities.length !== 2 || points.length !== 1 || !points[0]) return null
    if (lines.length === 1 && lines[0]) {
      return { type: "midpoint", pointId: points[0].id, lineId: lines[0].id }
    }
    return arcs.length === 1 && arcs[0]
      ? { type: "arc-midpoint", pointId: points[0].id, arcId: arcs[0].id }
      : null
  },
  parallel: (entities) => pairedLineConstraint("parallel", entities),
  perpendicular: (entities) => pairedLineConstraint("perpendicular", entities),
  "point-on-curve": (entities) => {
    const points = entitiesOfType(entities, "point")
    if (entities.length !== 2 || points.length !== 1 || !points[0]) return null
    const roundTarget = roundCurves(entities)[0]
    if (roundTarget) {
      return { type: "point-on-curve", pointId: points[0].id, curveId: roundTarget.id }
    }
    const ellipseTarget = entitiesOfType(entities, "ellipse")[0]
    if (ellipseTarget) {
      return { type: "point-on-ellipse", pointId: points[0].id, ellipseId: ellipseTarget.id }
    }
    const ellipticalArcTarget = entitiesOfType(entities, "elliptical-arc")[0]
    return ellipticalArcTarget
      ? {
          type: "point-on-elliptical-arc",
          pointId: points[0].id,
          ellipticalArcId: ellipticalArcTarget.id,
        }
      : null
  },
  "point-on-line": (entities) => {
    const points = entitiesOfType(entities, "point")
    const lines = entitiesOfType(entities, "line")
    return entities.length === 2 &&
      points.length === 1 &&
      points[0] &&
      lines.length === 1 &&
      lines[0]
      ? { type: "point-on-line", pointId: points[0].id, lineId: lines[0].id }
      : null
  },
  symmetric: (entities) => {
    const points = pair(entitiesOfType(entities, "point"))
    const lines = entitiesOfType(entities, "line")
    return entities.length === 3 && points && lines.length === 1 && lines[0]
      ? {
          type: "symmetric",
          firstPointId: points[0].id,
          secondPointId: points[1].id,
          lineId: lines[0].id,
        }
      : null
  },
  tangent: (entities) => {
    const lines = entitiesOfType(entities, "line")
    const arcs = entitiesOfType(entities, "arc")
    return entities.length === 2 && lines.length === 1 && lines[0] && arcs.length === 1 && arcs[0]
      ? { type: "tangent", lineId: lines[0].id, arcId: arcs[0].id }
      : null
  },
  vertical: (entities) => axisConstraint("vertical", entities),
} satisfies Record<SketchConstraintToolKind, ConstraintBuilder>

export function compatibleSketchConstraintTools(entities: readonly SketchEntity[]) {
  return mandatorySketchConstraintTools.flatMap((kind) => {
    const definition = constraintBuilders[kind](entities)
    return definition ? [{ kind, definition }] : []
  })
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
