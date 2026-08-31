import { type SupportFrameGeometryRecord, sketchFrame } from "@vibeshape/application/support-frame"
import type { DocumentSnapshot, FeatureRecord, SketchRecord } from "@vibeshape/domain"
import type { SolvedSketchWire } from "@vibeshape/protocol"
import type { ViewerSketchLineCandidate, ViewerVector3 } from "@vibeshape/viewer/three-viewport"
import type { ExternalModelLineCandidate } from "../sketch/external-model-geometry"

const MIN_AXIS_LENGTH = 1e-9

export type RevolveSketchLineAxisCandidate = ViewerSketchLineCandidate &
  Readonly<{
    axis: Readonly<{
      kind: "sketch-line"
      sketchId: SketchRecord["id"]
      entityId: Extract<SketchRecord["entities"][number], { type: "line" }>["id"]
    }>
  }>

export type RevolveModelEdgeAxisCandidate = Readonly<{
  axis: Readonly<{
    kind: "model-edge"
    reference: ExternalModelLineCandidate["reference"]
  }>
  candidateId: string
  end: ViewerVector3
  featureId: ExternalModelLineCandidate["featureId"]
  kind: "model-line"
  label: string
  start: ViewerVector3
}>

export type RevolveAxisCandidate = RevolveSketchLineAxisCandidate | RevolveModelEdgeAxisCandidate

export function revolveModelEdgeAxisCandidates(
  candidates: readonly ExternalModelLineCandidate[],
): readonly RevolveModelEdgeAxisCandidate[] {
  return candidates.flatMap((candidate) =>
    candidate.coplanar
      ? [
          {
            axis: { kind: "model-edge" as const, reference: candidate.reference },
            candidateId: candidate.candidateId,
            end: candidate.end.world,
            featureId: candidate.featureId,
            kind: "model-line" as const,
            label: candidate.label,
            start: candidate.start.world,
          },
        ]
      : [],
  )
}

function worldPoint(
  frame: NonNullable<ReturnType<typeof sketchFrame>>,
  point: Readonly<{ x: number; y: number }>,
): ViewerVector3 {
  return [
    frame.origin[0] + frame.xAxis[0] * point.x + frame.yAxis[0] * point.y,
    frame.origin[1] + frame.xAxis[1] * point.x + frame.yAxis[1] * point.y,
    frame.origin[2] + frame.xAxis[2] * point.x + frame.yAxis[2] * point.y,
  ]
}

export function revolveSketchLineAxisCandidates(
  document: DocumentSnapshot,
  sketch: SketchRecord,
  solution: SolvedSketchWire,
  features: readonly FeatureRecord[],
  geometry: readonly SupportFrameGeometryRecord[],
  lineLabel: (sketchLabel: string, ordinal: number) => string,
): readonly RevolveSketchLineAxisCandidate[] {
  const frame = sketchFrame(sketch, document, features, new Set(), geometry)
  if (!frame) return []
  const points = new Map(solution.points.map(({ entityId, x, y }) => [entityId, { x, y }]))
  let lineOrdinal = 0
  return sketch.entities.flatMap((entity) => {
    if (entity.type !== "line") return []
    lineOrdinal += 1
    const start = points.get(entity.startPointId)
    const end = points.get(entity.endPointId)
    if (!start || !end || Math.hypot(end.x - start.x, end.y - start.y) <= MIN_AXIS_LENGTH) {
      return []
    }
    return [
      {
        axis: { kind: "sketch-line", sketchId: sketch.id, entityId: entity.id },
        end: worldPoint(frame, end),
        kind: "line" as const,
        label: lineLabel(sketch.label, lineOrdinal),
        sourceLineId: entity.id,
        sourceSketchId: sketch.id,
        start: worldPoint(frame, start),
      },
    ]
  })
}
