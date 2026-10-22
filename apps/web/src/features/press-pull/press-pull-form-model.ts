import { resolveShellOpeningCandidates } from "@vibeshape/application/shell-opening-resolution"
import {
  type DocumentDisplayUnits,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"
import {
  type PressPullFeatureParameters,
  pressPullDistanceSchema,
  pressPullFeatureParametersSchema,
  pressPullFeatureType,
  readPressPullFeatureParameters,
} from "@vibeshape/domain/part-design-press-pull"
import { defaultLengthExpression } from "../../document/document-display-units"
import {
  type PrimitiveLengthCopy,
  parsePrimitiveLengthExpression,
  quantityExpression,
} from "../part-design/primitive-form"

export type PressPullFormMode =
  | ({ kind: "create"; createFeatureId: () => FeatureId; featureLabel: string } & Pick<
      PressPullFeatureParameters,
      "targetBody" | "face" | "sourceContentHash"
    >)
  | { kind: "edit"; feature: FeatureRecord }
export function pressPullSource(mode: PressPullFormMode) {
  if (mode.kind === "create") return mode
  const parameters = readPressPullFeatureParameters(mode.feature)
  if (!parameters) throw new Error("Press Pull feature parameters are invalid.")
  return parameters
}
export function pressPullSourceIsCurrent(
  mode: PressPullFormMode,
  evidence: ModelBodyTopologyEvidence | null,
) {
  const source = pressPullSource(mode)
  if (
    evidence?.kind !== "face" ||
    evidence.featureId !== source.targetBody.featureId ||
    evidence.outputRole !== source.targetBody.outputRole ||
    evidence.contentHash !== source.sourceContentHash
  )
    return false
  const { featureId: _featureId, ...face } = source.face
  return resolveShellOpeningCandidates([face], evidence.candidates, source.targetBody, "exact", {
    allowSemanticRebinding: false,
  }).ok
}
export function pressPullInitialDistance(mode: PressPullFormMode, units: DocumentDisplayUnits) {
  return mode.kind === "edit"
    ? quantityExpression(pressPullFeatureParametersSchema.parse(mode.feature.parameters).distance)
    : defaultLengthExpression(1, units.length)
}
export function pressPullFormFeature(
  mode: PressPullFormMode,
  featureId: FeatureId,
  distance: string,
  evidence: ModelBodyTopologyEvidence | null,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PrimitiveLengthCopy,
): FeatureRecord | null {
  if (!pressPullSourceIsCurrent(mode, evidence)) return null
  const parsed = parsePrimitiveLengthExpression(
    distance,
    variables,
    copy,
    (quantity) => pressPullDistanceSchema.safeParse(quantity).success,
    units.length,
  )
  if (!parsed.ok) return null
  const source = pressPullSource(mode)
  const parameters = pressPullFeatureParametersSchema.parse({
    targetBody: source.targetBody,
    face: source.face,
    sourceContentHash: source.sourceContentHash,
    distance: parsed.quantity,
  })
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, parameters }
      : {
          schemaVersion: 0,
          id: featureId,
          type: pressPullFeatureType.type,
          label: mode.featureLabel,
          parameters,
          dependencies: [source.targetBody.featureId],
          references: [],
          suppressed: false,
        },
  )
}
