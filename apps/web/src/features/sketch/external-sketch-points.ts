import { projectSketchPointBetweenFrames, sketchFrame } from "@vibeshape/application/support-frame"
import type {
  DocumentSnapshot,
  FeatureRecord,
  SketchEntity,
  SketchEntityId,
  SketchRecord,
} from "@vibeshape/domain"
import {
  appendSketchConstraint,
  sketchEllipseGeometry,
  sketchEllipsePointAt,
  sketchEllipticalArcGeometry,
} from "@vibeshape/domain"
import {
  createBrowserSketchConstraintId,
  createBrowserSketchEntityId,
  createBrowserSketchExternalReferenceId,
} from "../../document/document-controller"

type ProjectedSketchPoint = Readonly<{
  world: readonly [number, number, number]
  x: number
  y: number
}>

export type ExternalSketchPointCandidate = Readonly<{
  kind: "point"
  label: string
  role?: "center" | "vertex"
  sourcePointId: SketchEntityId
  sourceSketchId: SketchRecord["id"]
}> &
  ProjectedSketchPoint

export type ExternalSketchLineCandidate = Readonly<{
  kind: "line"
  label: string
  sourceLineId: SketchEntityId
  sourceSketchId: SketchRecord["id"]
  start: ProjectedSketchPoint
  end: ProjectedSketchPoint
}>

export type ExternalSketchGeometryCandidate =
  | ExternalSketchPointCandidate
  | ExternalSketchLineCandidate

type ExternalSketchCurveKind = Exclude<SketchEntity["type"], "line" | "point">

export type ExternalSketchCurveContext = Readonly<{
  closed: boolean
  kind: "curve"
  label: string
  points: readonly ProjectedSketchPoint[]
  sourceEntityId: SketchEntityId
  sourceSketchId: SketchRecord["id"]
  sourceType: ExternalSketchCurveKind
}>

export type ExternalSketchContextGeometry =
  | ExternalSketchGeometryCandidate
  | ExternalSketchCurveContext

export type ExternalSketchGeometryLabels = Readonly<{
  curve: (sourceLabel: string, kind: ExternalSketchCurveKind, ordinal: number) => string
  line: (sourceLabel: string, ordinal: number) => string
  point: (sourceLabel: string, ordinal: number) => string
}>

export function externalReferenceMatchesCandidate(
  reference: NonNullable<SketchRecord["externalReferences"]>[number],
  candidate: ExternalSketchGeometryCandidate,
) {
  if (
    reference.sourceSketchId !== candidate.sourceSketchId ||
    (reference.kind ?? "point") !== candidate.kind
  ) {
    return false
  }
  return candidate.kind === "line"
    ? reference.kind === "line" && reference.sourceLineId === candidate.sourceLineId
    : reference.kind !== "line" && reference.sourcePointId === candidate.sourcePointId
}

function attachProjectedPoint(
  sketch: SketchRecord,
  projectedPointId: SketchEntityId,
  selectedEntityIds: readonly SketchEntityId[],
) {
  if (selectedEntityIds.length !== 1) return sketch
  const selected = sketch.entities.find(({ id }) => id === selectedEntityIds[0])
  if (selected?.type !== "point") return sketch
  const exists = sketch.constraints.some(
    (constraint) =>
      constraint.type === "coincident" &&
      ((constraint.firstPointId === selected.id && constraint.secondPointId === projectedPointId) ||
        (constraint.firstPointId === projectedPointId && constraint.secondPointId === selected.id)),
  )
  return exists
    ? sketch
    : appendSketchConstraint(
        sketch,
        { type: "coincident", firstPointId: selected.id, secondPointId: projectedPointId },
        createBrowserSketchConstraintId,
      )
}

export function applyExternalSketchCandidate(
  draft: SketchRecord,
  candidate: ExternalSketchGeometryCandidate,
  selectedEntityIds: readonly SketchEntityId[],
): SketchRecord {
  const references = draft.externalReferences ?? []
  if (references.some((reference) => externalReferenceMatchesCandidate(reference, candidate))) {
    return draft
  }
  if (candidate.kind === "line") {
    return {
      ...draft,
      externalReferences: [
        ...references,
        {
          schemaVersion: 0,
          id: createBrowserSketchExternalReferenceId(),
          kind: "line",
          sourceSketchId: candidate.sourceSketchId,
          sourceLineId: candidate.sourceLineId,
          projectedLineId: createBrowserSketchEntityId(),
          projectedStartPointId: createBrowserSketchEntityId(),
          projectedEndPointId: createBrowserSketchEntityId(),
        },
      ],
    }
  }
  const projectedPointId = createBrowserSketchEntityId()
  return attachProjectedPoint(
    {
      ...draft,
      externalReferences: [
        ...references,
        {
          schemaVersion: 0,
          kind: "point",
          id: createBrowserSketchExternalReferenceId(),
          sourceSketchId: candidate.sourceSketchId,
          sourcePointId: candidate.sourcePointId,
          projectedPointId,
        },
      ],
    },
    projectedPointId,
    selectedEntityIds,
  )
}

export function externalSketchGeometryCandidates(
  document: DocumentSnapshot,
  draft: SketchRecord,
  labels: ExternalSketchGeometryLabels,
  features: readonly FeatureRecord[] = document.features,
): readonly ExternalSketchGeometryCandidate[] {
  return externalSketchContextGeometry(document, draft, labels, features).filter(
    (geometry): geometry is ExternalSketchGeometryCandidate => geometry.kind !== "curve",
  )
}

export function externalSketchContextGeometry(
  document: DocumentSnapshot,
  draft: SketchRecord,
  labels: ExternalSketchGeometryLabels,
  features: readonly FeatureRecord[] = document.features,
): readonly ExternalSketchContextGeometry[] {
  const targetFrame = sketchFrame(draft, document, features)
  if (!targetFrame) return []
  const draftIndex = document.sketches.findIndex((sketch) => sketch.id === draft.id)
  const sources = document.sketches.slice(0, draftIndex >= 0 ? draftIndex : undefined)
  return sources.flatMap((source) =>
    externalGeometryFromSketch(source, document, features, targetFrame, labels),
  )
}

function positiveSweep(
  center: Readonly<{ x: number; y: number }>,
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
) {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x)
  const sweep = (endAngle - startAngle) % (Math.PI * 2)
  return sweep > 0 ? sweep : sweep + Math.PI * 2
}

type SourceSketchPoints = ReadonlyMap<SketchEntityId, Extract<SketchEntity, { type: "point" }>>

function sampledCirclePoints(
  entity: Extract<SketchEntity, { type: "circle" }>,
  points: SourceSketchPoints,
) {
  const center = points.get(entity.centerPointId)
  if (!center) return []
  return Array.from({ length: 65 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 64
    return {
      x: center.x + Math.cos(angle) * entity.radius,
      y: center.y + Math.sin(angle) * entity.radius,
    }
  })
}

function sampledArcPoints(
  entity: Extract<SketchEntity, { type: "arc" }>,
  points: SourceSketchPoints,
) {
  const center = points.get(entity.centerPointId)
  const start = points.get(entity.startPointId)
  const end = points.get(entity.endPointId)
  if (!center || !start || !end) return []
  const radius = Math.hypot(start.x - center.x, start.y - center.y)
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const sweep = positiveSweep(center, start, end)
  return Array.from({ length: 49 }, (_, index) => {
    const angle = startAngle + sweep * (index / 48)
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  })
}

function sampledEllipsePoints(
  entity: Extract<SketchEntity, { type: "ellipse" }>,
  points: SourceSketchPoints,
) {
  const center = points.get(entity.centerPointId)
  const primaryAxisPoint = points.get(entity.primaryAxisPointId)
  const secondaryAxisPoint = points.get(entity.secondaryAxisPointId)
  if (!center || !primaryAxisPoint || !secondaryAxisPoint) return []
  const geometry = sketchEllipseGeometry(center, primaryAxisPoint, secondaryAxisPoint)
  return geometry
    ? Array.from({ length: 65 }, (_, index) =>
        sketchEllipsePointAt(geometry, (Math.PI * 2 * index) / 64),
      )
    : []
}

function sampledEllipticalArcPoints(
  entity: Extract<SketchEntity, { type: "elliptical-arc" }>,
  points: SourceSketchPoints,
) {
  const center = points.get(entity.centerPointId)
  const primaryAxisPoint = points.get(entity.primaryAxisPointId)
  const secondaryAxisPoint = points.get(entity.secondaryAxisPointId)
  const start = points.get(entity.startPointId)
  const end = points.get(entity.endPointId)
  if (!center || !primaryAxisPoint || !secondaryAxisPoint || !start || !end) return []
  const geometry = sketchEllipticalArcGeometry(
    center,
    primaryAxisPoint,
    secondaryAxisPoint,
    start,
    end,
  )
  if (!geometry) return []
  const segmentCount = Math.max(8, Math.ceil((geometry.sweep / (Math.PI * 2)) * 64))
  return Array.from({ length: segmentCount + 1 }, (_, index) =>
    sketchEllipsePointAt(
      geometry,
      geometry.startParameter + geometry.sweep * (index / segmentCount),
    ),
  )
}

const curveSamplers = {
  arc: sampledArcPoints,
  circle: sampledCirclePoints,
  ellipse: sampledEllipsePoints,
  "elliptical-arc": sampledEllipticalArcPoints,
}

function sampledCurvePoints(
  entity: Exclude<SketchEntity, { type: "line" | "point" }>,
  points: SourceSketchPoints,
): readonly { x: number; y: number }[] {
  switch (entity.type) {
    case "arc":
      return curveSamplers.arc(entity, points)
    case "circle":
      return curveSamplers.circle(entity, points)
    case "ellipse":
      return curveSamplers.ellipse(entity, points)
    case "elliptical-arc":
      return curveSamplers["elliptical-arc"](entity, points)
  }
}

type SketchSupportFrame = NonNullable<ReturnType<typeof sketchFrame>>

function projectedPointContext(
  entity: Extract<SketchEntity, { type: "point" }>,
  source: SketchRecord,
  sourceFrame: SketchSupportFrame,
  targetFrame: SketchSupportFrame,
  label: string,
  center: boolean,
): ExternalSketchPointCandidate {
  const projected = projectSketchPointBetweenFrames(sourceFrame, targetFrame, entity)
  return {
    kind: "point",
    label,
    role: center ? "center" : "vertex",
    sourcePointId: entity.id,
    sourceSketchId: source.id,
    world: projected.world,
    ...projected.local,
  }
}

function projectedLineContext(
  entity: Extract<SketchEntity, { type: "line" }>,
  points: SourceSketchPoints,
  source: SketchRecord,
  sourceFrame: SketchSupportFrame,
  targetFrame: SketchSupportFrame,
  label: string,
): ExternalSketchLineCandidate | null {
  const sourceStart = points.get(entity.startPointId)
  const sourceEnd = points.get(entity.endPointId)
  if (!sourceStart || !sourceEnd) return null
  const start = projectSketchPointBetweenFrames(sourceFrame, targetFrame, sourceStart)
  const end = projectSketchPointBetweenFrames(sourceFrame, targetFrame, sourceEnd)
  if (Math.hypot(end.local.x - start.local.x, end.local.y - start.local.y) <= 1e-9) return null
  return {
    kind: "line",
    label,
    sourceLineId: entity.id,
    sourceSketchId: source.id,
    start: { world: start.world, ...start.local },
    end: { world: end.world, ...end.local },
  }
}

function projectedCurveContext(
  entity: Exclude<SketchEntity, { type: "line" | "point" }>,
  points: SourceSketchPoints,
  source: SketchRecord,
  sourceFrame: SketchSupportFrame,
  targetFrame: SketchSupportFrame,
  label: string,
): ExternalSketchCurveContext | null {
  const projected = sampledCurvePoints(entity, points).map((point) => {
    const result = projectSketchPointBetweenFrames(sourceFrame, targetFrame, point)
    return { world: result.world, ...result.local }
  })
  return projected.length > 1
    ? {
        closed: entity.type === "circle" || entity.type === "ellipse",
        kind: "curve",
        label,
        points: projected,
        sourceEntityId: entity.id,
        sourceSketchId: source.id,
        sourceType: entity.type,
      }
    : null
}

function externalGeometryFromSketch(
  source: SketchRecord,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  targetFrame: NonNullable<ReturnType<typeof sketchFrame>>,
  labels: ExternalSketchGeometryLabels,
): readonly ExternalSketchContextGeometry[] {
  const sourceFrame = sketchFrame(source, document, features)
  if (!sourceFrame) return []
  const points = new Map(
    source.entities.flatMap((entity) =>
      entity.type === "point" ? ([[entity.id, entity]] as const) : [],
    ),
  )
  const centerPointIds = new Set(
    source.entities.flatMap((entity) =>
      entity.type !== "point" && entity.type !== "line" && "centerPointId" in entity
        ? [entity.centerPointId]
        : [],
    ),
  )
  let pointOrdinal = 0
  let lineOrdinal = 0
  const curveOrdinals = new Map<ExternalSketchCurveKind, number>()
  const result: ExternalSketchContextGeometry[] = []
  for (const entity of source.entities) {
    if (entity.type === "point") {
      pointOrdinal += 1
      result.push(
        projectedPointContext(
          entity,
          source,
          sourceFrame,
          targetFrame,
          labels.point(source.label, pointOrdinal),
          centerPointIds.has(entity.id),
        ),
      )
      continue
    }
    if (entity.type === "line") {
      lineOrdinal += 1
      const line = projectedLineContext(
        entity,
        points,
        source,
        sourceFrame,
        targetFrame,
        labels.line(source.label, lineOrdinal),
      )
      if (line) result.push(line)
      continue
    }
    const ordinal = (curveOrdinals.get(entity.type) ?? 0) + 1
    curveOrdinals.set(entity.type, ordinal)
    const curve = projectedCurveContext(
      entity,
      points,
      source,
      sourceFrame,
      targetFrame,
      labels.curve(source.label, entity.type, ordinal),
    )
    if (curve) result.push(curve)
  }
  return result
}
