import type { DocumentFeatureContentPreparationPort } from "@vibeshape/application/feature-rebuild"
import { resolveReferenceAxis, resolveReferencePlane } from "@vibeshape/application/reference-frame"
import type { FeatureRecord } from "@vibeshape/domain"
import { draftContentFace, readDraftFeatureParameters } from "@vibeshape/domain/part-design-draft"
import { readMirrorFeatureParametersV3 } from "@vibeshape/domain/part-design-mirror"
import { readPatternFeatureParametersV2 } from "@vibeshape/domain/part-design-pattern"
import { readSplitFeatureParametersV2 } from "@vibeshape/domain/part-design-split"
import { referenceFrameSupportFeatureId } from "@vibeshape/domain/reference-frame"
import {
  draftFeatureContentParametersSchema,
  mirrorFeatureContentParametersV3Schema,
  patternFeatureContentParametersV2Schema,
  splitFeatureContentParametersV2Schema,
} from "@vibeshape/protocol"

export function shouldPrepareReferenceFrameFeatureContent(feature: FeatureRecord) {
  return Boolean(
    readDraftFeatureParameters(feature) ||
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

/** Dispatches Draft neutral-plane preparation before the Mirror, Split and Pattern supports. */
export const prepareReferenceSupportedFeatureContent: DocumentFeatureContentPreparationPort = (
  input,
) => {
  const draft = readDraftFeatureParameters(input.feature)
  return draft ? prepareDraftContent(draft, input) : prepareReferenceFrameFeatureContent(input)
}

/**
 * Resolves the Draft neutral plane and pull direction. A planar neutral face pulls into the body
 * (against its outward normal) so drafting walls about their base face narrows them away from it.
 */
function prepareDraftContent(
  draft: NonNullable<ReturnType<typeof readDraftFeatureParameters>>,
  input: Parameters<DocumentFeatureContentPreparationPort>[0],
) {
  const plane = resolveReferencePlane(draft.neutralPlane, {
    document: input.document,
    features: input.features ?? input.document.features,
    geometry: input.geometry ?? [],
  })
  if (!plane)
    return {
      ok: false as const,
      diagnostic: {
        code: "org.vibeshape.feature.reference-frame-unresolved",
        values: { reason: "missing-or-ambiguous-support" },
      },
    }
  const sense = (draft.neutralPlane.kind === "planar-face" ? -1 : 1) * (draft.flip ? -1 : 1)
  const supportFeatureId = referenceFrameSupportFeatureId(draft.neutralPlane)
  return {
    ok: true as const,
    parameters: draftFeatureContentParametersSchema.parse({
      faces: draft.faces.map(draftContentFace),
      planeOrigin: plane.origin,
      planeNormal: plane.normal,
      pullDirection: plane.normal.map((value) => (value === 0 ? 0 : value * sense)),
      angle: draft.angle.value,
      ...(supportFeatureId
        ? { supportInputIndex: input.feature.dependencies.indexOf(supportFeatureId) }
        : {}),
    }),
  }
}
