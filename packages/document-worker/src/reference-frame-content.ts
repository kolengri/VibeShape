import type { DocumentFeatureContentPreparationPort } from "@vibeshape/application/feature-rebuild"
import {
  resolveDatumPoint,
  resolveReferenceAxis,
  resolveReferencePlane,
} from "@vibeshape/application/reference-frame"
import {
  datumPointSupportFeatureId,
  type FeatureRecord,
  readDatumPointFeatureParameters,
} from "@vibeshape/domain"
import { readMirrorFeatureParametersV3 } from "@vibeshape/domain/part-design-mirror"
import { readPatternFeatureParametersV2 } from "@vibeshape/domain/part-design-pattern"
import { readSplitFeatureParametersV2 } from "@vibeshape/domain/part-design-split"
import { referenceFrameSupportFeatureId } from "@vibeshape/domain/reference-frame"
import {
  datumPointFeatureContentParametersSchema,
  mirrorFeatureContentParametersV3Schema,
  patternFeatureContentParametersV2Schema,
  splitFeatureContentParametersV2Schema,
} from "@vibeshape/protocol"

export function shouldPrepareReferenceFrameFeatureContent(feature: FeatureRecord) {
  return Boolean(
    readDatumPointFeatureParameters(feature) ||
      readMirrorFeatureParametersV3(feature) ||
      readSplitFeatureParametersV2(feature) ||
      readPatternFeatureParametersV2(feature),
  )
}
const DATUM_POINT_MARKER_DIAMETER_MM = 4

type ReferenceContext = Parameters<typeof resolveDatumPoint>[1]

/** Resolves the persisted reference now; the worker only sees the resolved position. */
function prepareDatumPointContent(
  datumPoint: NonNullable<ReturnType<typeof readDatumPointFeatureParameters>>,
  context: ReferenceContext,
) {
  const resolved = resolveDatumPoint(datumPoint, context)
  if (!resolved.ok)
    return {
      ok: false as const,
      diagnostic: {
        code: "org.vibeshape.feature.datum-point-reference-unresolved",
        values: { reason: resolved.reason },
      },
    }
  const supportFeatureId = datumPointSupportFeatureId(datumPoint)
  return {
    ok: true as const,
    parameters: datumPointFeatureContentParametersSchema.parse({
      position: resolved.position,
      size: DATUM_POINT_MARKER_DIAMETER_MM,
      ...(supportFeatureId ? { supportFeatureId } : {}),
    }),
  }
}

export const prepareReferenceFrameFeatureContent: DocumentFeatureContentPreparationPort = (
  input,
) => {
  const context = {
    document: input.document,
    features: input.features ?? input.document.features,
    geometry: input.geometry ?? [],
  }
  const datumPoint = readDatumPointFeatureParameters(input.feature)
  if (datumPoint) return prepareDatumPointContent(datumPoint, context)
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
