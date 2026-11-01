import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { AssemblyMaterializedOccurrence } from "@vibeshape/application/assembly-materialization"
import { featureIdSchema } from "@vibeshape/domain"
import { assemblyDefinitionIdSchema, assemblyInstanceIdSchema } from "@vibeshape/domain/assembly"
import { bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import type { GeometryEngineMetadata } from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"

mock.module("@vibeshape/application/assembly-materialization", () => ({
  materializeAssembly: vi.fn(),
}))
const featureRebuildModule = { ...(await import("@vibeshape/application/feature-rebuild")) }
mock.module("@vibeshape/application/feature-rebuild", () => ({
  ...featureRebuildModule,
  rebuildDocumentFeatures: vi.fn(),
}))

const { materializeAssembly } = await import("@vibeshape/application/assembly-materialization")
const { rebuildDocumentFeatures } = await import("@vibeshape/application/feature-rebuild")
const {
  createFeatureTypeRegistry,
  createModuleRegistry,
  documentSnapshotSchema,
  documentSnapshotV1Schema,
  documentSnapshotV3Schema,
  documentSnapshotV4Schema,
} = await import("@vibeshape/domain")
const { ReplicadGeometryEngine } = await import("@vibeshape/geometry-worker/engine")
const { inspectAssemblyInputSchema } = await import("@vibeshape/protocol")
const { withMaterializedAssemblyRuntime, inspectAssemblyRuntime } = await import(
  "./assembly-inspection"
)

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

function clearanceOccurrence(
  instanceId: string,
  x: number,
  featureId: string,
  meshOnly = false,
): AssemblyMaterializedOccurrence {
  const mesh = {
    positions: new Float32Array([x, 0, 0, x + 2, 0, 0, x, 2, 0]),
    normals: new Float32Array(9),
    indices: new Uint32Array([0, 1, 2]),
    triangleFaceIds: new Uint32Array([1]),
  }
  const bounds: AssemblyMaterializedOccurrence["bounds"] = { min: [x, 0, 0], max: [x + 2, 2, 2] }
  return {
    instanceId: assemblyInstanceIdSchema.parse(instanceId),
    definitionId: assemblyDefinitionIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000050"),
    pinRevision: 1,
    sourceIndex: 0,
    selectedBody: bodyReferenceSchema.parse({ schemaVersion: 0, featureId, outputRole: "result" }),
    representation: meshOnly ? "triangle-mesh" : "exact-solid",
    geometryFrame: { translation: [x, 0, 0], quaternion: [0, 0, 0, 1] },
    mesh,
    bounds,
    geometry: {
      featureId: featureIdSchema.parse(featureId),
      contentHash: "a".repeat(64),
      outputRole: "result",
      mesh,
      shape: {
        valid: true,
        volume: 8,
        surfaceArea: 24,
        bounds,
        faceCount: 6,
        edgeCount: 12,
        solidCount: 1,
      },
      topologyCandidates: [],
    },
  }
}
describe("exact clearance across document worker materialization", () => {
  it("bypasses broad-phase separation only for requested exact distances and propagates transformed native poses", async () => {
    const { engine, registry } = fixture()
    const feature = "0195b5ac-b220-7a2c-8c33-000000000002"
    const leftId = "0195b5ac-b220-7a2c-8c33-000000000060",
      rightId = "0195b5ac-b220-7a2c-8c33-000000000061"
    const occurrences = [
      clearanceOccurrence(leftId, 0, feature),
      clearanceOccurrence(rightId, 10, feature),
    ]
    vi.mocked(rebuildDocumentFeatures).mockImplementation(
      async ({ document: value, generation }) => ({
        ok: true,
        documentId: documentSnapshotSchema.parse(value).id,
        revision: 4,
        generation,
        features: [],
        geometry: occurrences.slice(0, 1).map(({ geometry }) => ({
          featureId: geometry.featureId,
          contentHash: geometry.contentHash,
          meshPolicy: input.mesh,
          geometry: {
            ...geometry,
            engine: metadata,
            cache: { brepHit: false },
            timings: { evaluationMs: 0, tessellationMs: 0, totalMs: 0 },
          },
        })),
        environment: metadata.featureContentEnvironment,
        mesh: input.mesh,
        evaluation: {
          records: [],
          dirtyFeatureIds: [],
          evaluatedFeatureIds: [],
          reusedFeatureIds: [],
        },
      }),
    )
    vi.mocked(materializeAssembly).mockImplementation(async (options) => {
      await options.rebuildPinnedModel(snapshot, [])
      return { ok: true, documentId: document.id, revision: document.revision, occurrences }
    })
    const measure = vi
      .spyOn(engine, "inspectAssemblyInterference")
      .mockResolvedValue({ volume: 0, solidCount: 0, distance: 8 })
    const request = {
      ...input,
      interferencePairs: [{ leftInstanceId: leftId, rightInstanceId: rightId }],
    }
    expect(
      (await inspectAssemblyRuntime(engine, registry, null, request, identity)).interference[0],
    ).not.toHaveProperty("distance")
    expect(measure).not.toHaveBeenCalled()
    const result = await inspectAssemblyRuntime(
      engine,
      registry,
      null,
      { ...request, measureDistance: true },
      identity,
    )
    expect(result.interference[0]).toMatchObject({ distance: 8, volume: 0, status: "clear" })
    expect(measure.mock.calls[0]?.[1][0]?.pose.translation).toEqual([10, 0, 0])
    expect(measure.mock.calls[0]?.[2]).toBe(true)
    occurrences[1] = clearanceOccurrence(rightId, 10, feature, true)
    expect(
      (
        await inspectAssemblyRuntime(
          engine,
          registry,
          null,
          { ...request, measureDistance: true },
          identity,
        )
      ).interference[0],
    ).toMatchObject({ status: "unsupported-mesh" })
    expect(measure).toHaveBeenCalledTimes(1)
  })
})
