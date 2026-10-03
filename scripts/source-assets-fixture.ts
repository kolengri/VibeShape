import {
  applyDocumentV3Command,
  applyDocumentV4Command,
  pinnedAssemblyDefinitionSchema,
  readMeshImportFeatureParameters,
  sourceAssetSchema,
} from "../packages/domain/src/index"
import { assemblyLibraryFixture } from "./assembly-library-fixture"
import {
  authorityEnvelope,
  authorityFixture,
  authorityId,
  evidenceValue,
} from "./authority-persistence-fixture"

export async function sourceAssetsFixture() {
  const authored = authorityFixture()
  const textureUpgraded = evidenceValue(
    applyDocumentV3Command(authored.upgraded.snapshot, {
      ...authorityEnvelope(3),
      schemaVersion: 3,
      kind: "org.vibeshape.document.upgrade-v3",
      payload: { change: null },
    }),
  )
  const upgraded = evidenceValue(
    applyDocumentV4Command(textureUpgraded.snapshot, {
      ...authorityEnvelope(4),
      schemaVersion: 4,
      kind: "org.vibeshape.document.upgrade-v4",
      payload: {},
    }),
  )
  const bytes = Uint8Array.from(
    Array.from("Canonical source bytes retained by the document authority.", (character) =>
      character.charCodeAt(0),
    ),
  )
  const digest = "16e0ac29ebbbb2d4dd44bdcf638917b0d6208335e869e68418d30ba3b7cf96f1"
  const asset = sourceAssetSchema.parse({
    id: authorityId(600),
    digest,
    byteLength: bytes.byteLength,
    filename: "Source.step",
    format: "step",
    representation: "exact-solid",
    normalization: {
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    },
    outputs: [authorityId(601)],
  })
  const added = evidenceValue(
    applyDocumentV4Command(upgraded.snapshot, {
      ...authorityEnvelope(5),
      schemaVersion: 4,
      kind: "org.vibeshape.document.add-source-assets",
      payload: { assets: [asset] },
    }),
  )
  return { authored, textureUpgraded, upgraded, added, asset, blob: { digest, bytes } }
}

export function changedLibraryPinFixture() {
  const original = assemblyLibraryFixture()
  const bytes = new Uint8Array([1, 2, 4])
  const digest = "d4b29a968c40173638ded8d174c86957afa211be479cee020dba5dfe127d91ca"
  const asset = sourceAssetSchema.parse({
    ...original.asset,
    digest,
    filename: "Replacement library mesh.stl",
  })
  const pinned = original.definition.pinnedModels[0]
  const feature = pinned?.snapshot.features[0]
  const parameters = feature && readMeshImportFeatureParameters(feature)
  if (!pinned || !feature || !parameters)
    throw new Error("The historical library fixture requires one frozen mesh producer.")
  const definition = pinnedAssemblyDefinitionSchema.parse({
    ...original.definition,
    sources: [
      { kind: "asset-output", assetId: asset.id, outputId: asset.outputs[0], digest: asset.digest },
    ],
    pinnedModels: [
      {
        ...pinned,
        assets: [asset],
        snapshot: {
          ...pinned.snapshot,
          features: [
            {
              ...feature,
              parameters: { ...parameters, source: { ...parameters.source, digest } },
            },
          ],
        },
      },
    ],
  })
  return { original, definition, asset, blob: { digest, bytes } }
}
