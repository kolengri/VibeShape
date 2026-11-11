import { type FeatureRecord, featureRecordSchema } from "@vibeshape/domain"
import { type BodyReference, bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import type { DocumentNodeRef } from "@vibeshape/domain/document-node"
import { readDraftFeatureParameters } from "@vibeshape/domain/part-design-draft"
import {
  readMirrorFeatureParameters,
  readMirrorFeatureParametersV3,
} from "@vibeshape/domain/part-design-mirror"
import {
  readPatternFeatureParameters,
  readPatternFeatureParametersV2,
} from "@vibeshape/domain/part-design-pattern"
import { readPatternFeatureParametersV3 } from "@vibeshape/domain/part-design-pattern-path"
import { readPlacementFeatureParameters } from "@vibeshape/domain/part-design-placement"
import { readScaleFeatureParameters } from "@vibeshape/domain/part-design-scale"
import { readShellFeatureParameters, shellFeatureTypeV2 } from "@vibeshape/domain/part-design-shell"
import {
  readSplitFeatureParameters,
  readSplitFeatureParametersV2,
} from "@vibeshape/domain/part-design-split"
import { readThickenFeatureParameters } from "@vibeshape/domain/part-design-thicken"
import { readThreadFeatureParameters } from "@vibeshape/domain/part-design-thread"
import {
  type ReferenceAxis,
  type ReferencePlane,
  referenceFrameDependencyIds,
} from "@vibeshape/domain/reference-frame"

type BodyRecipe = Readonly<{
  parameters: Readonly<Record<string, unknown> & { targetBody: BodyReference }>
  support?: ReferencePlane | ReferenceAxis
  shellClosed?: boolean
  /** Body-bound faces cannot move to another body; the form keeps the saved record and re-picks. */
  reselectFaces?: true
  /** Non-body owners after the target, such as a path sketch's supports, stay in place. */
  retainedDependencies?: readonly FeatureRecord["dependencies"][number][]
}>

function simpleBodyRecipe(feature: FeatureRecord): BodyRecipe | null {
  const pathPattern = readPatternFeatureParametersV3(feature)
  if (pathPattern)
    return { parameters: pathPattern, retainedDependencies: feature.dependencies.slice(1) }
  const parameters =
    readMirrorFeatureParameters(feature) ??
    readPatternFeatureParameters(feature) ??
    readSplitFeatureParameters(feature) ??
    readScaleFeatureParameters(feature)
  return parameters ? { parameters } : null
}

function bodyRecipe(feature: FeatureRecord): BodyRecipe | null {
  const placement = readPlacementFeatureParameters(feature)
  if (placement) return { parameters: placement }
  const mirror = readMirrorFeatureParametersV3(feature)
  if (mirror) return { parameters: mirror, support: mirror.plane }
  const pattern = readPatternFeatureParametersV2(feature)
  if (pattern) return { parameters: pattern, support: pattern.axis }
  const split = readSplitFeatureParametersV2(feature)
  if (split) return { parameters: split, support: split.plane }
  const thread = readThreadFeatureParameters(feature)
  if (thread)
    return {
      parameters: thread,
      ...(typeof thread.axis === "string" ? {} : { support: thread.axis }),
    }
  return faceSelectionRecipe(feature) ?? simpleBodyRecipe(feature)
}

/** Features whose body-bound faces cannot move to a replacement body without reselection. */
function faceSelectionRecipe(feature: FeatureRecord): BodyRecipe | null {
  const shell = readShellFeatureParameters(feature)
  if (shell) return { parameters: shell, shellClosed: shell.openings.length === 0 }
  const faceBound = readDraftFeatureParameters(feature) ?? readThickenFeatureParameters(feature)
  return faceBound ? { parameters: faceBound, reselectFaces: true } : null
}

/** Only first-party, schema-validated body fields participate in this form adapter. */
export function missingHistoryFeatureBody(
  feature: FeatureRecord,
  missingInputs: readonly DocumentNodeRef[],
): BodyReference | null {
  const recipe = bodyRecipe(feature)
  return recipe &&
    missingInputs.some(
      (node) => node.kind === "feature" && node.id === recipe.parameters.targetBody.featureId,
    )
    ? recipe.parameters.targetBody
    : null
}

export type HistoryFeatureBodyReplacement = Readonly<{
  feature: FeatureRecord
  shellClosed?: boolean
  /** Replacement body for a feature whose faces must be picked again on it. */
  faceTarget?: BodyReference
}>

/** Disposable form input: saved authority changes only through the ordinary feature update. */
export function replaceHistoryFeatureBody(
  feature: FeatureRecord,
  missingInputs: readonly DocumentNodeRef[],
  replacement: BodyReference,
): HistoryFeatureBodyReplacement | null {
  const target = missingHistoryFeatureBody(feature, missingInputs)
  const body = bodyReferenceSchema.safeParse(replacement)
  if (
    !target ||
    !body.success ||
    body.data.featureId === feature.id ||
    body.data.featureId === target.featureId
  )
    return null
  const recipe = bodyRecipe(feature)
  if (!recipe) return null
  // Draft and Thicken faces, and a planar-face neutral plane, belong to the missing body, so the saved record
  // stays unchanged and the form starts on the replacement with an explicit face selection.
  if (recipe.reselectFaces) return { feature, faceTarget: body.data }
  const support: ReferencePlane | ReferenceAxis | undefined = recipe.support
  const shellClosed = recipe.shellClosed
  const adapted = featureRecordSchema.safeParse({
    ...feature,
    ...(shellClosed === undefined ? {} : { type: shellFeatureTypeV2.type }),
    parameters: {
      ...recipe.parameters,
      targetBody: body.data,
      ...(shellClosed === undefined ? {} : { openings: [] }),
    },
    // Support references retain their owner and signature until explicit re-selection.
    dependencies: support
      ? referenceFrameDependencyIds(body.data.featureId, support)
      : [...new Set([body.data.featureId, ...(recipe.retainedDependencies ?? [])])],
  })
  if (!adapted.success || !bodyRecipe(adapted.data)) return null
  return {
    feature: adapted.data,
    ...(shellClosed === undefined ? {} : { shellClosed }),
  }
}
