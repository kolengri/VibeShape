import {
  captureAssemblyDefinition,
  documentSnapshotV4Schema,
  emptyAssemblyAuthority,
  meshImportFeatureType,
  meshImportOutputRole,
  sourceAssetSchema,
} from "../packages/domain/src/index"

export const libraryFixtureId = (n: number) =>
  `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
export const libraryFixtureTimestamp = "2026-10-03T00:00:00Z"

export function assemblyLibraryFixture() {
  const bytes = new Uint8Array([1, 2, 3])
  const asset = sourceAssetSchema.parse({
    id: libraryFixtureId(80),
    digest: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    byteLength: bytes.byteLength,
    filename: "Library mesh.stl",
    format: "stl",
    representation: "triangle-mesh",
    normalization: {
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    },
    outputs: [libraryFixtureId(81)],
  })
  const body = {
    schemaVersion: 0,
    featureId: libraryFixtureId(2),
    outputRole: meshImportOutputRole(asset.outputs[0] ?? ""),
  }
  const document = documentSnapshotV4Schema.parse({
    schemaVersion: 4,
    surfaceTextures: [],
    id: libraryFixtureId(1),
    revision: 3,
    name: "Library source document",
    displayUnits: { length: "mm", angle: "deg" },
    variables: [],
    features: [
      {
        schemaVersion: 1,
        id: body.featureId,
        type: meshImportFeatureType.type,
        parameters: {
          sourceAssetId: asset.id,
          source: {
            digest: asset.digest,
            byteLength: asset.byteLength,
            format: "stl",
            normalization: asset.normalization,
            parserPolicyVersion: 1,
          },
          outputs: [{ outputId: asset.outputs[0], nodeKey: "stl.mesh" }],
        },
        dependencies: [],
        references: [],
        semanticInputs: [],
        suppressed: false,
      },
    ],
    sketches: [],
    history: [{ kind: "feature", id: body.featureId }],
    parts: [
      {
        schemaVersion: 0,
        id: libraryFixtureId(30),
        name: "Imported mesh",
        visible: true,
        origin: "independent",
        consumedBy: null,
        bodyHistory: [body],
      },
    ],
    folders: [],
    assets: [asset],
    assembly: emptyAssemblyAuthority(),
    createdAt: libraryFixtureTimestamp,
    updatedAt: libraryFixtureTimestamp,
  })
  const definition = captureAssemblyDefinition(document, {
    schemaVersion: 1,
    id: libraryFixtureId(50),
    name: "Frozen source",
    sources: [
      { kind: "asset-output", assetId: asset.id, outputId: asset.outputs[0], digest: asset.digest },
    ],
    sourceFrame: { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] },
  })
  return { document, definition, asset, blob: { digest: asset.digest, bytes } }
}
