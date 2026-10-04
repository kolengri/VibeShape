import { applyAutomationDraftCommandRequestSchema } from "@vibeshape/automation-api/drafts"
import type { LocalOperation } from "@vibeshape/automation-api/local-tools"
import { type CommandActor, datumPlaneFeatureType, featureRecordSchema } from "@vibeshape/domain"
import {
  booleanFeatureType,
  extrusionFeatureType,
  extrusionFeatureTypeV3,
  extrusionFeatureTypeV4,
  extrusionFeatureTypeV5,
  extrusionFeatureTypeV6,
  revolveFeatureType,
  revolveFeatureTypeV5,
  revolveFeatureTypeV6,
} from "@vibeshape/domain/part-design"
import {
  compoundFeatureTypeV2,
  unionFeatureTypeV2,
} from "@vibeshape/domain/part-design-body-combination"
import {
  holeFeatureParametersSchema,
  holeFeatureParametersV2Schema,
  holeFeatureParametersV3Schema,
  holeFeatureType,
  holeFeatureTypeV2,
  holeFeatureTypeV3,
} from "@vibeshape/domain/part-design-hole"
import { loftFeatureType } from "@vibeshape/domain/part-design-loft"
import {
  mirrorFeatureType,
  mirrorFeatureTypeV2,
  mirrorFeatureTypeV3,
} from "@vibeshape/domain/part-design-mirror"
import { patternFeatureType, patternFeatureTypeV2 } from "@vibeshape/domain/part-design-pattern"
import { shellFeatureTypeV2 } from "@vibeshape/domain/part-design-shell"
import { splitFeatureType, splitFeatureTypeV2 } from "@vibeshape/domain/part-design-split"
import { sweepFeatureType } from "@vibeshape/domain/part-design-sweep"
import { threadFeatureType, threadFeatureTypeV2 } from "@vibeshape/domain/part-design-thread"

type CadOperation = Extract<
  LocalOperation,
  {
    tool:
      | "create_sketch"
      | "update_sketch"
      | "create_extrude"
      | "update_extrude"
      | "create_revolve"
      | "update_revolve"
      | "create_hole"
      | "update_hole"
      | "create_reference_mirror"
      | "update_reference_mirror"
      | "create_reference_split"
      | "update_reference_split"
      | "create_reference_body_pattern"
      | "update_reference_body_pattern"
      | "create_mirror"
      | "update_mirror"
      | "create_shell"
      | "update_shell"
      | "create_thread"
      | "update_thread"
      | "create_body_pattern"
      | "update_body_pattern"
      | "create_split"
      | "update_split"
      | "create_loft"
      | "update_loft"
      | "create_sweep"
      | "update_sweep"
      | "create_datum_plane"
      | "update_datum_plane"
      | "create_boolean"
      | "update_boolean"
      | "create_union"
      | "update_union"
      | "create_compound"
      | "update_compound"
  }
>

const directCadFeatureTypes = {
  create_reference_body_pattern: patternFeatureTypeV2.type,
  update_reference_body_pattern: patternFeatureTypeV2.type,
  create_reference_split: splitFeatureTypeV2.type,
  update_reference_split: splitFeatureTypeV2.type,
  create_reference_mirror: mirrorFeatureTypeV3.type,
  update_reference_mirror: mirrorFeatureTypeV3.type,
  create_datum_plane: datumPlaneFeatureType.type,
  update_datum_plane: datumPlaneFeatureType.type,
  create_boolean: booleanFeatureType.type,
  update_boolean: booleanFeatureType.type,
  create_union: unionFeatureTypeV2.type,
  update_union: unionFeatureTypeV2.type,
  create_compound: compoundFeatureTypeV2.type,
  update_compound: compoundFeatureTypeV2.type,
  create_shell: shellFeatureTypeV2.type,
  update_shell: shellFeatureTypeV2.type,
  create_mirror: mirrorFeatureType.type,
  update_mirror: mirrorFeatureType.type,
  create_body_pattern: patternFeatureType.type,
  update_body_pattern: patternFeatureType.type,
  create_split: splitFeatureType.type,
  update_split: splitFeatureType.type,
  create_loft: loftFeatureType.type,
  update_loft: loftFeatureType.type,
  create_sweep: sweepFeatureType.type,
  update_sweep: sweepFeatureType.type,
} as const
function cadFeatureType(
  operation: Exclude<CadOperation, { tool: "create_sketch" | "update_sketch" }>,
) {
  if (isThreadOperation(operation)) return threadType(operation.arguments.parameters)
  if (isBodySelectionOperation(operation)) return bodySelectionFeatureType(operation)
  if (
    operation.tool === "create_extrude" ||
    operation.tool === "update_extrude" ||
    operation.tool === "create_revolve" ||
    operation.tool === "update_revolve"
  )
    return profileFeatureType(operation)
  return directCadFeatureTypes[operation.tool]
}

function isBodySelectionOperation(
  operation: Exclude<CadOperation, { tool: "create_sketch" | "update_sketch" }>,
): operation is Extract<
  CadOperation,
  { tool: "create_mirror" | "update_mirror" | "create_hole" | "update_hole" }
> {
  return (
    operation.tool === "create_mirror" ||
    operation.tool === "update_mirror" ||
    operation.tool === "create_hole" ||
    operation.tool === "update_hole"
  )
}

function isThreadOperation(
  operation: Exclude<CadOperation, { tool: "create_sketch" | "update_sketch" }>,
): operation is Extract<CadOperation, { tool: "create_thread" | "update_thread" }> {
  return operation.tool === "create_thread" || operation.tool === "update_thread"
}
function threadType(
  parameters: Extract<
    CadOperation,
    { tool: "create_thread" | "update_thread" }
  >["arguments"]["parameters"],
) {
  return "origin" in parameters ? threadFeatureType.type : threadFeatureTypeV2.type
}

function bodySelectionFeatureType(
  operation: Extract<
    CadOperation,
    { tool: "create_mirror" | "update_mirror" | "create_hole" | "update_hole" }
  >,
) {
  if (operation.tool === "create_mirror" || operation.tool === "update_mirror")
    return "offset" in operation.arguments.parameters
      ? mirrorFeatureTypeV2.type
      : mirrorFeatureType.type
  if ("treatment" in operation.arguments.parameters) return holeFeatureTypeV3.type
  return "targetBody" in operation.arguments.parameters
    ? holeFeatureTypeV2.type
    : holeFeatureType.type
}

function profileFeatureType(
  operation: Extract<
    CadOperation,
    { tool: "create_extrude" | "update_extrude" | "create_revolve" | "update_revolve" }
  >,
) {
  const parameters = operation.arguments.parameters
  if (operation.tool === "create_extrude" || operation.tool === "update_extrude") {
    if ("endCondition" in parameters) return extrusionFeatureTypeV6.type
    if ("reversed" in parameters) return extrusionFeatureTypeV5.type
    if ("profile" in parameters) return extrusionFeatureType.type
    return parameters.operation === "new"
      ? extrusionFeatureTypeV3.type
      : extrusionFeatureTypeV4.type
  }
  if ("profile" in parameters) return revolveFeatureType.type
  return parameters.operation === "new" ? revolveFeatureTypeV5.type : revolveFeatureTypeV6.type
}

export function createLocalCadCommand(
  operation: CadOperation,
  actor: CommandActor,
  documentId: string,
) {
  const input = operation.arguments
  const envelope = {
    schemaVersion: 1,
    commandId: input.commandId,
    baseRevision: input.baseRevision,
    documentId,
    issuedAt: new Date().toISOString(),
    actor,
  }
  if (operation.tool === "create_sketch" || operation.tool === "update_sketch") {
    return applyAutomationDraftCommandRequestSchema.parse({
      schemaVersion: 1,
      draftId: input.draftId,
      command: {
        ...envelope,
        kind:
          operation.tool === "create_sketch"
            ? "org.vibeshape.sketch.add"
            : "org.vibeshape.sketch.update",
        payload: { sketch: operation.arguments.sketch },
      },
    })
  }
  const featureInput = operation.arguments
  const parameters =
    operation.tool === "create_hole" || operation.tool === "update_hole"
      ? ("treatment" in featureInput.parameters
          ? holeFeatureParametersV3Schema
          : "targetBody" in featureInput.parameters
            ? holeFeatureParametersV2Schema
            : holeFeatureParametersSchema
        ).parse(featureInput.parameters)
      : featureInput.parameters
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureInput.featureId,
    type: cadFeatureType(operation),
    parameters,
    dependencies: featureInput.dependencies,
    references: featureInput.references,
    suppressed: featureInput.suppressed,
    ...(featureInput.label ? { label: featureInput.label } : {}),
  })
  return applyAutomationDraftCommandRequestSchema.parse({
    schemaVersion: 1,
    draftId: input.draftId,
    command: {
      ...envelope,
      kind: operation.tool.startsWith("create_")
        ? "org.vibeshape.feature.add"
        : "org.vibeshape.feature.update",
      payload: { feature },
    },
  })
}
