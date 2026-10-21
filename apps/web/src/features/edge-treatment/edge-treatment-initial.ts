import {
  type BodyReference,
  chamferFeatureParametersSchema,
  type DocumentDisplayUnits,
  edgeTopoRefSchema,
  type FeatureRecord,
  filletFeatureParametersSchema,
  type LengthQuantity,
} from "@vibeshape/domain"
import {
  type ChamferFeatureParametersV3,
  readChamferFeatureParametersV3,
} from "@vibeshape/domain/part-design"
import { defaultLengthExpression } from "../../document/document-display-units"
import { quantityExpression } from "../part-design/primitive-form"
import { readEdgeTreatmentPreselection } from "./edge-treatment-activation"
import { legacyEdgeReference } from "./edge-treatment-candidates"
import type { EdgeTreatmentFormMode, EdgeTreatmentOperation } from "./edge-treatment-form"
import type { TreatmentValues } from "./edge-treatment-model"
import { type EdgeTreatmentTargetOption, edgeTreatmentOptionOwner } from "./edge-treatment-options"

function exactTarget(options: readonly EdgeTreatmentTargetOption[], exact: BodyReference) {
  return (
    options.find(
      ({ body }) => body?.featureId === exact.featureId && body.outputRole === exact.outputRole,
    )?.id ?? ""
  )
}

function initialTarget(
  options: readonly EdgeTreatmentTargetOption[],
  selected: string | null | undefined,
  exact?: BodyReference,
) {
  if (exact) return exactTarget(options, exact)
  if (selected === undefined) return options[0]?.id ?? ""
  const eligible = options.filter((option) => edgeTreatmentOptionOwner(option) === selected)
  return eligible.length === 1 ? (eligible[0]?.id ?? "") : ""
}

function defaultValues(unit: DocumentDisplayUnits["length"]): TreatmentValues {
  return {
    distance: defaultLengthExpression(1, unit),
    targetFeatureId: "",
    scope: "selected",
    references: [],
    targets: [],
    retainV3: false,
    mode: "equal-distance",
    secondDistance: defaultLengthExpression(2, unit),
    angle: "45 deg",
    measurement: "offset",
    flip: false,
    tangentPropagation: false,
    directionOverrides: [],
  }
}

function legacyDistance(feature: FeatureRecord, operation: EdgeTreatmentOperation): LengthQuantity {
  return operation === "fillet"
    ? filletFeatureParametersSchema.parse(feature.parameters).radius
    : chamferFeatureParametersSchema.parse(feature.parameters).distance
}

function v3Values(
  parameters: ChamferFeatureParametersV3,
  options: readonly EdgeTreatmentTargetOption[],
  defaults: TreatmentValues,
): TreatmentValues {
  const { targetBody, distance, secondDistance, angle, ...controls } = parameters
  return {
    ...defaults,
    ...controls,
    retainV3: true,
    targetFeatureId: initialTarget(options, targetBody.featureId, targetBody),
    distance: quantityExpression(distance),
    secondDistance: secondDistance ? quantityExpression(secondDistance) : defaults.secondDistance,
    angle: angle
      ? (angle.source.expression ?? `${angle.source.value} ${angle.source.unit}`)
      : defaults.angle,
  }
}

function editedValues(
  feature: FeatureRecord,
  operation: EdgeTreatmentOperation,
  options: readonly EdgeTreatmentTargetOption[],
  defaults: TreatmentValues,
): TreatmentValues {
  const v3 = readChamferFeatureParametersV3(feature)
  if (v3) return v3Values(v3, options, defaults)
  return {
    ...defaults,
    distance: quantityExpression(legacyDistance(feature, operation)),
    targetFeatureId: initialTarget(options, feature.dependencies[0]),
    scope: feature.type.schemaVersion === 1 ? "all" : "selected",
    references: feature.references.flatMap((ref) =>
      ref.kind === "edge" ? [edgeTopoRefSchema.parse(ref)] : [],
    ),
  }
}

export function initialTreatmentValues(
  mode: EdgeTreatmentFormMode,
  operation: EdgeTreatmentOperation,
  options: readonly EdgeTreatmentTargetOption[],
  unit: DocumentDisplayUnits["length"],
): TreatmentValues {
  const defaults = defaultValues(unit)
  if (mode.kind === "edit") return editedValues(mode.feature, operation, options, defaults)
  const preselection = readEdgeTreatmentPreselection(mode.edgeSelection)
  if (!preselection)
    return { ...defaults, targetFeatureId: initialTarget(options, mode.targetFeatureId) }
  return {
    ...defaults,
    targetFeatureId: initialTarget(
      options,
      preselection.targetBody.featureId,
      preselection.targetBody,
    ),
    references: preselection.edges.flatMap((edge) => {
      const ref = legacyEdgeReference(edge)
      return ref ? [ref] : []
    }),
    targets: preselection.edges.map((edge) => ({ kind: "edge", edge })),
  }
}
