import {
  type DocumentSnapshot,
  type FeatureRecord,
  resolveTopologyReference,
  type TopologyCandidate,
} from "@vibeshape/domain"
import type { BodyTopoRef } from "@vibeshape/domain/body-topology-reference"
import {
  type ReferenceAxis,
  type ReferencePlane,
  referenceDirectionSchema,
  referenceOriginSchema,
} from "@vibeshape/domain/reference-frame"
import type { FeatureGeometryRecord } from "./feature-rebuild"
import { datumPlaneFrame } from "./support-frame"
import { projectTopologyCandidate } from "./topology-candidate-projection"

type Vector = readonly [number, number, number]
export type ResolvedReferencePlane = Readonly<{ origin: Vector; normal: Vector }>
export type ResolvedReferenceAxis = Readonly<{ origin: Vector; direction: Vector }>
type Context = Readonly<{
  document: DocumentSnapshot
  features: readonly FeatureRecord[]
  geometry: readonly FeatureGeometryRecord[]
}>
const axes = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] } as const
const normals = { XY: axes.Z, XZ: axes.Y, YZ: axes.X } as const

function currentBodyCandidate(reference: BodyTopoRef, context: Context) {
  const record = context.geometry.find(({ featureId }) => featureId === reference.featureId)
  const body = record?.geometry.bodies?.find(
    ({ outputRole }) => outputRole === reference.outputRole,
  )
  if (!body?.shape.valid || body.shape.solidCount !== 1) return null
  const candidates = body.topologyCandidates.filter(({ kind }) => kind === reference.kind)
  const domainCandidates: TopologyCandidate[] = candidates.map(projectTopologyCandidate)
  const { outputRole: _outputRole, schemaVersion: _schemaVersion, ...legacyReference } = reference
  const resolution = resolveTopologyReference(
    { ...legacyReference, schemaVersion: 0 },
    domainCandidates,
  )
  return resolution.status === "resolved"
    ? (candidates.find(({ candidateId }) => candidateId === resolution.candidateId) ?? null)
    : null
}
function currentDatumFrame(featureId: string, context: Context) {
  const feature = context.features.find(({ id }) => id === featureId)
  const current = context.geometry.some((record) => record.featureId === featureId)
  return feature && !feature.suppressed && current
    ? datumPlaneFrame(
        feature,
        context.document,
        context.features,
        new Set([featureId]),
        context.geometry,
      )
    : null
}
export function resolveReferencePlane(
  support: ReferencePlane,
  context: Context,
): ResolvedReferencePlane | null {
  switch (support.kind) {
    case "origin-plane":
      return { origin: [0, 0, 0], normal: normals[support.plane] }
    case "explicit-plane":
      return { origin: support.origin, normal: support.normal }
    case "datum-plane": {
      const frame = currentDatumFrame(support.featureId, context)
      return frame ? { origin: frame.origin, normal: frame.normal } : null
    }
    case "planar-face": {
      const candidate = currentBodyCandidate(support.reference, context)
      const signature = candidate?.signature
      if (
        candidate?.kind !== "face" ||
        signature?.geometryClass !== "PLANE" ||
        signature.directionMode !== "oriented" ||
        !signature.direction
      )
        return null
      const normal = referenceDirectionSchema.safeParse(signature.direction)
      const origin = referenceOriginSchema.safeParse(signature.centroid)
      return normal.success && origin.success ? { origin: origin.data, normal: normal.data } : null
    }
  }
}
export function resolveReferenceAxis(
  support: ReferenceAxis,
  context: Context,
): ResolvedReferenceAxis | null {
  switch (support.kind) {
    case "origin-axis":
      return { origin: [0, 0, 0], direction: axes[support.axis] }
    case "explicit-axis":
      return { origin: support.origin, direction: support.direction }
    case "datum-axis": {
      const frame = currentDatumFrame(support.featureId, context)
      return frame
        ? {
            origin: frame.origin,
            direction:
              support.axis === "normal"
                ? frame.normal
                : support.axis === "x"
                  ? frame.xAxis
                  : frame.yAxis,
          }
        : null
    }
    case "linear-edge":
      return resolveLinearEdgeAxis(support, context)
  }
}

function resolveLinearEdgeAxis(
  support: Extract<ReferenceAxis, { kind: "linear-edge" }>,
  context: Context,
): ResolvedReferenceAxis | null {
  const candidate = currentBodyCandidate(support.reference, context)
  const line = candidate?.referenceGeometry
  if (candidate?.kind !== "edge" || line?.kind !== "line-edge") return null
  const delta = line.end.map((value, index) => value - (line.start[index] ?? 0))
  const length = Math.hypot(...delta)
  if (!Number.isFinite(length) || length <= 1e-8) return null
  const direction = orientedLineDirection(delta, length, support.reference.signature.direction)
  // Native edge reversal must retain the authored sign and position-zero anchor.
  const reversed = delta.reduce((sum, value, index) => sum + value * (direction[index] ?? 0), 0) < 0
  return validatedReferenceAxis(reversed ? line.end : line.start, direction)
}

function validatedReferenceAxis(origin: unknown, direction: unknown): ResolvedReferenceAxis | null {
  const parsedDirection = referenceDirectionSchema.safeParse(direction)
  const parsedOrigin = referenceOriginSchema.safeParse(origin)
  return parsedDirection.success && parsedOrigin.success
    ? { origin: parsedOrigin.data, direction: parsedDirection.data }
    : null
}

function orientedLineDirection(
  delta: readonly number[],
  length: number,
  authored?: readonly number[],
) {
  const direction = delta.map((value) => value / length) as [number, number, number]
  // Native edge orientation may flip after rebuild; the authored direction retains axis sign.
  if (
    authored &&
    direction.reduce((sum, value, index) => sum + value * (authored[index] ?? 0), 0) < 0
  )
    return direction.map((value) => -value || 0) as [number, number, number]
  return direction
}
