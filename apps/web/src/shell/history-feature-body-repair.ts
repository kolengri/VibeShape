import { type FeatureRecord, featureRecordSchema } from "@vibeshape/domain"
import { type BodyReference, bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import type { DocumentNodeRef } from "@vibeshape/domain/document-node"
import {
  readMirrorFeatureParameters,
  readMirrorFeatureParametersV3,
} from "@vibeshape/domain/part-design-mirror"
import {
  readPatternFeatureParameters,
  readPatternFeatureParametersV2,
} from "@vibeshape/domain/part-design-pattern"
import { readPlacementFeatureParameters } from "@vibeshape/domain/part-design-placement"
import { readShellFeatureParameters, shellFeatureTypeV2 } from "@vibeshape/domain/part-design-shell"
import {
  readSplitFeatureParameters,
  readSplitFeatureParametersV2,
} from "@vibeshape/domain/part-design-split"
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
}>

function simpleBodyRecipe(feature: FeatureRecord): BodyRecipe | null {
  const parameters =
    readMirrorFeatureParameters(feature) ??
    readPatternFeatureParameters(feature) ??
    readSplitFeatureParameters(feature)
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
  const shell = readShellFeatureParameters(feature)
  if (shell) return { parameters: shell, shellClosed: shell.openings.length === 0 }
  return simpleBodyRecipe(feature)
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
      : [body.data.featureId],
  })
  if (!adapted.success || !bodyRecipe(adapted.data)) return null
  return {
    feature: adapted.data,
    ...(shellClosed === undefined ? {} : { shellClosed }),
  }
}
