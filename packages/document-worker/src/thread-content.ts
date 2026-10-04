import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import { resolveReferenceAxis } from "@vibeshape/application/reference-frame"
import type { DocumentSnapshot, FeatureRecord } from "@vibeshape/domain"
import { readThreadFeatureParameters } from "@vibeshape/domain/part-design-thread"
import { referenceFrameSupportFeatureId } from "@vibeshape/domain/reference-frame"
import { threadContentParametersV2Schema } from "@vibeshape/protocol"

export function prepareThreadContent(
  feature: FeatureRecord,
  context: {
    document: DocumentSnapshot
    features: readonly FeatureRecord[]
    geometry: readonly FeatureGeometryRecord[]
  },
) {
  const thread = readThreadFeatureParameters(feature)
  if (!thread || typeof thread.axis === "string") return null
  const axis = resolveReferenceAxis(thread.axis, context)
  if (!axis)
    return {
      ok: false as const,
      diagnostic: {
        code: "org.vibeshape.feature.thread-axis-missing",
        values: { reason: "axis-unresolved" },
      },
    }
  const supportFeatureId = referenceFrameSupportFeatureId(thread.axis)
  const { targetBody: _targetBody, axis: _axis, ...quantities } = thread
  const parameters = threadContentParametersV2Schema.safeParse({
    ...Object.fromEntries(
      Object.entries(quantities).map(([key, value]) => [
        key,
        typeof value === "object" ? value.value : value,
      ]),
    ),
    axis: "custom",
    origin: axis.origin,
    direction: axis.direction,
    ...(supportFeatureId ? { supportFeatureId } : {}),
  })
  return parameters.success
    ? { ok: true as const, parameters: parameters.data }
    : {
        ok: false as const,
        diagnostic: {
          code: "org.vibeshape.feature.thread-axis-missing",
          values: { reason: "invalid-resolved-axis" },
        },
      }
}
