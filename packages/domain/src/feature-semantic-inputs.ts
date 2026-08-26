import type { DocumentNodeRef } from "./document-node"
import type { FeatureRecord, FeatureRecordV1 } from "./feature-graph"
import { featureTypeKey } from "./feature-type-contracts"
import {
  booleanFeatureType,
  boxFeatureType,
  cylinderFeatureType,
  extrusionFeatureType,
  legacyExtrusionFeatureType,
  readExtrusionFeatureParameters,
} from "./part-design"
import { datumPlaneFeatureType } from "./reference-geometry"

type VersionedFeatureRecord = FeatureRecord | FeatureRecordV1

export type FirstPartySemanticInputProjection =
  | Readonly<{ recognized: false }>
  | Readonly<{ recognized: true; ok: false; message: string }>
  | Readonly<{ recognized: true; ok: true; inputs: readonly DocumentNodeRef[] }>

const emptySemanticInputTypeKeys = new Set(
  [boxFeatureType, cylinderFeatureType, booleanFeatureType, datumPlaneFeatureType].map((feature) =>
    featureTypeKey(feature.type),
  ),
)

const extrusionTypeKeys = new Set([
  featureTypeKey(extrusionFeatureType.type),
  featureTypeKey(legacyExtrusionFeatureType.type),
])

export function projectFirstPartyFeatureSemanticInputs(
  feature: VersionedFeatureRecord,
): FirstPartySemanticInputProjection {
  const typeKey = featureTypeKey(feature.type)
  if (emptySemanticInputTypeKeys.has(typeKey)) return { recognized: true, ok: true, inputs: [] }
  if (!extrusionTypeKeys.has(typeKey)) return { recognized: false }
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
