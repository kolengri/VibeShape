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
  pyramidFeatureType,
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
import { importedBodyOutputRole, readImportedFeatureParameters } from "./part-design-import"
import { loftFeatureType } from "./part-design-loft"
import { meshImportOutputRole, readMeshImportFeatureParameters } from "./part-design-mesh-import"
import {
  mirrorPreservesSource,
  readMirrorFeatureParameters,
  readMirrorFeatureParametersV3,
} from "./part-design-mirror"
import {
  patternInstanceOutputRole,
  patternOutputRoles,
  readPatternFeatureParameters,
  readPatternFeatureParametersV2,
} from "./part-design-pattern"
import { readPlacementFeatureParameters } from "./part-design-placement"
import { readShellFeatureParameters } from "./part-design-shell"
import {
  readSplitFeatureParameters,
  readSplitFeatureParametersV2,
  SPLIT_NEGATIVE_OUTPUT_ROLE,
  SPLIT_POSITIVE_OUTPUT_ROLE,
} from "./part-design-split"
import { sweepFeatureType } from "./part-design-sweep"
import { readThreadFeatureParameters } from "./part-design-thread"

export type PartOperation =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "independent-outputs"; outputs: readonly BodyReference[] }>
  | Readonly<{ kind: "modify"; target: BodyReference; consumed: readonly BodyReference[] }>
  | Readonly<{
      kind: "fan-out"
      target: BodyReference
      continuation: BodyReference
      createdOutputs: readonly BodyReference[]
      /** Eligible ordered roots are retained only when their identities were already captured. */
      retainableCreatedOutputs?: readonly BodyReference[]
    }>
  | Readonly<{
      kind: "compound"
      entries: readonly Readonly<{ target: BodyReference; output: BodyReference }>[]
    }>
  | Readonly<{ kind: "unmanaged" }>

const newTypes = new Set(
  [
    boxFeatureType,
    cylinderFeatureType,
    loftFeatureType,
    sweepFeatureType,
    sphereFeatureType,
    coneFeatureType,
    torusFeatureType,
    pyramidFeatureType,
  ].map((descriptor) => featureTypeKey(descriptor.type)),
)
const modifierTypes = new Set(
  [filletFeatureType, filletFeatureTypeV2, chamferFeatureType, chamferFeatureTypeV2].map(
    (descriptor) => featureTypeKey(descriptor.type),
  ),
)

export function featureResultBody(feature: Pick<FeatureRecord, "id">): BodyReference {
  return { schemaVersion: 0, featureId: feature.id, outputRole: "result" }
}

function classifyFanOutOperation(
  feature: FeatureRecordV1,
  resolvedPatternCount?: number,
): PartOperation | null {
  const pattern = readPatternFeatureParameters(feature) ?? readPatternFeatureParametersV2(feature)
  if (pattern) {
    const count =
      resolvedPatternCount ??
      (pattern.count.source.expression === null ? pattern.count.value : null)
    if (count === null) return { kind: "unmanaged" }
    const output = (outputRole: string): BodyReference => ({
      schemaVersion: 0,
      featureId: feature.id,
      outputRole,
    })
    return {
      kind: "fan-out",
      target: pattern.targetBody,
      continuation: output(patternInstanceOutputRole(0)),
      createdOutputs: patternOutputRoles(count).slice(1).map(output),
      retainableCreatedOutputs: patternOutputRoles(256).slice(1).map(output),
    }
  }
  const split = readSplitFeatureParameters(feature) ?? readSplitFeatureParametersV2(feature)
  if (split)
    return {
      kind: "fan-out",
      target: split.targetBody,
      continuation: {
        schemaVersion: 0,
        featureId: feature.id,
        outputRole: SPLIT_NEGATIVE_OUTPUT_ROLE,
      },
      createdOutputs: [
        { schemaVersion: 0, featureId: feature.id, outputRole: SPLIT_POSITIVE_OUTPUT_ROLE },
      ],
    }
  return null
}

function classifyBodySelectionOperation(feature: FeatureRecordV1): PartOperation | null {
  const thread = readThreadFeatureParameters(feature)
  if (thread) return { kind: "modify", target: thread.targetBody, consumed: [] }
  const placement = readPlacementFeatureParameters(feature)
  const mirror = classifyMirrorOperation(feature)
  const shell = readShellFeatureParameters(feature)
  if (shell) return { kind: "modify", target: shell.targetBody, consumed: [] }
  if (mirror) return mirror
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
  return null
}

function classifyMirrorOperation(feature: FeatureRecordV1): PartOperation | null {
  const mirror = readMirrorFeatureParameters(feature) ?? readMirrorFeatureParametersV3(feature)
  if (!mirror) return null
  return mirrorPreservesSource(feature)
    ? { kind: "new" }
    : { kind: "modify", target: mirror.targetBody, consumed: [] }
}

/** Exact first-party type identity owns this policy; unknown/aggregate outputs are not inferred. */
export function classifyPartOperation(
  feature: FeatureRecordV1,
  resolvedPatternCount?: number,
): PartOperation {
  const meshImport = readMeshImportFeatureParameters(feature)
  if (meshImport)
    return {
      kind: "independent-outputs",
      outputs: meshImport.outputs.map(({ outputId }) => ({
        schemaVersion: 0,
        featureId: feature.id,
        outputRole: meshImportOutputRole(outputId),
      })),
    }
  const imported = readImportedFeatureParameters(feature)
  if (imported)
    return {
      kind: "independent-outputs",
      outputs: imported.outputs.map(({ outputId }) => ({
        schemaVersion: 0,
        featureId: feature.id,
        outputRole: importedBodyOutputRole(outputId),
      })),
    }
  const typeKey = featureTypeKey(feature.type)
  const fanOut = classifyFanOutOperation(feature, resolvedPatternCount)
  if (fanOut) return fanOut
  const bodySelection = classifyBodySelectionOperation(feature)
  if (bodySelection) return bodySelection
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
