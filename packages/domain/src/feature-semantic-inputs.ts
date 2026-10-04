import type { DocumentNodeRef } from "./document-node"
import type { FeatureRecord, FeatureRecordV1 } from "./feature-graph"
import { featureTypeKey } from "./feature-type-contracts"
import type { SketchId } from "./identifiers"
import {
  booleanFeatureType,
  boxFeatureType,
  chamferFeatureType,
  chamferFeatureTypeV2,
  coneFeatureType,
  cylinderFeatureType,
  extrusionFeatureType,
  extrusionFeatureTypeV3,
  extrusionFeatureTypeV4,
  extrusionFeatureTypeV5,
  extrusionFeatureTypeV6,
  filletFeatureType,
  filletFeatureTypeV2,
  legacyExtrusionFeatureType,
  legacyRevolveFeatureType,
  legacyRevolveFeatureTypeV2,
  legacyRevolveFeatureTypeV3,
  pyramidFeatureType,
  readExtrusionFeatureParameters,
  readRevolveFeatureParameters,
  revolveFeatureType,
  revolveFeatureTypeV5,
  revolveFeatureTypeV6,
  sphereFeatureType,
  torusFeatureType,
} from "./part-design"
import {
  compoundFeatureType,
  compoundFeatureTypeV2,
  unionFeatureType,
  unionFeatureTypeV2,
} from "./part-design-body-combination"
import {
  holeFeatureType,
  holeFeatureTypeV2,
  holeFeatureTypeV3,
  readHoleFeatureParameters,
} from "./part-design-hole"
import { importedFeatureType } from "./part-design-import"
import { loftFeatureType, loftFeatureTypeV2, readLoftFeatureParameters } from "./part-design-loft"
import {
  loftFeatureTypeV3,
  loftV3SketchIds,
  loftV3SupportBodies,
  readLoftFeatureParametersV3,
} from "./part-design-loft-v3"
import { meshImportFeatureType } from "./part-design-mesh-import"
import { mirrorFeatureType, mirrorFeatureTypeV2, mirrorFeatureTypeV3 } from "./part-design-mirror"
import { patternFeatureType, patternFeatureTypeV2 } from "./part-design-pattern"
import { placementFeatureType } from "./part-design-placement"
import { shellFeatureType, shellFeatureTypeV2 } from "./part-design-shell"
import { splitFeatureType, splitFeatureTypeV2 } from "./part-design-split"
import { readSweepFeatureParameters, sweepFeatureType } from "./part-design-sweep"
import { threadFeatureType, threadFeatureTypeV2 } from "./part-design-thread"
import { datumPlaneFeatureType } from "./reference-geometry"

type VersionedFeatureRecord = FeatureRecord | FeatureRecordV1

export type FirstPartySemanticInputProjection =
  | Readonly<{ recognized: false }>
  | Readonly<{ recognized: true; ok: false; message: string }>
  | Readonly<{ recognized: true; ok: true; inputs: readonly DocumentNodeRef[] }>

const emptySemanticInputTypeKeys = new Set(
  [
    boxFeatureType,
    importedFeatureType,
    meshImportFeatureType,
    threadFeatureType,
    threadFeatureTypeV2,
    placementFeatureType,
    mirrorFeatureType,
    mirrorFeatureTypeV2,
    mirrorFeatureTypeV3,
    patternFeatureType,
    patternFeatureTypeV2,
    shellFeatureType,
    shellFeatureTypeV2,
    splitFeatureType,
    splitFeatureTypeV2,
    compoundFeatureType,
    compoundFeatureTypeV2,
    unionFeatureType,
    unionFeatureTypeV2,
    cylinderFeatureType,
    sphereFeatureType,
    coneFeatureType,
    pyramidFeatureType,
    torusFeatureType,
    booleanFeatureType,
    datumPlaneFeatureType,
    filletFeatureType,
    chamferFeatureType,
    filletFeatureTypeV2,
    chamferFeatureTypeV2,
  ].map((feature) => featureTypeKey(feature.type)),
)

const extrusionTypeKeys = new Set([
  featureTypeKey(extrusionFeatureType.type),
  featureTypeKey(legacyExtrusionFeatureType.type),
  featureTypeKey(extrusionFeatureTypeV3.type),
  featureTypeKey(extrusionFeatureTypeV4.type),
  featureTypeKey(extrusionFeatureTypeV5.type),
  featureTypeKey(extrusionFeatureTypeV6.type),
])
const revolveTypeKeys = new Set([
  featureTypeKey(revolveFeatureType.type),
  featureTypeKey(legacyRevolveFeatureType.type),
  featureTypeKey(legacyRevolveFeatureTypeV2.type),
  featureTypeKey(legacyRevolveFeatureTypeV3.type),
  featureTypeKey(revolveFeatureTypeV5.type),
  featureTypeKey(revolveFeatureTypeV6.type),
])

const sketchSolidInputReaders = new Map<
  string,
  (feature: VersionedFeatureRecord) => readonly SketchId[] | null
>([
  [
    featureTypeKey(loftFeatureType.type),
    (feature) =>
      readLoftFeatureParameters(feature)?.sections.map(({ sketchId }) => sketchId) ?? null,
  ],
  [
    featureTypeKey(loftFeatureTypeV2.type),
    (feature) =>
      readLoftFeatureParameters(feature)?.sections.map(({ sketchId }) => sketchId) ?? null,
  ],
  [
    featureTypeKey(sweepFeatureType.type),
    (feature) => {
      const parameters = readSweepFeatureParameters(feature)
      return parameters ? [parameters.profile.sketchId, parameters.path.sketchId] : null
    },
  ],
])

function constrainedLoftSemanticInputs(
  feature: VersionedFeatureRecord,
): FirstPartySemanticInputProjection {
  const parameters = readLoftFeatureParametersV3(feature)
  return parameters
    ? {
        recognized: true,
        ok: true,
        inputs: [
          ...loftV3SketchIds(parameters).map((id) => ({ kind: "sketch" as const, id })),
          ...loftV3SupportBodies(parameters).map(({ featureId }) => ({
            kind: "feature" as const,
            id: featureId,
          })),
        ],
      }
    : {
        recognized: true,
        ok: false,
        message: "A constrained Loft requires complete authored correspondence.",
      }
}

function sketchSolidSemanticInputs(
  feature: VersionedFeatureRecord,
  readSketchSolidInputs: (feature: VersionedFeatureRecord) => readonly SketchId[] | null,
): FirstPartySemanticInputProjection {
  const sketchIds = readSketchSolidInputs(feature)
  return sketchIds
    ? {
        recognized: true,
        ok: true,
        inputs: [...new Set(sketchIds)].map((id) => ({ kind: "sketch", id })),
      }
    : {
        recognized: true,
        ok: false,
        message: "A sketch-based solid must contain valid ordered sketch selectors.",
      }
}

export function projectFirstPartyFeatureSemanticInputs(
  feature: VersionedFeatureRecord,
): FirstPartySemanticInputProjection {
  const typeKey = featureTypeKey(feature.type)
  if (typeKey === featureTypeKey(loftFeatureTypeV3.type))
    return constrainedLoftSemanticInputs(feature)

  const readSketchSolidInputs = sketchSolidInputReaders.get(typeKey)
  if (readSketchSolidInputs) {
    return sketchSolidSemanticInputs(feature, readSketchSolidInputs)
  }
  if (
    typeKey === featureTypeKey(holeFeatureType.type) ||
    typeKey === featureTypeKey(holeFeatureTypeV2.type) ||
    typeKey === featureTypeKey(holeFeatureTypeV3.type)
  ) {
    const parameters = readHoleFeatureParameters(feature)
    return parameters
      ? { recognized: true, ok: true, inputs: [{ kind: "sketch", id: parameters.sketchId }] }
      : { recognized: true, ok: false, message: "A hole must contain valid sketch point intent." }
  }
  if (emptySemanticInputTypeKeys.has(typeKey)) return { recognized: true, ok: true, inputs: [] }
  if (extrusionTypeKeys.has(typeKey)) {
    const parameters = readExtrusionFeatureParameters(feature as FeatureRecord)
    return parameters
      ? {
          recognized: true,
          ok: true,
          inputs: [{ kind: "sketch", id: parameters.profile.sketchId }],
        }
      : {
          recognized: true,
          ok: false,
          message: "A first-party extrusion must contain a valid profile selector.",
        }
  }
  if (!revolveTypeKeys.has(typeKey)) return { recognized: false }
  const parameters = readRevolveFeatureParameters(feature as FeatureRecord)
  return parameters
    ? {
        recognized: true,
        ok: true,
        inputs: [
          { kind: "sketch" as const, id: parameters.profile.sketchId },
          ...(parameters.axis.kind === "model-edge"
            ? [{ kind: "feature" as const, id: parameters.axis.reference.featureId }]
            : []),
        ],
      }
    : {
        recognized: true,
        ok: false,
        message: "A first-party revolve must contain a valid profile selector.",
      }
}
