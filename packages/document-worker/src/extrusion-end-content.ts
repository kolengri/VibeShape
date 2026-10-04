import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import { resolveReferencePlane } from "@vibeshape/application/reference-frame"
import type {
  DocumentSnapshot,
  ExtrusionFeatureParametersV6,
  FeatureRecord,
} from "@vibeshape/domain"
import type { ExtrusionFeatureContentParametersV6 } from "@vibeshape/protocol"

type Context = {
  document: DocumentSnapshot
  features: readonly FeatureRecord[]
  geometry: readonly FeatureGeometryRecord[]
}
export function prepareExtrusionEndContent(
  feature: FeatureRecord,
  parameters: ExtrusionFeatureParametersV6,
  context: Context,
  frame: ExtrusionFeatureContentParametersV6["frame"],
) {
  const end = parameters.endCondition
  if (end.kind === "distance")
    return { ok: true as const, endCondition: end, distance: parameters.distance.value }
  const source = context.geometry.find(({ featureId }) => featureId === end.targetBody.featureId)
  const body = source?.geometry.bodies?.find(
    ({ outputRole }) => outputRole === end.targetBody.outputRole,
  )
  if (
    !source ||
    source.contentHash !== end.sourceContentHash ||
    !body?.shape.valid ||
    body.shape.solidCount !== 1
  )
    return { ok: false as const }
  const direction = frame.normal.map((v) => v * (parameters.reversed ? -1 : 1))
  const dot = (v: readonly number[]) =>
    v.reduce((sum, value, index) => sum + value * (direction[index] ?? 0), 0)
  const start = frame.origin.map(
    (v, index) => v + (frame.normal[index] ?? 0) * parameters.startOffset.value,
  )
  const maximum = Math.max(
    ...Array.from({ length: 8 }, (_, corner) =>
      dot(
        [0, 1, 2].map(
          (axis) =>
            (corner & (1 << axis) ? body.shape.bounds.max[axis] : body.shape.bounds.min[axis]) ?? 0,
        ),
      ),
    ),
  )
  const distance = maximum - dot(start) + 0.01
  if (!Number.isFinite(distance) || distance < 0.001 || distance > 100_000)
    return { ok: false as const }
  const base = {
    kind: end.kind,
    sourceContentHash: end.sourceContentHash,
    outputRole: end.targetBody.outputRole,
    inputIndex: feature.dependencies.indexOf(end.targetBody.featureId),
  }
  if (end.kind !== "up-to-face") return { ok: true as const, distance, endCondition: base }
  const plane = resolveReferencePlane({ kind: "planar-face", reference: end.face }, context)
  if (!plane || Math.abs(dot(plane.normal)) < 1e-8) return { ok: false as const }
  const { featureId: _featureId, ...face } = end.face
  return {
    ok: true as const,
    distance,
    endCondition: {
      ...base,
      kind: "up-to-face" as const,
      face,
      planeOrigin: plane.origin,
      planeNormal: plane.normal,
    },
  }
}
