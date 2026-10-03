import { resolveShellOpeningCandidates } from "@vibeshape/application/shell-opening-resolution"
import {
  type DocumentDisplayUnits,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import {
  createBodyTopologyReferenceProjector,
  type ModelBodyTopologyEvidence,
} from "@vibeshape/domain/model-body-topology"
import {
  readShellFeatureParameters,
  shellFeatureParametersSchema,
  shellFeatureType,
  shellThicknessSchema,
} from "@vibeshape/domain/part-design-shell"
import { defaultLengthExpression } from "../../document/document-display-units"
import {
  type PrimitiveLengthCopy,
  parsePrimitiveLengthExpression,
  quantityExpression,
} from "../part-design/primitive-form"

export type ShellFormMode =
  | {
      kind: "create"
      targetBody: BodyReference
      createFeatureId: () => FeatureId
      featureLabel: string
    }
  | { kind: "edit"; feature: FeatureRecord }
export type ShellFormValues = {
  thickness: string
  direction: "inward" | "outward"
  openingIds: string[]
}
export function shellTargetBody(mode: ShellFormMode): BodyReference {
  return mode.kind === "create"
    ? mode.targetBody
    : shellFeatureParametersSchema.parse(mode.feature.parameters).targetBody
}
export function shellInitialSelection(
  mode: ShellFormMode,
  evidence: ModelBodyTopologyEvidence | null,
) {
  if (mode.kind === "create") return { repair: false, openingIds: [] as string[] }
  const parameters = shellFeatureParametersSchema.parse(mode.feature.parameters)
  if (!evidence || evidence.contentHash !== parameters.sourceContentHash)
    return { repair: true, openingIds: [] as string[] }
  const references = parameters.openings.map(({ featureId: _featureId, ...reference }) => reference)
  const resolution = resolveShellOpeningCandidates(references, evidence.candidates, evidence)
  return resolution.ok
    ? { repair: false, openingIds: [...resolution.candidateIds] }
    : { repair: true, openingIds: [] as string[] }
}
export function shellInitialValues(
  mode: ShellFormMode,
  evidence: ModelBodyTopologyEvidence | null,
  units: DocumentDisplayUnits,
): ShellFormValues {
  const parameters = mode.kind === "edit" ? readShellFeatureParameters(mode.feature) : null
  return {
    thickness: parameters
      ? quantityExpression(parameters.thickness)
      : defaultLengthExpression(1, units.length),
    direction: parameters?.direction ?? "inward",
    openingIds: shellInitialSelection(mode, evidence).openingIds,
  }
}
export function shellFormFeature(
  mode: ShellFormMode,
  featureId: FeatureId,
  values: ShellFormValues,
  evidence: ModelBodyTopologyEvidence | null,
  variables: readonly VariableDefinition[],
  units: DocumentDisplayUnits,
  copy: PrimitiveLengthCopy,
): FeatureRecord | null {
  if (evidence?.kind !== "face" || values.openingIds.length === 0) return null
  const targetBody = shellTargetBody(mode)
  if (evidence.featureId !== targetBody.featureId || evidence.outputRole !== targetBody.outputRole)
    return null
  const thickness = parsePrimitiveLengthExpression(
    values.thickness,
    variables,
    copy,
    (quantity) => shellThicknessSchema.safeParse(quantity).success,
    units.length,
  )
  if (!thickness.ok) return null
  const project = createBodyTopologyReferenceProjector(evidence)
  const selected = evidence.candidates.filter(({ candidateId }) =>
    values.openingIds.includes(candidateId),
  )
  if (selected.length !== values.openingIds.length) return null
  const parsed = shellFeatureParametersSchema.safeParse({
    targetBody,
    thickness: thickness.quantity,
    direction: values.direction,
    sourceContentHash: evidence.contentHash,
    openings: selected.map((candidate) => bodyFaceRefSchema.parse(project(candidate))),
  })
  if (!parsed.success) return null
  return featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, parameters: parsed.data }
      : {
          schemaVersion: 0,
          id: featureId,
          type: shellFeatureType.type,
          label: mode.featureLabel,
          parameters: parsed.data,
          dependencies: [targetBody.featureId],
          references: [],
          suppressed: false,
        },
  )
}

export function formatShellMeasurement(value: number): string {
  // OCCT centroids can contain tiny negative round-off at an exact origin plane.
  return (Math.abs(value) < 0.005 ? 0 : value).toFixed(2)
}
