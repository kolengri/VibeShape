import { expect, it } from "bun:test"
import {
  createImportTransaction,
  readImportSource,
} from "../apps/web/src/features/import/import-model"
import {
  inspectMeshSource,
  rebuildImportedMesh,
} from "../packages/document-worker/src/mesh-source-import"
import { readMeshImportFeatureParameters } from "../packages/domain/src/part-design-mesh-import"
import { writeStlMeshes } from "../packages/formats/src/stl-meshes"
import {
  type GeometryEngineMetadata,
  sourceAssetMaterializationSchema,
} from "../packages/protocol/src/index"
import { denseBoxMesh } from "../packages/structural-optimization/tests/dense-box-fixture"
import { authorityId } from "./authority-persistence-fixture"
import { sourceAssetsFixture } from "./source-assets-fixture"

const engine: GeometryEngineMetadata = {
  adapter: "replicad",
  adapterVersion: "test",
  replicadVersion: "0.23.1",
  opencascadePackageVersion: "0.23.0",
  opencascadeSourceRevision: null,
  wasmBytes: 1,
  initializedInMs: 0,
  featureContentEnvironment: {
    schemaVersion: 0,
    hostApiVersion: "0.1.0",
    geometry: {
      adapterId: "org.vibeshape.geometry.replicad",
      adapterVersion: "test",
      kernelId: "org.opencascade.occt",
      kernelVersion: "7.8.1",
      kernelSourceRevision: null,
    },
    modelingTolerancePolicyVersion: 1,
    provider: { kind: "built-in" },
  },
}

it("captures and rebuilds a closed generated mesh above the former serializer, parser and transfer thresholds", async () => {
  const mesh = denseBoxMesh({ subdivisions: 145, min: [-10, -10, -10], max: [10, 10, 10] })
  const bytes = writeStlMeshes([{ vertices: mesh.vertices, triangles: mesh.indices }])
  expect(new DataView(bytes.buffer).getUint32(80, true)).toBe(252_300)
  const prepared = await readImportSource(
    {
      name: "Generated candidate.stl",
      size: bytes.byteLength,
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    },
    "millimeter",
  )
  if (prepared.representation !== "triangle-mesh") throw new Error("Expected a mesh source.")
  const inspected = await inspectMeshSource(
    prepared.input.format,
    prepared.bytes,
    prepared.input.units,
  )
  const base = (await sourceAssetsFixture()).upgraded.snapshot
  let ordinal = 1_000
  const transaction = createImportTransaction(
    {
      documentId: base.id,
      revision: base.revision,
      authorityVersion: 4,
      historyAfter: null,
    },
    prepared,
    inspected,
    "Generated candidate",
    () => authorityId(ordinal++),
  )
  const assetCommand = transaction.commands.find(
    ({ kind }) => kind === "org.vibeshape.document.add-source-assets",
  )
  const featureCommand = transaction.commands.at(-1)
  if (
    assetCommand?.kind !== "org.vibeshape.document.add-source-assets" ||
    featureCommand?.kind !== "org.vibeshape.history.insert-feature"
  )
    throw new Error("The ordinary source import transaction is incomplete.")
  const parameters = readMeshImportFeatureParameters(featureCommand.payload.feature)
  if (!parameters) throw new Error("The imported feature has no captured mesh content.")
  const { sourceAssetId: _assetId, ...content } = parameters
  const materialization = sourceAssetMaterializationSchema.parse({
    asset: assetCommand.payload.assets[0],
    bytes: transaction.assetBlobs[0]?.bytes,
  })
  const rebuilt = await rebuildImportedMesh(content, materialization, engine)
  const first = inspected.outputs[0]
  if (!first) throw new Error("The source inspection has no geometry.")
  expect(rebuilt.mesh.indices.length / 3).toBe(252_300)
  expect(rebuilt.mesh.positions.length).toBe(2_270_700)
  expect(rebuilt.mesh.positions).toEqual(first.mesh.positions)
  expect(rebuilt.mesh.normals).toEqual(first.mesh.normals)
  expect(rebuilt.shape.bounds).toEqual({ min: [-10, -10, -10], max: [10, 10, 10] })
  expect(rebuilt.shape.surfaceArea).toBeCloseTo(2_400, 0)
  expect(rebuilt.representation).toBe("triangle-mesh")
  expect(rebuilt.shape.solidCount).toBe(0)
}, 30_000)
