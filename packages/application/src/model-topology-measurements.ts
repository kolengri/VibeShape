import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { documentWorkerResponseSchema, type TopologyCandidate } from "@vibeshape/protocol"
import { createModelBodyTopologyEvidence } from "./model-body-topology"

type Point3 = readonly [number, number, number]
export type MeasurementPoint = Readonly<{
  kind: "centroid" | "start" | "middle" | "end" | "center"
  position: Point3
}>
export type TopologyMeasurementElement = Readonly<{
  id: string
  kind: "edge" | "face"
  geometryClass: string
  measure: number
  centroid: Point3
  points: readonly MeasurementPoint[]
  radius?: number
  direction?: Point3
}>

function analyticalPoints(candidate: TopologyCandidate): MeasurementPoint[] {
  const geometry = candidate.referenceGeometry
  if (!geometry) return []
  if (geometry.kind === "line-edge")
    return [
      { kind: "start", position: geometry.start },
      { kind: "end", position: geometry.end },
    ]
  if (geometry.kind === "arc-edge" || geometry.kind === "elliptical-arc-edge") {
    return [
      { kind: "start", position: geometry.start },
      { kind: "middle", position: geometry.middle },
      { kind: "end", position: geometry.end },
      { kind: "center", position: geometry.center },
    ]
  }
  if (geometry.kind === "circle-edge" || geometry.kind === "ellipse-edge")
    return [{ kind: "center", position: geometry.center }]
  return []
}

function analyticalDirection(candidate: TopologyCandidate) {
  const { signature } = candidate
  return signature.geometryClass === "LINE" || signature.geometryClass === "PLANE"
    ? signature.direction
    : undefined
}

function circularRadius(candidate: TopologyCandidate) {
  const geometry = candidate.referenceGeometry
  if (!geometry) return undefined
  return geometry.kind === "circle-edge" || geometry.kind === "arc-edge"
    ? geometry.radius
    : undefined
}

function element(candidate: TopologyCandidate): TopologyMeasurementElement | null {
  if (candidate.kind === "vertex") return null
  const { signature } = candidate
  const direction = analyticalDirection(candidate)
  const radius = circularRadius(candidate)
  return {
    id: candidate.candidateId,
    kind: candidate.kind,
    geometryClass: signature.geometryClass,
    measure: signature.measure,
    centroid: signature.centroid,
    points: [{ kind: "centroid", position: signature.centroid }, ...analyticalPoints(candidate)],
    ...(direction ? { direction } : {}),
    ...(radius !== undefined ? { radius } : {}),
  }
}

/** Local derived values: never persist transient candidate IDs as feature references. */
export function inspectTopologyMeasurements(
  snapshot: DocumentSnapshot,
  rebuild: { ok: false } | { ok: true; response: unknown },
  target: BodyReference,
): readonly TopologyMeasurementElement[] | null {
  for (const kind of ["edge", "face"] as const) {
    if (!createModelBodyTopologyEvidence(snapshot, rebuild, { ...target, kind }).ok) return null
  }
  if (!rebuild.ok) return null
  const response = documentWorkerResponseSchema.parse(rebuild.response)
  if (response.type !== "documentRebuilt") return null
  const body = response.geometry
    .find(({ featureId }) => featureId === target.featureId)
    ?.geometry.bodies?.find(({ outputRole }) => outputRole === target.outputRole)
  return (
    body?.topologyCandidates.flatMap((candidate) => {
      const value = element(candidate)
      return value ? [value] : []
    }) ?? null
  )
}

export function distanceBetweenMeasurementPoints(left: Point3, right: Point3) {
  return Math.hypot(right[0] - left[0], right[1] - left[1], right[2] - left[2])
}

function dot(left: Point3, right: Point3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

export function topologyDirectionAngle(
  left: TopologyMeasurementElement,
  right: TopologyMeasurementElement,
): number | null {
  if (!left.direction || !right.direction) return null
  return Math.acos(Math.min(1, Math.max(0, Math.abs(dot(left.direction, right.direction)))))
}

/** Distance between infinite parallel supporting planes, not between bounded face patches. */
export function parallelPlaneSeparation(
  left: TopologyMeasurementElement,
  right: TopologyMeasurementElement,
): number | null {
  if (
    left.geometryClass !== "PLANE" ||
    right.geometryClass !== "PLANE" ||
    !left.direction ||
    !right.direction
  )
    return null
  const [a, b] = [left.direction, right.direction]
  if (
    Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) >
    1e-9
  )
    return null
  const delta: Point3 = [
    right.centroid[0] - left.centroid[0],
    right.centroid[1] - left.centroid[1],
    right.centroid[2] - left.centroid[2],
  ]
  return Math.abs(dot(delta, left.direction))
}
