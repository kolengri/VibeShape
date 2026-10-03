// @vitest-environment node
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { expect, it, vi } from "vitest"
import {
  type FeatureGeometryEvaluationRequest,
  rebuildDocumentFeatures,
} from "../packages/application/src/feature-rebuild"
import { inspectAssemblyRuntime } from "../packages/document-worker/src/assembly-inspection"
import {
  boxFeatureType,
  captureAssemblyDefinition,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  documentCoreModule,
  documentSnapshotV4Schema,
  emptyAssemblyAuthority,
  featureCoreModule,
  partDesignFeatureTypeHandlers,
  partDesignModule,
  projectDocumentSnapshotV1ToV0,
  referenceGeometryFeatureTypeHandlers,
  referenceGeometryModule,
} from "../packages/domain/src/index"
import { ReplicadGeometryEngine } from "../packages/geometry-worker/src/engine"
import { inspectAssemblyInputSchema } from "../packages/protocol/src/assembly-inspection"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const pose = (x = 0) => ({ translation: [x, 0, 0], quaternion: [0, 0, 0, 1] })
async function digest(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value)
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
}

async function nativeAssemblyFixture() {
  const engine = new ReplicadGeometryEngine()
  const disposed = vi.spyOn(engine, "disposeDocument")
  const metadata = await engine.initialize()
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    partDesignModule,
    referenceGeometryModule,
  ])
  if (!modules.ok) throw new Error("Fixture module registry failed.")
  const types = createFeatureTypeRegistry(modules.registry, [
    ...partDesignFeatureTypeHandlers,
    ...referenceGeometryFeatureTypeHandlers,
  ])
  if (!types.ok) throw new Error("Fixture feature registry failed.")
  const document = documentSnapshotV4Schema.parse({
    schemaVersion: 4,
    surfaceTextures: [],
    id: id(1),
    revision: 3,
    name: "Pinned exact assembly",
    displayUnits: { length: "mm", angle: "deg" },
    variables: [],
    sketches: [],
    features: [
      {
        schemaVersion: 1,
        id: id(2),
        type: boxFeatureType.type,
        parameters: {
          width: createLengthQuantity(2),
          depth: createLengthQuantity(3),
          height: createLengthQuantity(4),
          centered: false,
          origin: {
            x: createLengthQuantity(0),
            y: createLengthQuantity(0),
            z: createLengthQuantity(0),
          },
        },
        dependencies: [],
        references: [],
        semanticInputs: [],
        suppressed: false,
      },
    ],
    history: [{ kind: "feature", id: id(2) }],
    parts: [
      {
        schemaVersion: 0,
        id: id(30),
        name: "Block",
        visible: true,
        origin: "independent",
        consumedBy: null,
        bodyHistory: [{ schemaVersion: 0, featureId: id(2), outputRole: "result" }],
      },
    ],
    folders: [],
    assets: [],
    assembly: emptyAssemblyAuthority(),
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
  })
  const {
    parts: _parts,
    folders: _folders,
    assets: _assets,
    assembly: _assembly,
    surfaceTextures: _textures,
    ...model
  } = document
  const projection = projectDocumentSnapshotV1ToV0({ ...model, schemaVersion: 1 })
  if (!projection.ok) throw new Error(projection.diagnostic.message)
  const mesh = { chordTolerance: 0.1, angularTolerance: 0.1 }
  let liveInput: FeatureGeometryEvaluationRequest | undefined
  const built = await rebuildDocumentFeatures({
    document: projection.snapshot,
    generation: 0,
    registry: types.registry,
    environment: metadata.featureContentEnvironment,
    mesh,
    hash: digest,
    evaluateGeometry: async (evaluation) => {
      liveInput = evaluation
      const result = await engine.evaluateFeature(
        { ...evaluation, dependencies: [...evaluation.dependencies] },
        () => {},
      )
      return result.ok
        ? { ok: true, geometry: result.result }
        : { ok: false, diagnosticCode: result.diagnostic.code }
    },
  })
  if (!built.ok || !built.geometry[0]) throw new Error("Fixture exact box failed to rebuild.")
  const definition = captureAssemblyDefinition(document, {
    schemaVersion: 1,
    id: id(50),
    name: "Pinned block",
    sources: [
      {
        kind: "part",
        partId: id(30),
        body: { schemaVersion: 0, featureId: id(2), outputRole: "result" },
        contentHash: built.geometry[0].contentHash,
      },
    ],
    sourceFrame: pose(),
  })
  const frozen = documentSnapshotV4Schema.parse({
    ...document,
    revision: 4,
    features: [],
    sketches: [],
    history: [],
    parts: [],
    assembly: {
      ...emptyAssemblyAuthority(),
      definitions: [definition],
      instances: [0, 1, 20].map((x, index) => ({
        schemaVersion: 1,
        id: id(60 + index),
        definitionId: id(50),
        name: `Occurrence ${index}`,
        grounded: true,
        worldFrame: pose(x),
      })),
    },
  })
  const input = inspectAssemblyInputSchema.parse({
    authorityJson: JSON.stringify(frozen),
    sourceAssets: [],
    mesh,
    interferencePairs: [
      { leftInstanceId: id(60), rightInstanceId: id(61) },
      { leftInstanceId: id(60), rightInstanceId: id(62) },
    ],
  })
  return {
    engine,
    disposed,
    document,
    types,
    baseBounds: built.geometry[0].geometry.shape.bounds,
    frozen,
    input,
    liveInput,
  }
}

it("rebuilds frozen exact assembly sources after their live Part is deleted and isolates native scopes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(await readFile(resolve(url.startsWith("/@fs/") ? url.slice(4) : `.${url}`))),
    ),
  )
  const { engine, disposed, document, types, baseBounds, frozen, input, liveInput } =
    await nativeAssemblyFixture()
  const inspection = await inspectAssemblyRuntime(engine, types.registry, null, input, {
    documentId: frozen.id,
    revision: 4,
    generation: 0,
  })
  expect(inspection.occurrences).toHaveLength(3)
  for (const [index, offset] of [0, 1, 20].entries())
    expect(inspection.occurrences[index]?.bounds.min[0]).toBeCloseTo(baseBounds.min[0] + offset, 8)
  expect(inspection.interference[0]?.volume).toBeCloseTo(12, 8)
  expect(inspection.interference.map(({ status }) => status)).toEqual(["interference", "clear"])
  expect(disposed.mock.calls).toHaveLength(1)
  expect(disposed.mock.calls[0]?.[0]).not.toBe(document.id)
  if (!liveInput) throw new Error("Fixture live geometry input was not recorded.")
  const live = await engine.evaluateFeature(
    { ...liveInput, dependencies: [...liveInput.dependencies] },
    () => {},
  )
  expect(live.ok && live.result.cache.brepHit).toBe(true)
  expect(live.ok && live.result.shape.volume).toBeCloseTo(24, 8)

  const forged = structuredClone(frozen)
  const source = forged.assembly.definitions[0]?.sources[0]
  if (source?.kind !== "part") throw new Error("Fixture source is unavailable.")
  source.contentHash = "f".repeat(64)
  await expect(
    inspectAssemblyRuntime(
      engine,
      types.registry,
      null,
      { ...input, authorityJson: JSON.stringify(forged) },
      { documentId: frozen.id, revision: 4, generation: 0 },
    ),
  ).rejects.toThrow(/hash|claim/i)
  expect(disposed.mock.calls).toHaveLength(2)
  await expect(
    inspectAssemblyRuntime(engine, types.registry, null, input, {
      documentId: frozen.id,
      revision: 5,
      generation: 0,
    }),
  ).rejects.toThrow(/stale/)
  engine.disposeDocument(document.id)
  vi.unstubAllGlobals()
}, 60_000)
