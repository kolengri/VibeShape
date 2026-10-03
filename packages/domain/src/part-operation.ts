import type { BodyReference } from "./body-reference"
import { featureBodyDependencyIds } from "./feature-dependencies"
import type { FeatureRecord, FeatureRecordV1 } from "./feature-graph"
import { featureTypeKey } from "./feature-type-contracts"
import {
  booleanFeatureType,
  boxFeatureType,
  chamferFeatureType,
  chamferFeatureTypeV2,
  coneFeatureType,
  cylinderFeatureType,
  filletFeatureType,
  filletFeatureTypeV2,
  readExtrusionFeatureParameters,
  readRevolveFeatureParameters,
  sphereFeatureType,
  torusFeatureType,
} from "./part-design"
import {
  compoundBodyOutputRole,
  readCompoundFeatureParameters,
  readUnionFeatureParameters,
} from "./part-design-body-combination"
import { readHoleBodyTarget, readHoleFeatureParameters } from "./part-design-hole"
import { readPlacementFeatureParameters } from "./part-design-placement"

export type PartOperation =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "modify"; target: BodyReference; consumed: readonly BodyReference[] }>
  | Readonly<{
      kind: "compound"
      entries: readonly Readonly<{ target: BodyReference; output: BodyReference }>[]
    }>
  | Readonly<{ kind: "unmanaged" }>

const newTypes = new Set(
  [boxFeatureType, cylinderFeatureType, sphereFeatureType, coneFeatureType, torusFeatureType].map(
    (descriptor) => featureTypeKey(descriptor.type),
  ),
)
const modifierTypes = new Set(
  [filletFeatureType, filletFeatureTypeV2, chamferFeatureType, chamferFeatureTypeV2].map(
    (descriptor) => featureTypeKey(descriptor.type),
  ),
)

export function featureResultBody(feature: Pick<FeatureRecord, "id">): BodyReference {
  return { schemaVersion: 0, featureId: feature.id, outputRole: "result" }
}

/** Exact first-party type identity owns this policy; unknown/aggregate outputs are not inferred. */
export function classifyPartOperation(feature: FeatureRecordV1): PartOperation {
  const typeKey = featureTypeKey(feature.type)
  const placement = readPlacementFeatureParameters(feature)
  if (placement) return { kind: "modify", target: placement.targetBody, consumed: [] }
  const compound = readCompoundFeatureParameters(feature)
  if (compound)
    return {
      kind: "compound",
      entries: compound.slots.map(({ slotId, targetBody }) => ({
        target: targetBody,
        output: {
          schemaVersion: 0,
          featureId: feature.id,
          outputRole: compoundBodyOutputRole(slotId),
        },
      })),
    }
  const union = readUnionFeatureParameters(feature)
  const unionTarget = union?.bodies[0]
  if (union && unionTarget)
    return { kind: "modify", target: unionTarget, consumed: union.bodies.slice(1) }
  if (newTypes.has(typeKey)) return { kind: "new" }
  const legacy: FeatureRecord = { ...feature, schemaVersion: 0 }
  const profile = readExtrusionFeatureParameters(legacy) ?? readRevolveFeatureParameters(legacy)
  if (profile?.operation === "new")
    return (profile.profiles?.profiles.length ?? 1) === 1 ? { kind: "new" } : { kind: "unmanaged" }
  const hole = readHoleFeatureParameters(feature)
  const isBoolean = typeKey === featureTypeKey(booleanFeatureType.type)
  if (!profile && !hole && !isBoolean && !modifierTypes.has(typeKey)) return { kind: "unmanaged" }
  const targetId = feature.dependencies[0]
  if (!targetId) return { kind: "unmanaged" }
  const target = readHoleBodyTarget(legacy) ?? featureResultBody({ id: targetId })
  return {
    kind: "modify",
    target,
    consumed: isBoolean
      ? featureBodyDependencyIds(legacy)
          .slice(1)
          .map((id) => featureResultBody({ id }))
      : [],
  }
}

export function sameBodyReference(left: BodyReference, right: BodyReference): boolean {
  return left.featureId === right.featureId && left.outputRole === right.outputRole
}
