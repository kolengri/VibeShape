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
import { holeFeatureType, holeFeatureTypeV2, readHoleFeatureParameters } from "./part-design-hole"
import { importedFeatureType } from "./part-design-import"
import { loftFeatureType, readLoftFeatureParameters } from "./part-design-loft"
import { meshImportFeatureType } from "./part-design-mesh-import"
import { mirrorFeatureType } from "./part-design-mirror"
import { patternFeatureType } from "./part-design-pattern"
import { placementFeatureType } from "./part-design-placement"
import { shellFeatureType, shellFeatureTypeV2 } from "./part-design-shell"
import { splitFeatureType } from "./part-design-split"
import { readSweepFeatureParameters, sweepFeatureType } from "./part-design-sweep"
import { threadFeatureType } from "./part-design-thread"
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
    placementFeatureType,
    mirrorFeatureType,
    patternFeatureType,
    shellFeatureType,
    shellFeatureTypeV2,
    splitFeatureType,
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
    featureTypeKey(sweepFeatureType.type),
    (feature) => {
      const parameters = readSweepFeatureParameters(feature)
      return parameters ? [parameters.profile.sketchId, parameters.path.sketchId] : null
    },
  ],
])

export function projectFirstPartyFeatureSemanticInputs(
  feature: VersionedFeatureRecord,
): FirstPartySemanticInputProjection {
  const typeKey = featureTypeKey(feature.type)
  const readSketchSolidInputs = sketchSolidInputReaders.get(typeKey)
  if (readSketchSolidInputs) {
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
  if (
    typeKey === featureTypeKey(holeFeatureType.type) ||
    typeKey === featureTypeKey(holeFeatureTypeV2.type)
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
