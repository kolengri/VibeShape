import {
  booleanFeatureType,
  boxFeatureType,
  createFeatureGraph,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  cylinderFeatureType,
  documentCoreModule,
  type FeatureGraph,
  type FeatureId,
  type FeatureRecord,
  featureCoreModule,
  featureIdSchema,
  partDesignFeatureTypeHandlers,
  partDesignModule,
} from "@vibeshape/domain"
import {
  type FeatureContentEnvironment,
  featureEvaluationEngineResultSchema,
} from "@vibeshape/protocol"
import { describe, expect, it, vi } from "vitest"
import {
  type FeatureGeometryEvaluationPort,
  type FeatureGeometryEvaluationRequest,
  rebuildDocumentFeatures,
  rebuildFeatureGraph,
} from "./feature-rebuild"

const featureIds = {
  box: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101"),
  cylinder: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102"),
  boolean: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3103"),
  independent: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3104"),
} as const

const documentIds = {
  primary: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
  other: "0195b5ac-b213-7f2c-9c33-67a36a7f21ad",
} as const

const environment: FeatureContentEnvironment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "test-build",
    kernelId: "org.opencascade.occt",
    kernelVersion: "7.9.2",
    kernelSourceRevision: null,
  },
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
}

function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  return featureTypes.registry
}

function box(id: FeatureId, width = 20): FeatureRecord {
  return {
    schemaVersion: 0,
    id,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(width),
      depth: createLengthQuantity(30),
      height: createLengthQuantity(40),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
}

function cylinder(height = 60): FeatureRecord {
  return {
    schemaVersion: 0,
    id: featureIds.cylinder,
    type: cylinderFeatureType.type,
    parameters: {
      radius: createLengthQuantity(5),
      height: createLengthQuantity(height),
      centered: true,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
}

function boolean(): FeatureRecord {
  return {
    schemaVersion: 0,
    id: featureIds.boolean,
    type: booleanFeatureType.type,
    parameters: { operation: "subtract" },
    dependencies: [featureIds.box, featureIds.cylinder],
    references: [],
    suppressed: false,
  }
}

function graph(features: readonly FeatureRecord[]): FeatureGraph {
  const created = createFeatureGraph(features)
  if (!created.ok) throw new Error(created.diagnostic.message)
  return created.graph
}

function documentSnapshot(features: readonly FeatureRecord[], revision = 1) {
  return {
    schemaVersion: 0,
    id: documentIds.primary,
    revision,
    name: "Rebuild test",
    features,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  } as const
}

function geometry(contentEnvironment: FeatureContentEnvironment = environment) {
  return featureEvaluationEngineResultSchema.parse({
    engine: {
      adapter: "replicad",
      adapterVersion: "test-build",
      replicadVersion: "0.23.1",
      opencascadePackageVersion: "0.23.0",
      opencascadeSourceRevision: null,
      wasmBytes: 1,
      initializedInMs: 1,
      featureContentEnvironment: contentEnvironment,
    },
    shape: {
      valid: true,
      volume: 1,
      surfaceArea: 6,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      faceCount: 6,
      edgeCount: 12,
      solidCount: 1,
    },
    topologyCandidates: [],
    mesh: {
      positions: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 0, 1]),
      indices: new Uint32Array([0, 0, 0]),
      triangleFaceIds: new Uint32Array([1]),
    },
    cache: { brepHit: false },
    timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
  })
}

function contentHasher() {
  const hashes = new Map<string, string>()
  return (canonicalPayload: string) => {
    const existing = hashes.get(canonicalPayload)
    if (existing) return existing
    const hash = (hashes.size + 1).toString(16).padStart(64, "0")
    hashes.set(canonicalPayload, hash)
    return hash
  }
}

function successfulPort(
  requests: FeatureGeometryEvaluationRequest[],
): FeatureGeometryEvaluationPort {
  return async (request) => {
    await Promise.resolve()
    requests.push(request)
    request.onProgress?.("feature-evaluation", 0.5)
    return { ok: true, geometry: geometry() }
  }
}

function rebuildInput(
  featureGraph: FeatureGraph,
  hash: ReturnType<typeof contentHasher>,
  evaluateGeometry: FeatureGeometryEvaluationPort,
) {
  return {
    documentId: "document-test",
    revision: 1,
    generation: 1,
    graph: featureGraph,
    registry: registry(),
    environment,
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    hash,
    evaluateGeometry,
  } as const
}

function recordById(
  records: readonly { featureId: FeatureId; status: string }[],
  featureId: FeatureId,
) {
  return records.find((record) => record.featureId === featureId)
}

describe("feature rebuild coordination", () => {
  it("evaluates canonical geometry in dependency order and preserves presentation order", async () => {
    const featureGraph = graph([boolean(), cylinder(), box(featureIds.box)])
    const requests: FeatureGeometryEvaluationRequest[] = []
    const progress: string[] = []
    const result = await rebuildFeatureGraph({
      ...rebuildInput(featureGraph, contentHasher(), successfulPort(requests)),
      onProgress(featureId, stage) {
        progress.push(`${featureId}:${stage}`)
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(requests.map(({ featureId }) => featureId)).toEqual([
      featureIds.cylinder,
      featureIds.box,
      featureIds.boolean,
    ])
    expect(requests[2]?.dependencies.map(({ featureId }) => featureId)).toEqual([
      featureIds.box,
      featureIds.cylinder,
    ])
    expect(requests[2]?.dependencies.map(({ contentHash }) => contentHash)).toEqual(
      requests[2]?.content.feature.inputs,
    )
    expect(result.evaluation.records.map(({ featureId }) => featureId)).toEqual([
      featureIds.boolean,
      featureIds.cylinder,
      featureIds.box,
    ])
    expect(result.geometry.map(({ featureId }) => featureId)).toEqual([
      featureIds.boolean,
      featureIds.cylinder,
      featureIds.box,
    ])
    expect(progress).toHaveLength(3)
  })

  it("reuses clean geometry and rebuilds only a changed feature and its descendants", async () => {
    const hash = contentHasher()
    const initialGraph = graph([boolean(), cylinder(), box(featureIds.box)])
    const initialRequests: FeatureGeometryEvaluationRequest[] = []
    const initial = await rebuildFeatureGraph(
      rebuildInput(initialGraph, hash, successfulPort(initialRequests)),
    )
    expect(initial.ok).toBe(true)
    if (!initial.ok) return

    const reusedRequests: FeatureGeometryEvaluationRequest[] = []
    const reused = await rebuildFeatureGraph({
      ...rebuildInput(initialGraph, hash, successfulPort(reusedRequests)),
      previous: initial,
    })
    expect(reused.ok).toBe(true)
    if (!reused.ok) return
    expect(reusedRequests).toHaveLength(0)
    expect(reused.evaluation.reusedFeatureIds).toEqual([
      featureIds.cylinder,
      featureIds.box,
      featureIds.boolean,
    ])

    const changedGraph = graph([boolean(), cylinder(70), box(featureIds.box)])
    const changedRequests: FeatureGeometryEvaluationRequest[] = []
    const changed = await rebuildFeatureGraph({
      ...rebuildInput(changedGraph, hash, successfulPort(changedRequests)),
      revision: 2,
      previous: initial,
    })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changedRequests.map(({ featureId }) => featureId)).toEqual([
      featureIds.cylinder,
      featureIds.boolean,
    ])
    expect(changed.evaluation.reusedFeatureIds).toEqual([featureIds.box])
    expect(changed.geometry).toHaveLength(3)
    expect(recordById(changed.evaluation.records, featureIds.cylinder)).not.toEqual(
      recordById(initial.evaluation.records, featureIds.cylinder),
    )
    expect(recordById(changed.evaluation.records, featureIds.boolean)).not.toEqual(
      recordById(initial.evaluation.records, featureIds.boolean),
    )
  })

  it("reconciles added and removed features against the previous snapshot", async () => {
    const hash = contentHasher()
    const initialGraph = graph([box(featureIds.box)])
    const initial = await rebuildFeatureGraph(rebuildInput(initialGraph, hash, successfulPort([])))
    expect(initial.ok).toBe(true)
    if (!initial.ok) return

    const expandedRequests: FeatureGeometryEvaluationRequest[] = []
    const expandedGraph = graph([cylinder(), box(featureIds.box)])
    const expanded = await rebuildFeatureGraph({
      ...rebuildInput(expandedGraph, hash, successfulPort(expandedRequests)),
      previous: initial,
    })
    expect(expanded.ok).toBe(true)
    if (!expanded.ok) return
    expect(expandedRequests.map(({ featureId }) => featureId)).toEqual([featureIds.cylinder])
    expect(expanded.evaluation.reusedFeatureIds).toEqual([featureIds.box])
    expect(expanded.geometry.map(({ featureId }) => featureId)).toEqual([
      featureIds.cylinder,
      featureIds.box,
    ])

    const reducedRequests: FeatureGeometryEvaluationRequest[] = []
    const reduced = await rebuildFeatureGraph({
      ...rebuildInput(initialGraph, hash, successfulPort(reducedRequests)),
      previous: expanded,
    })
    expect(reduced.ok).toBe(true)
    if (!reduced.ok) return
    expect(reducedRequests).toEqual([])
    expect(reduced.evaluation.reusedFeatureIds).toEqual([featureIds.box])
    expect(reduced.geometry.map(({ featureId }) => featureId)).toEqual([featureIds.box])
  })

  it("reuses geometry when only presentation metadata changes", async () => {
    const hash = contentHasher()
    const initialGraph = graph([{ ...box(featureIds.box), label: "Initial label" }])
    const initial = await rebuildFeatureGraph(rebuildInput(initialGraph, hash, successfulPort([])))
    expect(initial.ok).toBe(true)
    if (!initial.ok) return

    const requests: FeatureGeometryEvaluationRequest[] = []
    const renamed = await rebuildFeatureGraph({
      ...rebuildInput(
        graph([{ ...box(featureIds.box), label: "Renamed feature" }]),
        hash,
        successfulPort(requests),
      ),
      revision: 2,
      previous: initial,
    })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(requests).toEqual([])
    expect(renamed.evaluation.reusedFeatureIds).toEqual([featureIds.box])
  })

  it("contains geometry failures, blocks descendants, and continues independent branches", async () => {
    const featureGraph = graph([
      boolean(),
      box(featureIds.box),
      cylinder(),
      box(featureIds.independent, 12),
    ])
    const requests: FeatureId[] = []
    const evaluateGeometry = vi.fn<FeatureGeometryEvaluationPort>(async (request) => {
      requests.push(request.featureId)
      if (request.featureId === featureIds.box) {
        return { ok: false, diagnosticCode: "invalid-feature-geometry" }
      }
      return { ok: true, geometry: geometry() }
    })
    const result = await rebuildFeatureGraph(
      rebuildInput(featureGraph, contentHasher(), evaluateGeometry),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(requests).toEqual([featureIds.box, featureIds.cylinder, featureIds.independent])
    expect(recordById(result.evaluation.records, featureIds.box)).toMatchObject({
      status: "failed",
      diagnostics: [
        {
          code: "org.vibeshape.feature.geometry-evaluation-failed",
          values: { reason: "invalid-feature-geometry" },
        },
      ],
    })
    expect(recordById(result.evaluation.records, featureIds.boolean)).toEqual({
      featureId: featureIds.boolean,
      status: "blocked",
      blockedBy: [featureIds.box],
    })
    expect(recordById(result.evaluation.records, featureIds.independent)?.status).toBe("succeeded")
    expect(result.geometry.map(({ featureId }) => featureId)).toEqual([
      featureIds.cylinder,
      featureIds.independent,
    ])
  })

  it("fails closed when previous geometry does not match successful cached results", async () => {
    const featureGraph = graph([box(featureIds.box)])
    const hash = contentHasher()
    const initial = await rebuildFeatureGraph(rebuildInput(featureGraph, hash, successfulPort([])))
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    const initialGeometry = initial.geometry[0]
    if (!initialGeometry) throw new Error("The initial rebuild did not produce geometry.")

    await expect(
      rebuildFeatureGraph({
        ...rebuildInput(featureGraph, hash, successfulPort([])),
        previous: {
          ...initial,
          geometry: [{ ...initialGeometry, contentHash: "f".repeat(64) }],
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-previous-feature-state" },
    })
    await expect(
      rebuildFeatureGraph({
        ...rebuildInput(featureGraph, hash, successfulPort([])),
        previous: { ...initial, geometry: [] },
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-previous-feature-state" },
    })
  })

  it("invalidates all derived geometry when the mesh policy changes", async () => {
    const featureGraph = graph([boolean(), cylinder(), box(featureIds.box)])
    const hash = contentHasher()
    const initial = await rebuildFeatureGraph(rebuildInput(featureGraph, hash, successfulPort([])))
    expect(initial.ok).toBe(true)
    if (!initial.ok) return

    const requests: FeatureGeometryEvaluationRequest[] = []
    const rebuilt = await rebuildFeatureGraph({
      ...rebuildInput(featureGraph, hash, successfulPort(requests)),
      mesh: { chordTolerance: 0.01, angularTolerance: 0.05 },
      previous: initial,
    })
    expect(rebuilt.ok).toBe(true)
    if (!rebuilt.ok) return
    expect(requests.map(({ featureId }) => featureId)).toEqual([
      featureIds.cylinder,
      featureIds.box,
      featureIds.boolean,
    ])
    expect(rebuilt.evaluation.reusedFeatureIds).toEqual([])
    expect(rebuilt.geometry.every(({ meshPolicy }) => meshPolicy.chordTolerance === 0.01)).toBe(
      true,
    )
  })

  it("contains rejected hash and invalid port output as stable feature diagnostics", async () => {
    const featureGraph = graph([box(featureIds.box), box(featureIds.independent, 12)])
    const evaluateGeometry = vi.fn<FeatureGeometryEvaluationPort>(async () => {
      return { invalid: true } as never
    })
    const result = await rebuildFeatureGraph({
      ...rebuildInput(featureGraph, contentHasher(), evaluateGeometry),
      hash: vi
        .fn()
        .mockRejectedValueOnce(new Error("hash detail must not escape"))
        .mockReturnValue("a".repeat(64)),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(recordById(result.evaluation.records, featureIds.box)).toMatchObject({
      status: "failed",
      diagnostics: [
        {
          code: "org.vibeshape.feature.content-identity-failed",
          values: { reason: "feature-content-hash-failed" },
        },
      ],
    })
    expect(recordById(result.evaluation.records, featureIds.independent)).toMatchObject({
      status: "failed",
      diagnostics: [
        {
          code: "org.vibeshape.feature.geometry-evaluation-failed",
          values: { reason: "unexpected-worker-response" },
        },
      ],
    })
  })

  it("rejects geometry produced under a different content environment", async () => {
    const featureGraph = graph([box(featureIds.box)])
    const foreignEnvironment: FeatureContentEnvironment = {
      ...environment,
      geometry: { ...environment.geometry, adapterVersion: "foreign-build" },
    }
    const result = await rebuildFeatureGraph({
      ...rebuildInput(featureGraph, contentHasher(), async () => ({
        ok: true,
        geometry: geometry(foreignEnvironment),
      })),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.evaluation.records).toMatchObject([
      {
        status: "failed",
        diagnostics: [
          {
            code: "org.vibeshape.feature.worker-contract-rejected",
            values: { reason: "feature-content-environment-mismatch" },
          },
        ],
      },
    ])
    expect(result.geometry).toEqual([])
  })

  it("builds the feature graph from a committed document snapshot", async () => {
    const requests: FeatureGeometryEvaluationRequest[] = []
    const result = await rebuildDocumentFeatures({
      document: documentSnapshot([boolean(), cylinder(), box(featureIds.box)], 7),
      generation: 3,
      registry: registry(),
      environment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash: contentHasher(),
      evaluateGeometry: successfulPort(requests),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({
      documentId: documentIds.primary,
      revision: 7,
      generation: 3,
    })
    expect(requests.map(({ featureId }) => featureId)).toEqual([
      featureIds.cylinder,
      featureIds.box,
      featureIds.boolean,
    ])
  })

  it("hashes prepared feature content and bypasses geometry for an identical prepared hash", async () => {
    const hash = contentHasher()
    const authoredBox = box(featureIds.box)
    const preparedParameters = {
      width: 31,
      depth: 30,
      height: 25.4,
      centered: false,
    }
    const initialRequests: FeatureGeometryEvaluationRequest[] = []
    const initial = await rebuildDocumentFeatures({
      document: documentSnapshot([authoredBox]),
      generation: 1,
      registry: registry(),
      environment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash,
      evaluateGeometry: successfulPort(initialRequests),
      prepareFeatureContent: () => ({ ok: true, parameters: preparedParameters }),
    })
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    expect(initialRequests[0]?.content.feature.parameters).toEqual(preparedParameters)

    const equivalentRequests: FeatureGeometryEvaluationRequest[] = []
    const equivalent = await rebuildDocumentFeatures({
      document: documentSnapshot([{ ...authoredBox, label: "Renamed Box" }], 2),
      generation: 1,
      registry: registry(),
      environment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash,
      evaluateGeometry: successfulPort(equivalentRequests),
      prepareFeatureContent: () => ({ ok: true, parameters: preparedParameters }),
      previous: initial,
    })
    expect(equivalent.ok).toBe(true)
    expect(equivalentRequests).toHaveLength(0)

    const changedRequests: FeatureGeometryEvaluationRequest[] = []
    const changed = await rebuildDocumentFeatures({
      document: documentSnapshot([authoredBox], 3),
      generation: 1,
      registry: registry(),
      environment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash,
      evaluateGeometry: successfulPort(changedRequests),
      prepareFeatureContent: () => ({
        ok: true,
        parameters: { ...preparedParameters, width: 32 },
      }),
      previous: equivalent.ok ? equivalent : initial,
    })
    expect(changed.ok).toBe(true)
    expect(changedRequests[0]?.content.feature.parameters).toMatchObject({ width: 32 })
  })

  it("contains thrown and malformed feature-content preparation", async () => {
    const evaluateGeometry = vi.fn<FeatureGeometryEvaluationPort>()
    const common = {
      document: documentSnapshot([box(featureIds.box)]),
      generation: 1,
      registry: registry(),
      environment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash: contentHasher(),
      evaluateGeometry,
    } as const

    const thrown = await rebuildDocumentFeatures({
      ...common,
      prepareFeatureContent: () => {
        throw new Error("private preparation detail")
      },
    })
    expect(thrown).toMatchObject({
      ok: true,
      evaluation: {
        records: [
          {
            status: "failed",
            diagnostics: [
              {
                code: "org.vibeshape.feature.content-preparation-failed",
                values: { reason: "preparation-threw" },
              },
            ],
          },
        ],
      },
    })
    const malformed = await rebuildDocumentFeatures({
      ...common,
      prepareFeatureContent: () => ({ ok: true, parameters: [] }),
    })
    expect(malformed).toMatchObject({
      ok: true,
      evaluation: {
        records: [
          {
            status: "failed",
            diagnostics: [
              {
                code: "org.vibeshape.feature.content-preparation-failed",
                values: { reason: "invalid-prepared-parameters" },
              },
            ],
          },
        ],
      },
    })
    expect(evaluateGeometry).not.toHaveBeenCalled()
  })

  it("rebuilds expression-bound geometry only when a document variable changes its value", async () => {
    const hash = contentHasher()
    const authoredBox: FeatureRecord = {
      ...box(featureIds.box),
      parameters: {
        ...box(featureIds.box).parameters,
        width: createLengthQuantity(20, "mm", "#width"),
      },
    }
    const variable = {
      schemaVersion: 0 as const,
      id: "0195b5ac-b240-7a2c-8c33-67a36a7f21ac",
      name: "width",
      expression: "20 mm",
    }
    const initialRequests: FeatureGeometryEvaluationRequest[] = []
    const initial = await rebuildDocumentFeatures({
      document: { ...documentSnapshot([authoredBox]), variables: [variable] },
      generation: 1,
      registry: registry(),
      environment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash,
      evaluateGeometry: successfulPort(initialRequests),
    })
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    expect(initialRequests[0]?.content.feature.parameters).toMatchObject({ width: 20 })

    const changedRequests: FeatureGeometryEvaluationRequest[] = []
    const changed = await rebuildDocumentFeatures({
      document: {
        ...documentSnapshot([authoredBox], 2),
        variables: [{ ...variable, expression: "24 mm" }],
      },
      generation: 1,
      registry: registry(),
      environment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash,
      evaluateGeometry: successfulPort(changedRequests),
      previous: initial,
    })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changedRequests).toHaveLength(1)
    expect(changedRequests[0]?.content.feature.parameters).toMatchObject({ width: 24 })

    const equivalentRequests: FeatureGeometryEvaluationRequest[] = []
    const equivalent = await rebuildDocumentFeatures({
      document: {
        ...documentSnapshot([authoredBox], 3),
        variables: [{ ...variable, expression: "12 * 2 mm" }],
      },
      generation: 1,
      registry: registry(),
      environment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash,
      evaluateGeometry: successfulPort(equivalentRequests),
      previous: changed,
    })
    expect(equivalent.ok).toBe(true)
    if (equivalent.ok) {
      expect(equivalentRequests).toHaveLength(0)
      expect(equivalent.evaluation.reusedFeatureIds).toEqual([featureIds.box])
    }
  })

  it("contains a feature parameter expression failure without invoking geometry", async () => {
    const authoredBox: FeatureRecord = {
      ...box(featureIds.box),
      parameters: {
        ...box(featureIds.box).parameters,
        width: createLengthQuantity(20, "mm", "#missing"),
      },
    }
    const evaluateGeometry = vi.fn<FeatureGeometryEvaluationPort>()
    const result = await rebuildDocumentFeatures({
      document: documentSnapshot([authoredBox]),
      generation: 1,
      registry: registry(),
      environment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash: contentHasher(),
      evaluateGeometry,
    })

    expect(result).toMatchObject({
      ok: true,
      evaluation: {
        records: [
          {
            status: "failed",
            diagnostics: [
              {
                code: "org.vibeshape.feature.parameter-expression-failed",
                values: { reason: "unknown-variable", path: "parameters.width" },
              },
            ],
          },
        ],
      },
      geometry: [],
    })
    expect(evaluateGeometry).not.toHaveBeenCalled()
  })

  it("rejects invalid documents and invalid committed feature graphs before evaluation", async () => {
    const evaluateGeometry = vi.fn<FeatureGeometryEvaluationPort>()
    const common = {
      generation: 1,
      registry: registry(),
      environment,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      hash: contentHasher(),
      evaluateGeometry,
    } as const

    await expect(rebuildDocumentFeatures({ ...common, document: {} })).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-document-snapshot" },
    })
    await expect(
      rebuildDocumentFeatures({ ...common, document: documentSnapshot([boolean()]) }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-document-snapshot" },
    })
    expect(evaluateGeometry).not.toHaveBeenCalled()
  })

  it("binds previous state to its document and revision and rebuilds after generation change", async () => {
    const featureGraph = graph([box(featureIds.box)])
    const hash = contentHasher()
    const initial = await rebuildFeatureGraph(rebuildInput(featureGraph, hash, successfulPort([])))
    expect(initial.ok).toBe(true)
    if (!initial.ok) return

    await expect(
      rebuildFeatureGraph({
        ...rebuildInput(featureGraph, hash, successfulPort([])),
        documentId: documentIds.other,
        previous: initial,
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "previous-document-mismatch" },
    })
    await expect(
      rebuildFeatureGraph({
        ...rebuildInput(featureGraph, hash, successfulPort([])),
        revision: 0,
        previous: initial,
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "future-previous-revision" },
    })

    const requests: FeatureGeometryEvaluationRequest[] = []
    const restarted = await rebuildFeatureGraph({
      ...rebuildInput(featureGraph, hash, successfulPort(requests)),
      generation: 2,
      previous: initial,
    })
    expect(restarted.ok).toBe(true)
    if (!restarted.ok) return
    expect(requests.map(({ featureId }) => featureId)).toEqual([featureIds.box])
    expect(restarted.evaluation.reusedFeatureIds).toEqual([])
  })
})
