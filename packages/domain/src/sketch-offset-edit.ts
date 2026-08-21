import type { SketchConstraintId, SketchEntityId } from "./identifiers"
import { type SketchEntity, type SketchRecord, sketchRecordSchema } from "./sketch"
import {
  appendSketchConstraint,
  requireSketchPoint,
  type SketchAppendResult,
  type SketchPoint2,
  sketchLineIntersection,
} from "./sketch-edit"
import type { LengthQuantity } from "./units"

type EntityIdFactory = () => SketchEntityId
type ConstraintIdFactory = () => SketchConstraintId
type SketchPointEntity = Extract<SketchEntity, { type: "point" }>
type SketchLineEntity = Extract<SketchEntity, { type: "line" }>

const OFFSET_EPSILON = 1e-9
const MAX_MITER_RATIO = 100

function requiredOffsetValue<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new TypeError("Sketch Offset geometry is incomplete.")
  return value
}

function pointById(sketch: SketchRecord, pointId: SketchEntityId) {
  return requireSketchPoint(sketch, pointId, "Sketch Offset requires existing line endpoints.")
}

function lineById(sketch: SketchRecord, lineId: SketchEntityId) {
  const line = sketch.entities.find(
    (entity): entity is SketchLineEntity => entity.id === lineId && entity.type === "line",
  )
  if (!line) throw new TypeError("Sketch Offset requires existing line entities.")
  return line
}

function pointDistance(first: SketchPoint2, second: SketchPoint2) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

export function sketchLineSignedDistance(
  sketch: SketchRecord,
  lineId: SketchEntityId,
  point: SketchPoint2,
) {
  const line = lineById(sketch, lineId)
  const start = pointById(sketch, line.startPointId)
  const end = pointById(sketch, line.endPointId)
  const directionX = end.x - start.x
  const directionY = end.y - start.y
  const length = Math.hypot(directionX, directionY)
  if (length <= OFFSET_EPSILON) throw new RangeError("Sketch Offset rejects degenerate lines.")
  return (directionX * (point.y - start.y) - directionY * (point.x - start.x)) / length
}

type OrientedLine = Readonly<{
  line: SketchLineEntity
  startPointId: SketchEntityId
  endPointId: SketchEntityId
}>

function selectedLines(sketch: SketchRecord, lineIds: readonly SketchEntityId[]) {
  const uniqueIds = [...new Set(lineIds)]
  if (uniqueIds.length === 0) throw new RangeError("Sketch Offset requires at least one line.")
  return uniqueIds.map((lineId) => lineById(sketch, lineId))
}

function lineAdjacency(lines: readonly SketchLineEntity[]) {
  const adjacency = new Map<SketchEntityId, SketchLineEntity[]>()
  for (const line of lines) {
    for (const pointId of [line.startPointId, line.endPointId]) {
      const incident = adjacency.get(pointId) ?? []
      incident.push(line)
      incident.sort((left, right) => left.id.localeCompare(right.id))
      adjacency.set(pointId, incident)
    }
  }
  return adjacency
}

function reverseOrientedLines(lines: readonly OrientedLine[]) {
  return [...lines].reverse().map((item) => ({
    ...item,
    startPointId: item.endPointId,
    endPointId: item.startPointId,
  }))
}

function traverseLineChain(
  adjacency: ReadonlyMap<SketchEntityId, readonly SketchLineEntity[]>,
  first: OrientedLine,
  expectedCount: number,
) {
  const result: OrientedLine[] = [first]
  const used = new Set<SketchEntityId>([first.line.id])
  let currentPointId = first.endPointId
  while (used.size < expectedCount) {
    const next = adjacency.get(currentPointId)?.find(({ id }) => !used.has(id))
    if (!next) break
    const endPointId = next.startPointId === currentPointId ? next.endPointId : next.startPointId
    result.push({ line: next, startPointId: currentPointId, endPointId })
    used.add(next.id)
    currentPointId = endPointId
  }
  if (result.length !== expectedCount) {
    throw new RangeError("Sketch Offset requires one connected line chain.")
  }
  return result
}

function orderedOpenChain(
  lines: readonly SketchLineEntity[],
  adjacency: ReadonlyMap<SketchEntityId, readonly SketchLineEntity[]>,
  endpointIds: readonly SketchEntityId[],
  referenceLineId: SketchEntityId,
) {
  const startPointId = [...endpointIds].sort()[0]
  const first = startPointId ? adjacency.get(startPointId)?.[0] : undefined
  if (!startPointId || !first) throw new RangeError("Sketch Offset cannot order the line chain.")
  const ordered = traverseLineChain(
    adjacency,
    {
      line: first,
      startPointId,
      endPointId: first.startPointId === startPointId ? first.endPointId : first.startPointId,
    },
    lines.length,
  )
  const reference = ordered.find(({ line }) => line.id === referenceLineId)
  if (!reference) throw new TypeError("Sketch Offset requires its reference line in the chain.")
  return reference.startPointId === reference.line.startPointId
    ? ordered
    : reverseOrientedLines(ordered)
}

function orderedClosedChain(
  lines: readonly SketchLineEntity[],
  adjacency: ReadonlyMap<SketchEntityId, readonly SketchLineEntity[]>,
  referenceLineId: SketchEntityId,
) {
  const reference = lines.find(({ id }) => id === referenceLineId)
  if (!reference) throw new TypeError("Sketch Offset requires its reference line in the loop.")
  const ordered = traverseLineChain(
    adjacency,
    {
      line: reference,
      startPointId: reference.startPointId,
      endPointId: reference.endPointId,
    },
    lines.length,
  )
  if (ordered.at(-1)?.endPointId !== reference.startPointId) {
    throw new RangeError("Sketch Offset requires a closed line loop.")
  }
  return ordered
}

function orderedLineChain(
  sketch: SketchRecord,
  lineIds: readonly SketchEntityId[],
  referenceLineId: SketchEntityId,
) {
  const lines = selectedLines(sketch, lineIds)
  const adjacency = lineAdjacency(lines)
  if ([...adjacency.values()].some((incident) => incident.length > 2)) {
    throw new RangeError("Sketch Offset does not accept branching line selections.")
  }
  const endpointIds = [...adjacency]
    .filter(([, incident]) => incident.length === 1)
    .map(([pointId]) => pointId)
  if (endpointIds.length === 2) {
    return {
      closed: false,
      lines: orderedOpenChain(lines, adjacency, endpointIds, referenceLineId),
    }
  }
  if (endpointIds.length === 0) {
    return { closed: true, lines: orderedClosedChain(lines, adjacency, referenceLineId) }
  }
  throw new RangeError("Sketch Offset requires an open chain or a closed loop.")
}

function shiftedLine(sketch: SketchRecord, item: OrientedLine, distance: number) {
  const start = pointById(sketch, item.startPointId)
  const end = pointById(sketch, item.endPointId)
  const directionX = end.x - start.x
  const directionY = end.y - start.y
  const length = Math.hypot(directionX, directionY)
  if (length <= OFFSET_EPSILON) throw new RangeError("Sketch Offset rejects degenerate lines.")
  const offsetX = (-directionY / length) * distance
  const offsetY = (directionX / length) * distance
  return {
    end: { x: end.x + offsetX, y: end.y + offsetY },
    start: { x: start.x + offsetX, y: start.y + offsetY },
  }
}

function offsetJoint(
  previous: Readonly<{ end: SketchPoint2; start: SketchPoint2 }>,
  current: Readonly<{ end: SketchPoint2; start: SketchPoint2 }>,
  sourceJoint: SketchPoint2,
  distance: number,
) {
  const intersection = sketchLineIntersection(
    previous.start,
    previous.end,
    current.start,
    current.end,
  )
  const joint =
    intersection?.point ??
    (pointDistance(previous.end, current.start) <= OFFSET_EPSILON ? current.start : null)
  if (!joint) throw new RangeError("Sketch Offset rejects reversing or parallel chain joints.")
  if (pointDistance(sourceJoint, joint) > Math.abs(distance) * MAX_MITER_RATIO) {
    throw new RangeError("Sketch Offset rejects an unbounded sharp-corner miter.")
  }
  return joint
}

export type SketchLineOffsetGeometry = Readonly<{
  closed: boolean
  lines: readonly Readonly<{
    construction: boolean
    distanceScale: -1 | 1
    sourceLineId: SketchEntityId
    start: SketchPoint2
    end: SketchPoint2
  }>[]
  sourceEndpointIds: readonly SketchEntityId[]
}>

export function sketchLineOffsetGeometry(
  sketch: SketchRecord,
  input: {
    distance: number
    lineIds: readonly SketchEntityId[]
    referenceLineId: SketchEntityId
  },
): SketchLineOffsetGeometry {
  if (!Number.isFinite(input.distance) || Math.abs(input.distance) <= OFFSET_EPSILON) {
    throw new RangeError("Sketch Offset requires a finite nonzero distance.")
  }
  const chain = orderedLineChain(sketch, input.lineIds, input.referenceLineId)
  const shifted = chain.lines.map((item) => shiftedLine(sketch, item, input.distance))
  const vertices: SketchPoint2[] = []
  if (!chain.closed) vertices.push(requiredOffsetValue(shifted[0]).start)
  for (const [index, current] of shifted.entries()) {
    if (index === 0 && !chain.closed) continue
    const previous = shifted[(index - 1 + shifted.length) % shifted.length]
    const sourceJointId = chain.lines[index]?.startPointId
    if (!previous || !sourceJointId)
      throw new TypeError("Sketch Offset chain geometry is incomplete.")
    vertices.push(offsetJoint(previous, current, pointById(sketch, sourceJointId), input.distance))
  }
  if (!chain.closed) vertices.push(requiredOffsetValue(shifted.at(-1)).end)
  return {
    closed: chain.closed,
    lines: chain.lines.map((item, index) => ({
      construction: item.line.construction,
      distanceScale: item.startPointId === item.line.startPointId ? 1 : -1,
      sourceLineId: item.line.id,
      start: requiredOffsetValue(vertices[index]),
      end: requiredOffsetValue(vertices[(index + 1) % vertices.length]),
    })),
    sourceEndpointIds: chain.closed
      ? []
      : [
          requiredOffsetValue(chain.lines[0]).startPointId,
          requiredOffsetValue(chain.lines.at(-1)).endPointId,
        ],
  }
}

export function connectedSketchOffsetLineIds(
  sketch: SketchRecord,
  referenceLineId: SketchEntityId,
) {
  const reference = lineById(sketch, referenceLineId)
  const allLines = sketch.entities.filter(
    (entity): entity is SketchLineEntity => entity.type === "line",
  )
  const adjacency = lineAdjacency(allLines)
  const connected = new Set<SketchEntityId>([reference.id])
  const queue = [reference]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    for (const pointId of [current.startPointId, current.endPointId]) {
      for (const candidate of adjacency.get(pointId) ?? []) {
        if (connected.has(candidate.id)) continue
        connected.add(candidate.id)
        queue.push(candidate)
      }
    }
  }
  const lineIds = [...connected]
  try {
    orderedLineChain(sketch, lineIds, referenceLineId)
    return lineIds
  } catch {
    return [referenceLineId]
  }
}

export function appendSketchLineOffset(
  sketch: SketchRecord,
  input: {
    createConstraintId: ConstraintIdFactory
    createEntityId: EntityIdFactory
    lineIds: readonly SketchEntityId[]
    referenceLineId: SketchEntityId
    value: LengthQuantity
  },
): SketchAppendResult {
  const geometry = sketchLineOffsetGeometry(sketch, {
    distance: input.value.value,
    lineIds: input.lineIds,
    referenceLineId: input.referenceLineId,
  })
  const points: readonly SketchPoint2[] = geometry.closed
    ? geometry.lines.map(({ start }) => start)
    : [requiredOffsetValue(geometry.lines[0]).start, ...geometry.lines.map(({ end }) => end)]
  const pointEntities = points.map(
    (point): SketchPointEntity => ({
      schemaVersion: 0,
      id: input.createEntityId(),
      type: "point",
      construction: false,
      ...point,
    }),
  )
  const lineEntities = geometry.lines.map(
    (line, index): SketchLineEntity => ({
      schemaVersion: 0,
      id: input.createEntityId(),
      type: "line",
      construction: line.construction,
      startPointId: requiredOffsetValue(pointEntities[index]).id,
      endPointId: requiredOffsetValue(pointEntities[(index + 1) % pointEntities.length]).id,
    }),
  )
  let next = sketchRecordSchema.parse({
    ...sketch,
    entities: [...sketch.entities, ...pointEntities, ...lineEntities],
  })
  const linePairs = geometry.lines.map((source, index) => {
    const offsetLine = lineEntities[index]
    if (!offsetLine) throw new TypeError("Sketch Offset pair allocation failed.")
    return {
      distanceScale: source.distanceScale,
      sourceLineId: source.sourceLineId,
      offsetLineId: offsetLine.id,
    }
  })
  const endpointPairs = geometry.sourceEndpointIds.map((sourcePointId, index) => {
    const offsetPoint = index === 0 ? pointEntities[0] : pointEntities.at(-1)
    if (!offsetPoint) throw new TypeError("Sketch Offset endpoint allocation failed.")
    return { sourcePointId, offsetPointId: offsetPoint.id }
  })
  next = appendSketchConstraint(
    next,
    {
      type: "offset",
      endpointPairs,
      linePairs,
      value: input.value,
    },
    input.createConstraintId,
  )
  return {
    createdEntityIds: [...pointEntities, ...lineEntities].map(({ id }) => id),
    sketch: next,
  }
}
