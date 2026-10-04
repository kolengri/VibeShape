import type { DocumentFeatureContentPreparationPort } from "@vibeshape/application/feature-rebuild"
import { resolveReferenceAxis, resolveReferencePlane } from "@vibeshape/application/reference-frame"
import type { FeatureRecord } from "@vibeshape/domain"
import { readMirrorFeatureParametersV3 } from "@vibeshape/domain/part-design-mirror"
import { readPatternFeatureParametersV2 } from "@vibeshape/domain/part-design-pattern"
import { readSplitFeatureParametersV2 } from "@vibeshape/domain/part-design-split"
import { referenceFrameSupportFeatureId } from "@vibeshape/domain/reference-frame"
import {
  mirrorFeatureContentParametersV3Schema,
  patternFeatureContentParametersV2Schema,
  splitFeatureContentParametersV2Schema,
} from "@vibeshape/protocol"

export function shouldPrepareReferenceFrameFeatureContent(feature: FeatureRecord) {
  return Boolean(
    readMirrorFeatureParametersV3(feature) ||
      readSplitFeatureParametersV2(feature) ||
      readPatternFeatureParametersV2(feature),
  )
}
export const prepareReferenceFrameFeatureContent: DocumentFeatureContentPreparationPort = (
  input,
) => {
  const context = {
    document: input.document,
    features: input.features ?? input.document.features,
    geometry: input.geometry ?? [],
  }
  const mirror = readMirrorFeatureParametersV3(input.feature)
  const split = readSplitFeatureParametersV2(input.feature)
  const pattern = readPatternFeatureParametersV2(input.feature)
  const missing = {
    ok: false as const,
    diagnostic: {
      code: "org.vibeshape.feature.reference-frame-unresolved",
      values: { reason: "missing-or-ambiguous-support" },
    },
  }
  if (pattern) {
    const axis = resolveReferenceAxis(pattern.axis, context)
    if (!axis) return missing
    const supportFeatureId = referenceFrameSupportFeatureId(pattern.axis)
    return {
      ok: true,
      parameters: patternFeatureContentParametersV2Schema.parse({
        kind: pattern.kind,
        count: pattern.count.value,
        axisOrigin: axis.origin,
        axisDirection: axis.direction,
        ...(supportFeatureId
          ? { supportInputIndex: input.feature.dependencies.indexOf(supportFeatureId) }
          : {}),
        ...(pattern.kind === "linear"
          ? { spacing: pattern.spacing.value }
          : { angle: pattern.angle.value }),
      }),
    }
  }
  const parameters = mirror ?? split
  if (!parameters) return null
  const plane = resolveReferencePlane(parameters.plane, context)
  if (!plane) return missing
  const supportFeatureId = referenceFrameSupportFeatureId(parameters.plane)
  const content = {
    planeOrigin: plane.origin,
    planeNormal: plane.normal,
    ...(supportFeatureId
      ? { supportInputIndex: input.feature.dependencies.indexOf(supportFeatureId) }
      : {}),
  }
  return {
    ok: true,
    parameters: split
      ? splitFeatureContentParametersV2Schema.parse({ ...content, offset: split.offset.value })
      : mirrorFeatureContentParametersV3Schema.parse({
          ...content,
          offset: mirror?.offset.value,
          preserveSource: mirror?.preserveSource,
        }),
  }
}
