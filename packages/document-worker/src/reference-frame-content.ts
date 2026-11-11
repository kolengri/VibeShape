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
import { readCoilFeatureParameters } from "@vibeshape/domain/part-design-coil"
import { draftContentFace, readDraftFeatureParameters } from "@vibeshape/domain/part-design-draft"
import { helixContentFields } from "@vibeshape/domain/part-design-helix"
import { readMirrorFeatureParametersV3 } from "@vibeshape/domain/part-design-mirror"
import { readPatternFeatureParametersV2 } from "@vibeshape/domain/part-design-pattern"
import { readSplitFeatureParametersV2 } from "@vibeshape/domain/part-design-split"
import { referenceFrameSupportFeatureId } from "@vibeshape/domain/reference-frame"
import {
  coilFeatureContentParametersSchema,
  datumPointFeatureContentParametersSchema,
  draftFeatureContentParametersSchema,
  mirrorFeatureContentParametersV3Schema,
  patternFeatureContentParametersV2Schema,
  splitFeatureContentParametersV2Schema,
} from "@vibeshape/protocol"

export function shouldPrepareReferenceFrameFeatureContent(feature: FeatureRecord) {
  return Boolean(
    readDatumPointFeatureParameters(feature) ||
      readDraftFeatureParameters(feature) ||
      readMirrorFeatureParametersV3(feature) ||
      readSplitFeatureParametersV2(feature) ||
      readPatternFeatureParametersV2(feature) ||
      readCoilFeatureParameters(feature),
  )
}
type Context = Parameters<typeof resolveReferenceAxis>[1]
type Prepared = Awaited<ReturnType<DocumentFeatureContentPreparationPort>>

/** Coil resolves its axis like Pattern v2 and emits UUID-free helix content. */
function prepareCoilContent(feature: FeatureRecord, context: Context): Prepared {
  const coil = readCoilFeatureParameters(feature)
  if (!coil) return null
  const axis = resolveReferenceAxis(coil.axis, context)
  if (!axis)
    return {
      ok: false,
      diagnostic: {
        code: "org.vibeshape.feature.reference-frame-unresolved",
        values: { reason: "missing-or-ambiguous-support" },
      },
    }
  const supportFeatureId = referenceFrameSupportFeatureId(coil.axis)
  const { section } = coil
  const parsed = coilFeatureContentParametersSchema.safeParse({
    helix: { origin: axis.origin, direction: axis.direction, ...helixContentFields(coil) },
    section:
      section.kind === "circular"
        ? { kind: "circular", diameter: section.diameter.value }
        : { kind: "rectangular", width: section.width.value, height: section.height.value },
    operation: coil.operation,
    ...(supportFeatureId
      ? { supportInputIndex: feature.dependencies.indexOf(supportFeatureId) }
      : {}),
  })
  return parsed.success
    ? { ok: true, parameters: parsed.data }
    : {
        ok: false,
        diagnostic: {
          code: "org.vibeshape.feature.coil-invalid",
          values: { reason: parsed.error.issues[0]?.message ?? "invalid-resolved-coil" },
        },
      }
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

/** Datum Point and Coil resolve their own support without a consumed target plane. */
function prepareStandaloneReferenceContent(feature: FeatureRecord, context: ReferenceContext) {
  const datumPoint = readDatumPointFeatureParameters(feature)
  return datumPoint
    ? prepareDatumPointContent(datumPoint, context)
    : prepareCoilContent(feature, context)
}

export const prepareReferenceFrameFeatureContent: DocumentFeatureContentPreparationPort = (
  input,
) => {
  const context = {
    document: input.document,
    features: input.features ?? input.document.features,
    geometry: input.geometry ?? [],
  }
  const standalone = prepareStandaloneReferenceContent(input.feature, context)
  if (standalone) return standalone
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
