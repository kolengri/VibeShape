import { projectSketchCurveBetweenFrames } from "@vibeshape/application/sketch-curve-projection"
import { projectSketchPointBetweenFrames, sketchFrame } from "@vibeshape/application/support-frame"
import type {
  DocumentSnapshot,
  FeatureRecord,
  SketchEntity,
  SketchEntityId,
  SketchPoint2,
  SketchRecord,
} from "@vibeshape/domain"
import {
  appendSketchConstraint,
  createDocumentDependencyGraphFromSnapshot,
  isSketchExternalModelReference,
  projectedExternalCurvePointCount,
  sketchEllipseGeometry,
  sketchEllipsePointAt,
  sketchEllipticalArcGeometry,
} from "@vibeshape/domain"
import type { SolvedSketchWire } from "@vibeshape/protocol"
import {
  createBrowserSketchConstraintId,
  createBrowserSketchEntityId,
  createBrowserSketchExternalReferenceId,
} from "../../document/document-controller"
import type { ExternalModelGeometryCandidate } from "./external-model-geometry"

type ProjectedSketchPoint = Readonly<{
  construction?: boolean
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
  construction?: boolean
  kind: "line"
  label: string
  sourceEndPointId: SketchEntityId
  sourceLineId: SketchEntityId
  sourceSketchId: SketchRecord["id"]
  sourceStartPointId: SketchEntityId
  start: ProjectedSketchPoint
  end: ProjectedSketchPoint
}>

export type ExternalSketchGeometryCandidate =
  | ExternalSketchPointCandidate
  | ExternalSketchLineCandidate
  | (ExternalSketchCurveContext & { projectedType: ExternalSketchCurveKind })

type ExternalSketchCurveKind = Exclude<SketchEntity["type"], "line" | "point">

export type ExternalSketchCurveContext = Readonly<{
  closed: boolean
  construction?: boolean
  kind: "curve"
  label: string
  points: readonly ProjectedSketchPoint[]
  sourceEntityId: SketchEntityId
  sourceSketchId: SketchRecord["id"]
  sourceType: ExternalSketchCurveKind
  projectedType: ExternalSketchCurveKind | null
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
  candidate: ExternalSketchGeometryCandidate | ExternalModelGeometryCandidate,
) {
  if (isSketchExternalModelReference(reference)) return false
  if (
    candidate.kind === "model-point" ||
    candidate.kind === "model-line" ||
    candidate.kind === "model-curve"
  ) {
    return false
  }
  if (reference.sourceSketchId !== candidate.sourceSketchId) return false
  if (candidate.kind === "curve") {
    return reference.kind === "curve" && reference.sourceEntityId === candidate.sourceEntityId
  }
  if (reference.kind === "curve") return false
  if ((reference.kind ?? "point") !== candidate.kind) return false
  return candidate.kind === "line"
    ? reference.kind === "line" && reference.sourceLineId === candidate.sourceLineId
    : reference.kind !== "line" && reference.sourcePointId === candidate.sourcePointId
}

export function attachExternalProjectedPoint(
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
  const materialized = materializeExternalSketchCandidate(draft, candidate)
  return materialized.kind === "point"
    ? attachExternalProjectedPoint(
        materialized.sketch,
        materialized.projectedPointId,
        selectedEntityIds,
      )
    : materialized.sketch
}

export type MaterializedExternalSketchCandidate =
  | Readonly<{
      kind: "point"
      projectedPointId: SketchEntityId
      sketch: SketchRecord
    }>
  | Readonly<{
      kind: "line"
      projectedEndPointId: SketchEntityId
      projectedLineId: SketchEntityId
      projectedStartPointId: SketchEntityId
      sketch: SketchRecord
    }>
  | Readonly<{
      kind: "curve"
      projectedEntityId: SketchEntityId
      projectedPointIds: readonly SketchEntityId[]
      sketch: SketchRecord
    }>

function existingLineMaterialization(
  draft: SketchRecord,
  candidate: ExternalSketchLineCandidate,
): MaterializedExternalSketchCandidate | null {
  const references = draft.externalReferences ?? []
  const existing = references.find(
    (reference) =>
      !isSketchExternalModelReference(reference) &&
      reference.kind === "line" &&
      reference.sourceSketchId === candidate.sourceSketchId &&
      reference.sourceLineId === candidate.sourceLineId,
  )
  if (!existing || isSketchExternalModelReference(existing) || existing.kind !== "line") {
    return null
  }
  return {
    kind: "line",
    projectedEndPointId: existing.projectedEndPointId,
    projectedLineId: existing.projectedLineId,
    projectedStartPointId: existing.projectedStartPointId,
    sketch: draft,
  }
}

function existingCurveMaterialization(
  draft: SketchRecord,
  candidate: Extract<ExternalSketchGeometryCandidate, { kind: "curve" }>,
): MaterializedExternalSketchCandidate | null {
  const references = draft.externalReferences ?? []
  const existing = references.find(
    (reference) =>
      !isSketchExternalModelReference(reference) &&
      reference.kind === "curve" &&
      reference.sourceSketchId === candidate.sourceSketchId &&
      reference.sourceEntityId === candidate.sourceEntityId,
  )
  if (!existing || isSketchExternalModelReference(existing) || existing.kind !== "curve") {
    return null
  }
  return {
    kind: "curve",
    projectedEntityId: existing.projectedEntityId,
    projectedPointIds: existing.projectedPointIds,
    sketch: draft,
  }
}

function existingPointMaterialization(
  draft: SketchRecord,
  candidate: ExternalSketchPointCandidate,
): MaterializedExternalSketchCandidate | null {
  const references = draft.externalReferences ?? []
  const existing = references.find(
    (reference) =>
      !isSketchExternalModelReference(reference) &&
      reference.kind !== "line" &&
      reference.kind !== "curve" &&
      reference.sourceSketchId === candidate.sourceSketchId &&
      reference.sourcePointId === candidate.sourcePointId,
  )
  return existing &&
    !isSketchExternalModelReference(existing) &&
    existing.kind !== "line" &&
    existing.kind !== "curve"
    ? { kind: "point", projectedPointId: existing.projectedPointId, sketch: draft }
    : null
}

function existingMaterialization(
  draft: SketchRecord,
  candidate: ExternalSketchGeometryCandidate,
): MaterializedExternalSketchCandidate | null {
  if (candidate.kind === "line") return existingLineMaterialization(draft, candidate)
  if (candidate.kind === "curve") return existingCurveMaterialization(draft, candidate)
  return existingPointMaterialization(draft, candidate)
}

export function materializeExternalSketchCandidate(
  draft: SketchRecord,
  candidate: ExternalSketchGeometryCandidate,
): MaterializedExternalSketchCandidate {
  const existing = existingMaterialization(draft, candidate)
  if (existing) return existing
  const references = draft.externalReferences ?? []
  if (candidate.kind === "line") {
    const projectedEndPointId = createBrowserSketchEntityId()
    const projectedLineId = createBrowserSketchEntityId()
    const projectedStartPointId = createBrowserSketchEntityId()
    return {
      kind: "line",
      projectedEndPointId,
      projectedLineId,
      projectedStartPointId,
      sketch: {
        ...draft,
        externalReferences: [
          ...references,
          {
            schemaVersion: 0,
            id: createBrowserSketchExternalReferenceId(),
            kind: "line",
            sourceSketchId: candidate.sourceSketchId,
            sourceLineId: candidate.sourceLineId,
            projectedLineId,
            projectedStartPointId,
            projectedEndPointId,
          },
        ],
      },
    }
  }
  if (candidate.kind === "curve") {
    const projectedEntityId = createBrowserSketchEntityId()
    const projectedPointIds = Array.from(
      { length: projectedExternalCurvePointCount(candidate.projectedType) },
      () => createBrowserSketchEntityId(),
    )
    return {
      kind: "curve",
      projectedEntityId,
      projectedPointIds,
      sketch: {
        ...draft,
        externalReferences: [
          ...references,
          {
            schemaVersion: 0,
            id: createBrowserSketchExternalReferenceId(),
            kind: "curve",
            sourceSketchId: candidate.sourceSketchId,
            sourceEntityId: candidate.sourceEntityId,
            sourceType: candidate.sourceType,
            projectedEntityId,
            projectedType: candidate.projectedType,
            projectedPointIds,
          },
        ],
      },
    }
  }
  const projectedPointId = createBrowserSketchEntityId()
  return {
    kind: "point",
    projectedPointId,
    sketch: {
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
  }
}

export function externalSketchGeometryCandidates(
  document: DocumentSnapshot,
  draft: SketchRecord,
  labels: ExternalSketchGeometryLabels,
  features: readonly FeatureRecord[] = document.features,
  solutionsBySketchId: ReadonlyMap<SketchRecord["id"], SolvedSketchWire> = new Map(),
): readonly ExternalSketchGeometryCandidate[] {
  return externalSketchContextGeometry(
    document,
    draft,
    labels,
    features,
    solutionsBySketchId,
  ).filter(
    (geometry): geometry is ExternalSketchGeometryCandidate =>
      geometry.kind !== "curve" || geometry.projectedType !== null,
  )
}

export function earlierSketchesForDraft(
  document: Pick<DocumentSnapshot, "sketches"> & Partial<Pick<DocumentSnapshot, "features">>,
  draftId: SketchRecord["id"],
) {
  if (document.features) {
    const graph = createDocumentDependencyGraphFromSnapshot({
      features: document.features,
      sketches: document.sketches,
    })
    const historyIndex = graph.ok
      ? graph.graph.history.findIndex((item) => item.kind === "sketch" && item.id === draftId)
      : -1
    if (graph.ok && historyIndex >= 0) {
      const earlierSketchIds = new Set(
        graph.graph.history
          .slice(0, historyIndex)
          .filter((item) => item.kind === "sketch")
          .map(({ id }) => id),
      )
      return document.sketches.filter(({ id }) => earlierSketchIds.has(id))
    }
  }
  const draftIndex = document.sketches.findIndex(({ id }) => id === draftId)
  return document.sketches.slice(0, draftIndex >= 0 ? draftIndex : document.sketches.length)
}

export function externalSketchContextGeometry(
  document: DocumentSnapshot,
  draft: SketchRecord,
  labels: ExternalSketchGeometryLabels,
  features: readonly FeatureRecord[] = document.features,
  solutionsBySketchId: ReadonlyMap<SketchRecord["id"], SolvedSketchWire> = new Map(),
): readonly ExternalSketchContextGeometry[] {
  const targetFrame = sketchFrame(draft, document, features)
  if (!targetFrame) return []
  const sources = earlierSketchesForDraft(document, draft.id)
  return sources.flatMap((source) =>
    externalGeometryFromSketch(
      source,
      document,
      features,
      targetFrame,
      labels,
      solutionsBySketchId.get(source.id) ?? null,
    ),
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

type SourceSketchPoints = ReadonlyMap<SketchEntityId, SketchPoint2>

function sampledCirclePoints(
  entity: Extract<SketchEntity, { type: "circle" }>,
  points: SourceSketchPoints,
  solvedRadius?: number,
) {
  const center = points.get(entity.centerPointId)
  if (!center) return []
  return Array.from({ length: 65 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 64
    return {
      x: center.x + Math.cos(angle) * (solvedRadius ?? entity.radius),
      y: center.y + Math.sin(angle) * (solvedRadius ?? entity.radius),
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
  solvedRadius?: number,
): readonly { x: number; y: number }[] {
  switch (entity.type) {
    case "arc":
      return curveSamplers.arc(entity, points)
    case "circle":
      return curveSamplers.circle(entity, points, solvedRadius)
    case "ellipse":
      return curveSamplers.ellipse(entity, points)
    case "elliptical-arc":
      return curveSamplers["elliptical-arc"](entity, points)
  }
}

type SketchSupportFrame = NonNullable<ReturnType<typeof sketchFrame>>

function projectedPointContext(
  entity: Extract<SketchEntity, { type: "point" }>,
  position: SketchPoint2,
  source: SketchRecord,
  sourceFrame: SketchSupportFrame,
  targetFrame: SketchSupportFrame,
  label: string,
  center: boolean,
): ExternalSketchPointCandidate {
  const projected = projectSketchPointBetweenFrames(sourceFrame, targetFrame, position)
  return {
    construction: entity.construction,
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
    construction: entity.construction,
    kind: "line",
    label,
    sourceEndPointId: entity.endPointId,
    sourceLineId: entity.id,
    sourceSketchId: source.id,
    sourceStartPointId: entity.startPointId,
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
  solvedRadius?: number,
): ExternalSketchCurveContext | null {
  const projection = projectSketchCurveBetweenFrames(
    sourceFrame,
    targetFrame,
    entity,
    points,
    entity.type === "circle" ? (solvedRadius ?? entity.radius) : undefined,
  )
  const projected = sampledCurvePoints(entity, points, solvedRadius).map((point) => {
    const result = projectSketchPointBetweenFrames(sourceFrame, targetFrame, point)
    return { world: result.world, ...result.local }
  })
  return projected.length > 1
    ? {
        closed: entity.type === "circle" || entity.type === "ellipse",
        construction: entity.construction,
        kind: "curve",
        label,
        points: projected,
        sourceEntityId: entity.id,
        sourceSketchId: source.id,
        sourceType: entity.type,
        projectedType: projection?.type ?? null,
      }
    : null
}

type ExternalGeometryProjectionContext = Readonly<{
  centerPointIds: ReadonlySet<SketchEntityId>
  curveOrdinals: Map<ExternalSketchCurveKind, number>
  labels: ExternalSketchGeometryLabels
  lineOrdinal: { value: number }
  pointOrdinal: { value: number }
  points: SourceSketchPoints
  solvedRadii: ReadonlyMap<string, number>
  source: SketchRecord
  sourceFrame: SketchSupportFrame
  targetFrame: SketchSupportFrame
}>

function projectSourceEntity(
  entity: SketchEntity,
  context: ExternalGeometryProjectionContext,
): ExternalSketchContextGeometry | null {
  if (entity.type === "point") {
    context.pointOrdinal.value += 1
    return projectedPointContext(
      entity,
      context.points.get(entity.id) ?? entity,
      context.source,
      context.sourceFrame,
      context.targetFrame,
      context.labels.point(context.source.label, context.pointOrdinal.value),
      context.centerPointIds.has(entity.id),
    )
  }
  if (entity.type === "line") {
    context.lineOrdinal.value += 1
    return projectedLineContext(
      entity,
      context.points,
      context.source,
      context.sourceFrame,
      context.targetFrame,
      context.labels.line(context.source.label, context.lineOrdinal.value),
    )
  }
  const ordinal = (context.curveOrdinals.get(entity.type) ?? 0) + 1
  context.curveOrdinals.set(entity.type, ordinal)
  return projectedCurveContext(
    entity,
    context.points,
    context.source,
    context.sourceFrame,
    context.targetFrame,
    context.labels.curve(context.source.label, entity.type, ordinal),
    entity.type === "circle" ? context.solvedRadii.get(entity.id) : undefined,
  )
}

function externalGeometryFromSketch(
  source: SketchRecord,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  targetFrame: NonNullable<ReturnType<typeof sketchFrame>>,
  labels: ExternalSketchGeometryLabels,
  solution: SolvedSketchWire | null,
): readonly ExternalSketchContextGeometry[] {
  const sourceFrame = sketchFrame(source, document, features)
  if (!sourceFrame) return []
  const solvedPoints = new Map(solution?.points.map(({ entityId, x, y }) => [entityId, { x, y }]))
  const solvedRadii = new Map(solution?.circles.map(({ entityId, radius }) => [entityId, radius]))
  const points = new Map(
    source.entities.flatMap((entity) =>
      entity.type === "point"
        ? ([[entity.id, solvedPoints.get(entity.id) ?? entity]] as const)
        : [],
    ),
  )
  const centerPointIds = new Set(
    source.entities.flatMap((entity) =>
      entity.type !== "point" && entity.type !== "line" && "centerPointId" in entity
        ? [entity.centerPointId]
        : [],
    ),
  )
  const context: ExternalGeometryProjectionContext = {
    centerPointIds,
    curveOrdinals: new Map(),
    labels,
    lineOrdinal: { value: 0 },
    pointOrdinal: { value: 0 },
    points,
    solvedRadii,
    source,
    sourceFrame,
    targetFrame,
  }
  return source.entities.flatMap((entity) => {
    const projected = projectSourceEntity(entity, context)
    return projected ? [projected] : []
  })
}
