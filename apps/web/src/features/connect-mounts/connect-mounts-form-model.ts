import {
  type DocumentDisplayUnits,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type VariableDefinition,
} from "@vibeshape/domain"
import {
  connectMountsFeatureParametersSchema,
  connectMountsFeatureType,
  readConnectMountsFeatureParameters,
} from "@vibeshape/domain/part-design-connect-mounts"
import { defaultLengthExpression } from "../../document/document-display-units"
import {
  type PrimitiveLengthCopy,
  parsePrimitiveLengthExpression,
} from "../part-design/primitive-form"

export type ConnectMountsFormMode =
  | { kind: "create"; createFeatureId: () => FeatureId; featureLabel: string }
  | { kind: "edit"; feature: FeatureRecord }

export type MountPointRow = { id: string; x: string; y: string; z: string }
export type ConnectMountsFormValues = {
  points: MountPointRow[]
  nodeRadius: string
  strutRadius: string
  connectionMode: "tree" | "complete"
}
export type ModelMountPoint = Readonly<{
  id: string
  label: string
  position: readonly [number, number, number]
}>

export function mountPointRow(
  id: string,
  position: readonly [number, number, number],
  unit: DocumentDisplayUnits["length"],
): MountPointRow {
  return {
    id,
    x: defaultLengthExpression(position[0], unit),
    y: defaultLengthExpression(position[1], unit),
    z: defaultLengthExpression(position[2], unit),
  }
}

export function initialConnectMountsValues(
  mode: ConnectMountsFormMode,
  unit: DocumentDisplayUnits["length"],
): ConnectMountsFormValues {
  const defaults = connectMountsFeatureParametersSchema.parse({
    points: [
      [0, 0, 0],
      [20, 0, 0],
    ],
    nodeRadius: 3,
    strutRadius: 1.5,
  })
  const saved = mode.kind === "edit" ? readConnectMountsFeatureParameters(mode.feature) : defaults
  if (!saved) throw new Error("Connect Mounts feature parameters are invalid.")
  return {
    points: saved.points.map((position, index) => mountPointRow(`point-${index}`, position, unit)),
    nodeRadius: defaultLengthExpression(saved.nodeRadius, unit),
    strutRadius: defaultLengthExpression(saved.strutRadius, unit),
    connectionMode: saved.connectionMode,
  }
}

function resolvedLength(
  value: string,
  variables: readonly VariableDefinition[],
  unit: DocumentDisplayUnits["length"],
  copy: PrimitiveLengthCopy,
) {
  return parsePrimitiveLengthExpression(
    value,
    variables,
    copy,
    (quantity) => Number.isFinite(quantity.value) && Math.abs(quantity.value) <= 100_000,
    unit,
  )
}

export function connectMountsFormCandidate(
  mode: ConnectMountsFormMode,
  featureId: FeatureId,
  values: ConnectMountsFormValues,
  variables: readonly VariableDefinition[],
  unit: DocumentDisplayUnits["length"],
  copy: PrimitiveLengthCopy,
) {
  const issues: Record<string, string> = {}
  const length = (value: string, path: string, positive: boolean) => {
    const parsed = resolvedLength(value, variables, unit, copy)
    if (!parsed.ok) {
      issues[path] = parsed.message
      return Number.NaN
    }
    if (positive && parsed.quantity.value < 0.001) issues[path] = copy.invalidRange
    return parsed.quantity.value
  }
  const points = values.points.map((point, index) =>
    (["x", "y", "z"] as const).map((axis) =>
      length(point[axis], `points[${index}].${axis}`, false),
    ),
  )
  const nodeRadius = length(values.nodeRadius, "nodeRadius", true)
  const strutRadius = length(values.strutRadius, "strutRadius", true)
  if (strutRadius > nodeRadius) issues.strutRadius = copy.invalidRange
  const parsed = connectMountsFeatureParametersSchema.safeParse({
    points,
    nodeRadius,
    strutRadius,
    connectionMode: values.connectionMode,
  })
  if (!parsed.success || Object.keys(issues).length > 0) return { feature: null, issues }
  const feature = featureRecordSchema.parse(
    mode.kind === "edit"
      ? { ...mode.feature, parameters: parsed.data }
      : {
          schemaVersion: 0,
          id: featureId,
          type: connectMountsFeatureType.type,
          label: mode.featureLabel,
          parameters: parsed.data,
          dependencies: [],
          references: [],
          suppressed: false,
        },
  )
  return { feature, issues }
}
