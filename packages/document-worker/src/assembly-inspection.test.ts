import { materializeAssembly } from "@vibeshape/application/assembly-materialization"
import { rebuildDocumentFeatures } from "@vibeshape/application/feature-rebuild"
import {
  createFeatureTypeRegistry,
  createModuleRegistry,
  documentSnapshotSchema,
  documentSnapshotV1Schema,
  documentSnapshotV3Schema,
  documentSnapshotV4Schema,
} from "@vibeshape/domain"
import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import { type GeometryEngineMetadata, inspectAssemblyInputSchema } from "@vibeshape/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { withMaterializedAssemblyRuntime } from "./assembly-inspection"

vi.mock("@vibeshape/application/assembly-materialization", () => ({ materializeAssembly: vi.fn() }))
vi.mock("@vibeshape/application/feature-rebuild", () => ({ rebuildDocumentFeatures: vi.fn() }))

const document = documentSnapshotV4Schema.parse({
  schemaVersion: 4,
  id: "0195b5ac-b220-7a2c-8c33-000000000001",
  revision: 4,
  name: "Disposable assembly lifecycle",
  displayUnits: { length: "mm", angle: "deg" },
  features: [],
  sketches: [],
  history: [],
  variables: [],
  parts: [],
  folders: [],
  surfaceTextures: [],
  assets: [],
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T00:00:00Z",
})
const {
  parts: _parts,
  folders: _folders,
  assets: _assets,
  assembly: _assembly,
  surfaceTextures: _surfaceTextures,
  ...model
} = document
const snapshot = documentSnapshotV1Schema.parse({ ...model, schemaVersion: 1 })
const input = inspectAssemblyInputSchema.parse({
  authorityJson: JSON.stringify(document),
  sourceAssets: [],
  interferencePairs: [],
  mesh: { chordTolerance: 0.1, angularTolerance: 0.1 },
})
const identity = { documentId: document.id, revision: document.revision, generation: 0 }
const metadata: GeometryEngineMetadata = {
  adapter: "replicad",
  adapterVersion: "assembly-lifecycle-test",
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
      adapterVersion: "assembly-lifecycle-test",
      kernelId: "org.opencascade.occt",
      kernelVersion: "7.9.2",
      kernelSourceRevision: null,
    },
    modelingTolerancePolicyVersion: 1,
    provider: { kind: "built-in" },
  },
}
function fixture() {
  const engine = new ReplicadGeometryEngine()
  vi.spyOn(engine, "initialize").mockResolvedValue(metadata)
  const disposed = vi.spyOn(engine, "disposeDocument").mockImplementation(() => 0)
  const modules = createModuleRegistry([])
  if (!modules.ok) throw new Error("Test module registry failed.")
  const registry = createFeatureTypeRegistry(modules.registry, [])
  if (!registry.ok) throw new Error("Test feature registry failed.")
  return { engine, disposed, registry: registry.registry }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(rebuildDocumentFeatures).mockImplementation(async ({ document: value, generation }) => {
    const derived = documentSnapshotSchema.parse(value)
    return {
      ok: true,
      documentId: derived.id,
      revision: derived.revision,
      generation,
      features: [],
      geometry: [],
      environment: metadata.featureContentEnvironment,
      mesh: input.mesh,
      evaluation: {
        records: [],
        dirtyFeatureIds: [],
        evaluatedFeatureIds: [],
        reusedFeatureIds: [],
      },
    }
  })
  vi.mocked(materializeAssembly).mockImplementation(async (options) => {
    const first = await options.rebuildPinnedModel(snapshot, [])
    const second = await options.rebuildPinnedModel(snapshot, [])
    expect(first.documentId).toBe(snapshot.id)
    expect(second.documentId).toBe(snapshot.id)
    return { ok: true, documentId: document.id, revision: document.revision, occurrences: [] }
  })
})

describe("disposable assembly runtime ownership", () => {
  it("rejects published texture V3 authority before initializing a source or assembly runtime", async () => {
    const { assets: _assets, assembly: _assembly, ...published } = document
    const textureAuthority = documentSnapshotV3Schema.parse({ ...published, schemaVersion: 3 })
    const { engine, disposed, registry } = fixture()
    const action = vi.fn()
    await expect(
      withMaterializedAssemblyRuntime(
        engine,
        registry,
        null,
        { ...input, authorityJson: JSON.stringify(textureAuthority) },
        identity,
        action,
      ),
    ).rejects.toThrow()
    expect(engine.initialize).not.toHaveBeenCalled()
    expect(disposed).not.toHaveBeenCalled()
    expect(materializeAssembly).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })
  it("returns null only after disposing every distinct derived alias", async () => {
    const { engine, disposed, registry } = fixture()
    const result = await withMaterializedAssemblyRuntime(
      engine,
      registry,
      null,
      input,
      identity,
      () => {
        expect(disposed).not.toHaveBeenCalled()
        return null
      },
    )
    expect(result).toBeNull()
    const aliases = disposed.mock.calls.map(([alias]) => alias)
    expect(aliases).toHaveLength(2)
    expect(new Set(aliases).size).toBe(2)
    expect(aliases).not.toContain(document.id)
    const rebuildIds = vi
      .mocked(rebuildDocumentFeatures)
      .mock.calls.map(([value]) => documentSnapshotSchema.parse(value.document).id)
    expect(aliases).toEqual(rebuildIds)
  })
  it("disposes every alias and preserves the original asynchronous action failure", async () => {
    const { engine, disposed, registry } = fixture()
    const failure = new Error("Export writer failed.")
    await expect(
      withMaterializedAssemblyRuntime(engine, registry, null, input, identity, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(disposed).toHaveBeenCalledTimes(2)
  })
  it("attempts all cleanup and reports both operation and disposal failures", async () => {
    const { engine, disposed, registry } = fixture()
    const failure = new Error("Export writer failed.")
    const cleanup = new Error("Native scope cleanup failed.")
    disposed.mockImplementationOnce(() => {
      throw cleanup
    })
    const operation = withMaterializedAssemblyRuntime(
      engine,
      registry,
      null,
      input,
      identity,
      () => {
        throw failure
      },
    )
    await expect(operation).rejects.toMatchObject({ errors: [failure, cleanup] })
    expect(disposed).toHaveBeenCalledTimes(2)
  })
  it("rejects a failed disposal instead of publishing an otherwise successful file", async () => {
    const { engine, disposed, registry } = fixture()
    const cleanup = new Error("Native scope cleanup failed.")
    disposed.mockImplementationOnce(() => {
      throw cleanup
    })
    await expect(
      withMaterializedAssemblyRuntime(
        engine,
        registry,
        null,
        input,
        identity,
        () => new Uint8Array([1]),
      ),
    ).rejects.toMatchObject({ errors: [cleanup] })
    expect(disposed).toHaveBeenCalledTimes(2)
  })
  it("disposes a partially rebuilt alias when materialization fails before the action", async () => {
    const { engine, disposed, registry } = fixture()
    vi.mocked(materializeAssembly).mockImplementationOnce(async (options) => {
      await options.rebuildPinnedModel(snapshot, [])
      return {
        ok: false,
        code: "pinned-content-hash-mismatch",
        message: "Frozen hash proof failed.",
      }
    })
    const action = vi.fn()
    await expect(
      withMaterializedAssemblyRuntime(engine, registry, null, input, identity, action),
    ).rejects.toThrow(/Frozen hash proof/)
    expect(action).not.toHaveBeenCalled()
    expect(disposed).toHaveBeenCalledTimes(1)
  })
  it("rejects stale authority before initializing or allocating native contexts", async () => {
    const { engine, disposed, registry } = fixture()
    await expect(
      withMaterializedAssemblyRuntime(
        engine,
        registry,
        null,
        input,
        { ...identity, revision: identity.revision + 1 },
        () => null,
      ),
    ).rejects.toThrow(/stale/)
    expect(engine.initialize).not.toHaveBeenCalled()
    expect(disposed).not.toHaveBeenCalled()
    expect(materializeAssembly).not.toHaveBeenCalled()
  })
  it("disposes derived geometry on a mate conflict and preserves structured diagnostic identity", async () => {
    const { engine, disposed, registry } = fixture(),
      solve = vi.fn()
    vi.mocked(materializeAssembly).mockImplementationOnce(async (options) => {
      await options.rebuildPinnedModel(snapshot, [])
      expect(options.solveAssemblyConstraints).toBe(solve)
      return {
        ok: false,
        code: "conflicting-mates",
        message: "Contradictory closed loop.",
        jointIds: ["0195b5ac-b220-7a2c-8c33-000000000070"],
      }
    })
    const action = vi.fn()
    await expect(
      withMaterializedAssemblyRuntime(engine, registry, null, input, identity, action, solve),
    ).rejects.toMatchObject({
      diagnostic: { code: "conflicting-mates", jointIds: ["0195b5ac-b220-7a2c-8c33-000000000070"] },
    })
    expect(action).not.toHaveBeenCalled()
    expect(disposed).toHaveBeenCalledTimes(1)
  })
})
