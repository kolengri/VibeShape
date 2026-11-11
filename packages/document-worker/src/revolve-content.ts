import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import { resolveReferenceFace } from "@vibeshape/application/reference-frame"
import type { SupportFrame } from "@vibeshape/application/support-frame"
import {
  type DocumentSnapshot,
  type FeatureRecord,
  type RevolveFeatureParametersV8,
  revolveFeatureParametersV8Schema,
  revolveProfileOutputRole,
} from "@vibeshape/domain"
import { revolveFeatureContentParametersV8Schema } from "@vibeshape/protocol"

type Context = Readonly<{
  document: DocumentSnapshot
  features: readonly FeatureRecord[]
  geometry: readonly FeatureGeometryRecord[]
}>

/**
 * Binds a dynamic endpoint to the exact body revision it was authored against. A changed, missing,
 * or non-solid endpoint blocks preparation instead of retargeting.
 */
export function prepareRevolveEndContent(
  feature: FeatureRecord,
  parameters: RevolveFeatureParametersV8,
  context: Context,
) {
  const end = parameters.endCondition
  if (end.kind === "angle") return { ok: true as const, endCondition: end }
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
  const binding = {
    inputIndex: feature.dependencies.indexOf(end.targetBody.featureId),
    sourceContentHash: end.sourceContentHash,
    outputRole: end.targetBody.outputRole,
  }
  if (end.kind === "up-to-body")
    return { ok: true as const, endCondition: { kind: end.kind, ...binding } }
  if (!resolveReferenceFace(end.face, context)) return { ok: false as const }
  const { featureId: _featureId, ...face } = end.face
  return { ok: true as const, endCondition: { kind: end.kind, ...binding, face } }
}

export type RevolveV8ContentInput = Readonly<{
  feature: FeatureRecord
  context: Context
  sketch: Readonly<{ id: string; support?: { reference: { featureId: string } } | undefined }>
  frame: SupportFrame
  profiles: readonly unknown[]
  axisOrigin: readonly number[]
  axisDirection: readonly number[]
}>

export function prepareRevolveV8Content(input: RevolveV8ContentInput) {
  const parameters = revolveFeatureParametersV8Schema.parse(input.feature.parameters)
  const end = prepareRevolveEndContent(input.feature, parameters, input.context)
  if (!end.ok)
    return {
      ok: false as const,
      reason: "revolve-end-support-stale-or-unavailable",
    }
  const prepared = revolveFeatureContentParametersV8Schema.safeParse({
    sketchId: input.sketch.id,
    ...(input.sketch.support ? { supportFeatureId: input.sketch.support.reference.featureId } : {}),
    frame: input.frame,
    profiles: input.profiles,
    axis: parameters.axis,
    axisOrigin: input.axisOrigin,
    axisDirection: input.axisDirection,
    angleRadians: parameters.angle.value,
    secondAngleRadians: parameters.secondAngle?.value ?? null,
    symmetric: parameters.symmetric,
    reversed: parameters.reversed,
    operation: parameters.operation,
    endCondition: end.endCondition,
    profileOutputRoles: parameters.profiles.profiles.map(revolveProfileOutputRole),
  })
  return prepared.success
    ? { ok: true as const, parameters: prepared.data }
    : {
        ok: false as const,
        reason: "invalid-materialized-revolve",
        issue: prepared.error.issues[0]?.message ?? "unknown-schema-issue",
      }
}
