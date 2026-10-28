import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import {
  assemblyInstanceIdSchema,
  assemblyJointIdSchema,
  assemblyRigidPoseSchema,
  boxFeatureType,
  captureAssemblyDefinition,
  createLengthQuantity,
  type DocumentSnapshotV1,
  documentSnapshotV4Schema,
  emptyAssemblyAuthority,
  featureIdSchema,
  meshImportFeatureType,
  meshImportOutputRole,
  projectAssemblyAuthority,
  sourceAssetSchema,
  upgradeAssemblyAuthority,
} from "@vibeshape/domain"
import {
  type AssemblyConstraintSolvePort,
  type AssemblyMateGraph,
  assemblyFrameBindingSchema,
  assemblyMateGraphSchema,
} from "@vibeshape/domain/assembly-mates"
import {
  assemblyInspectionSchema,
  type FeatureContentEnvironment,
  featureEvaluationEngineResultSchema,
  topologyCandidateSchema,
} from "@vibeshape/protocol"
import { denseBoxMesh } from "../../../tests/support/dense-box-fixture"
import { vi } from "../../../tests/unit/support/bun-test"
import { type AssemblyMateSourceGeometry, resolveAssemblyMateFrames } from "./assembly-mate-frames"
import {
  AssemblyMaterializationCache,
  type AssemblyMaterializationOptions,
  materializeAssembly,
} from "./assembly-materialization"
import type { FeatureRebuildState } from "./feature-rebuild"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const pose = assemblyRigidPoseSchema.parse({ translation: [0, 0, 0], quaternion: [0, 0, 0, 1] })
const hash = "a".repeat(64)
const environment: FeatureContentEnvironment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "assembly-test",
    kernelId: "org.opencascade.occt",
    kernelVersion: "7.9.2",
    kernelSourceRevision: null,
  },
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
}
const meshPolicy = { chordTolerance: 0.1, angularTolerance: 0.1 }
function base() {
  const body = { schemaVersion: 0, featureId: id(2), outputRole: "result" }
  return documentSnapshotV4Schema.parse({
    surfaceTextures: [],
    schemaVersion: 4,
    id: id(1),
    revision: 3,
    name: "Assembly materialization",
    displayUnits: { length: "mm", angle: "deg" },
    variables: [],
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
    sketches: [],
    history: [{ kind: "feature", id: id(2) }],
    parts: [
      {
        schemaVersion: 0,
        id: id(30),
        name: "Block",
        visible: true,
        origin: "independent",
        consumedBy: null,
        bodyHistory: [body],
      },
    ],
    folders: [],
    assets: [],
    assembly: emptyAssemblyAuthority(),
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
  })
}
function fixture() {
  const document = base()
  const definition = captureAssemblyDefinition(document, {
    schemaVersion: 1,
    id: id(50),
    name: "Frozen block",
    sources: [
      {
        kind: "part",
        partId: id(30),
        body: { schemaVersion: 0, featureId: id(2), outputRole: "result" },
        contentHash: hash,
      },
    ],
    sourceFrame: pose,
  })
  return documentSnapshotV4Schema.parse({
    ...document,
    assembly: {
      ...emptyAssemblyAuthority(),
      definitions: [definition],
      instances: [
        {
          schemaVersion: 1,
          id: id(60),
          definitionId: id(50),
          name: "Block occurrence",
          grounded: true,
          worldFrame: pose,
        },
      ],
    },
  })
}
function geometry(outputRole?: string, mesh = false) {
  const shape = {
    valid: true,
    volume: mesh ? 0 : 24,
    surfaceArea: 52,
    bounds: { min: [0, 0, 0], max: [2, 3, 4] },
    faceCount: mesh ? 0 : 6,
    edgeCount: mesh ? 0 : 12,
    solidCount: mesh ? 0 : 1,
  }
  const payload = {
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
    normals: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
    indices: new Uint32Array([0, 1, 2]),
    triangleFaceIds: new Uint32Array([mesh ? 0 : 1]),
  }
  return featureEvaluationEngineResultSchema.parse({
    ...(mesh ? { representation: "triangle-mesh" } : {}),
    engine: {
      adapter: "replicad",
      adapterVersion: "assembly-test",
      replicadVersion: "0.23.1",
      opencascadePackageVersion: "0.23.0",
      opencascadeSourceRevision: null,
      wasmBytes: 1,
      initializedInMs: 0,
      featureContentEnvironment: environment,
    },
    shape,
    mesh: payload,
    topologyCandidates: [],
    ...(outputRole === undefined
      ? {}
      : {
          bodies: [
            {
              outputRole,
              ...(mesh ? { representation: "triangle-mesh" } : {}),
              shape,
              mesh: payload,
              topologyCandidates: [],
            },
          ],
        }),
    cache: { brepHit: false },
    timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
  })
}
function state(
  snapshot: DocumentSnapshotV1,
  outputRole?: string,
  mesh = false,
): FeatureRebuildState {
  const features = snapshot.features.map(({ semanticInputs: _inputs, ...feature }) => ({
    ...feature,
    schemaVersion: 0 as const,
  }))
  return {
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: 0,
    features,
    evaluation: {
      records: features.map(({ id }) => ({
        featureId: id,
        status: "succeeded",
        contentHash: hash,
      })),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: features.map(({ id }) => id),
      reusedFeatureIds: [],
    },
    geometry: features.map(({ id }) => ({
      featureId: id,
      contentHash: hash,
      meshPolicy,
      geometry: geometry(outputRole, mesh),
    })),
    environment,
    mesh: meshPolicy,
  }
}
function options(document = fixture()) {
  const keys = new Map<string, string>()
  const sha256 = vi.fn(async (input: string | Uint8Array) => {
    if (input instanceof Uint8Array)
      return input.length === 3 && input.every((byte, index) => byte === index + 1)
        ? "b".repeat(64)
        : "d".repeat(64)
    const previous = keys.get(input)
    if (previous) return previous
    const key = (keys.size + 1).toString(16).padStart(64, "0")
    keys.set(input, key)
    return key
  })
  return {
    document,
    contentEnvironment: environment,
    meshPolicy,
    sha256,
    readSourceBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    rebuildPinnedModel: vi.fn(async (snapshot: DocumentSnapshotV1) => state(snapshot)),
    cache: new AssemblyMaterializationCache(),
  } satisfies AssemblyMaterializationOptions
}

function boundFixture() {
  const document = fixture(),
    authority = upgradeAssemblyAuthority(document.assembly)
  authority.instances.push({
    schemaVersion: 2,
    id: assemblyInstanceIdSchema.parse(id(61)),
    definitionId: required(authority.definitions[0]).id,
    name: "Moving block",
    grounded: false,
    initialFrame: pose,
  })
  const signature = {
    kind: "face",
    geometryClass: "PLANE",
    measure: 6,
    centroid: [1, 1.5, 4],
    bounds: { min: [0, 0, 4], max: [2, 3, 4] },
    direction: [0, 0, 1],
    directionMode: "oriented",
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE"],
  }
  const candidate = topologyCandidateSchema.parse({
    candidateId: "face:unpersisted",
    kind: "face",
    signature,
    lineageTokens: [],
    referenceGeometry: { kind: "plane-face", origin: [0, 0, 4], normal: [0, 0, 1] },
  })
  const definition = required(authority.definitions[0]),
    binding = assemblyFrameBindingSchema.parse({
      sourceIndex: 0,
      pinRevision: definition.pinRevision,
      body: required(definition.pinnedModels[0]).selectedBody,
      reference: { schemaVersion: 0, featureId: id(2), kind: "face", signature },
      geometry: "planar-face",
      originHint: [1, 1, 9],
      xDirection: [1, 0, 0],
      reversed: false,
    })
  authority.joints.push({
    schemaVersion: 2,
    id: assemblyJointIdSchema.parse(id(70)),
    kind: "ball",
    parentInstanceId: required(authority.instances[0]).id,
    childInstanceId: required(authority.instances[1]).id,
    parentFrame: pose,
    childFrame: pose,
    parentBinding: binding,
  })
  const graph = assemblyMateGraphSchema.parse(projectAssemblyAuthority(authority))
  const sources: AssemblyMateSourceGeometry[] = [
    {
      definitionId: definition.id,
      sourceIndex: 0,
      selectedBody: binding.body,
      representation: "exact-solid",
      candidates: [candidate],
    },
  ]
  return {
    document: documentSnapshotV4Schema.parse({ ...document, assembly: authority }),
    graph,
    sources,
    definition,
    binding,
    candidate,
  }
}

describe("frozen topology-bound joint frames", () => {
  it("projects an analytical frame and composes source coordinates and authored offsets exactly once", () => {
    const f = boundFixture()
    f.definition.sourceFrame = assemblyRigidPoseSchema.parse({ ...pose, translation: [10, 0, 0] })
    required(f.graph.joints[0]).parentFrame = assemblyRigidPoseSchema.parse({
      ...pose,
      translation: [0, 0, 2],
    })
    const before = JSON.stringify(f.graph)
    const result = resolveAssemblyMateFrames(f.graph, [f.definition], f.sources)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.assembly.joints[0]?.parentFrame.translation).toEqual([-9, 1, 6])
      expect(result.assembly.joints[0]).not.toHaveProperty("parentBinding")
      expect(result.assembly.joints[0]?.parentFrame.quaternion).toEqual([0, 0, 0, 1])
    }
    expect(JSON.stringify(f.graph)).toBe(before)
    expect(f.graph.joints[0]?.parentBinding).toEqual(f.binding)
  })
  it.each([
    ["missing", "topology-missing"],
    ["ambiguous", "topology-ambiguous"],
    ["stale", "topology-stale"],
    ["mesh", "unsupported-topology"],
    ["parallel-x", "unsupported-topology"],
  ] as const)("fails closed for %s evidence and retains the responsible mate", (scenario, code) => {
    const f = boundFixture(),
      joint = required(f.graph.joints[0])
    if (scenario === "missing") f.sources[0] = { ...required(f.sources[0]), candidates: [] }
    if (scenario === "ambiguous")
      f.sources[0] = {
        ...required(f.sources[0]),
        candidates: [f.candidate, { ...f.candidate, candidateId: "face:second" }],
      }
    if (scenario === "stale") joint.parentBinding = { ...f.binding, pinRevision: 2 }
    if (scenario === "mesh")
      f.sources[0] = { ...required(f.sources[0]), representation: "triangle-mesh" }
    if (scenario === "parallel-x") joint.parentBinding = { ...f.binding, xDirection: [0, 0, 1] }
    const before = JSON.stringify(f.graph)
    const result = resolveAssemblyMateFrames(f.graph, [f.definition], f.sources)
    expect(result).toMatchObject({ ok: false, code, jointIds: [id(70)] })
    expect(result).not.toHaveProperty("assembly")
    expect(JSON.stringify(f.graph)).toBe(before)
  })
  it("uses finite stable cylinder, sphere, circle and vertex frame recipes", () => {
    const f = boundFixture()
    const samples = [
      {
        recipe: "cylindrical-face",
        kind: "face",
        geometryClass: "CYLINDRE",
        geometry: { kind: "cylinder-face", origin: [0, 0, 0], axis: [0, 0, 1], radius: 2 },
        expected: [0, 0, 9],
      },
      {
        recipe: "spherical-face",
        kind: "face",
        geometryClass: "SPHERE",
        geometry: { kind: "sphere-face", center: [2, 3, 4], radius: 2 },
        expected: [2, 3, 4],
      },
      {
        recipe: "circular-edge",
        kind: "edge",
        geometryClass: "CIRCLE",
        geometry: {
          kind: "circle-edge",
          center: [2, 3, 4],
          normal: [0, 0, 1],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          radius: 2,
        },
        expected: [2, 3, 4],
      },
      {
        recipe: "vertex",
        kind: "vertex",
        geometryClass: "POINT",
        geometry: { kind: "vertex", position: [2, 3, 4] },
        expected: [2, 3, 4],
      },
    ]
    for (const sample of samples) {
      const signature = {
        ...f.candidate.signature,
        kind: sample.kind,
        geometryClass: sample.geometryClass,
      }
      const candidate = topologyCandidateSchema.parse({
        ...f.candidate,
        kind: sample.kind,
        signature,
        referenceGeometry: sample.geometry,
      })
      required(f.graph.joints[0]).parentBinding = assemblyFrameBindingSchema.parse({
        ...f.binding,
        geometry: sample.recipe,
        reference: { ...f.binding.reference, kind: sample.kind, signature },
      })
      const result = resolveAssemblyMateFrames(
        f.graph,
        [f.definition],
        [{ ...required(f.sources[0]), candidates: [candidate] }],
      )
      expect(result.ok).toBe(true)
      if (result.ok)
        expect(result.assembly.joints[0]?.parentFrame.translation).toEqual<unknown>(sample.expected)
    }
  })
})

describe("general assembly materialization authority", () => {
  it("passes only verified frozen analytical frames to the solver and publishes its rank", async () => {
    const f = boundFixture(),
      input = options(f.document)
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => {
      const rebuilt = state(snapshot)
      required(rebuilt.geometry[0]).geometry.topologyCandidates = [f.candidate]
      return rebuilt
    })
    const solve = vi.fn<AssemblyConstraintSolvePort>((graph: AssemblyMateGraph) => ({
      ok: true,
      status: "under-constrained",
      degreesOfFreedom: 3,
      maximumResidual: 0,
      redundant: false,
      redundantJointIds: [],
      instances: graph.instances.map((instance) => ({
        instanceId: instance.id,
        definitionId: instance.definitionId,
        worldFrame: pose,
        geometryFrame: pose,
      })),
    }))
    const result = await materializeAssembly({
      ...input,
      cache: new AssemblyMaterializationCache(),
      solveAssemblyConstraints: solve,
    })
    expect(result).toMatchObject({
      ok: true,
      kinematics: { degreesOfFreedom: 3, status: "under-constrained" },
    })
    expect(solve).toHaveBeenCalledTimes(1)
    expect(solve.mock.calls[0]?.[0].joints[0]?.parentFrame.translation).toEqual([1, 1, 4])
    expect(solve.mock.calls[0]?.[0].joints[0]).not.toHaveProperty("parentBinding")
    expect(f.document.assembly.joints[0]).toHaveProperty("parentBinding")
  })
  it("never calls the solver on stale topology and never publishes partial occurrences on a conflict", async () => {
    const f = boundFixture(),
      input = options(f.document),
      solve = vi.fn<AssemblyConstraintSolvePort>(() => ({
        ok: false,
        code: "conflicting-mates",
        message: "Contradictory mate geometry.",
        jointIds: [id(70)],
      }))
    const missing = await materializeAssembly({ ...input, solveAssemblyConstraints: solve })
    expect(missing).toMatchObject({ ok: false, code: "topology-missing", jointIds: [id(70)] })
    expect(solve).not.toHaveBeenCalled()
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => {
      const rebuilt = state(snapshot)
      required(rebuilt.geometry[0]).geometry.topologyCandidates = [f.candidate]
      return rebuilt
    })
    const result = await materializeAssembly({
      ...input,
      cache: new AssemblyMaterializationCache(),
      solveAssemblyConstraints: solve,
    })
    expect(result).toMatchObject({ ok: false, code: "conflicting-mates", jointIds: [id(70)] })
    expect(result).not.toHaveProperty("occurrences")
    expect(solve).toHaveBeenCalledTimes(1)
  })
  it("reports a missing solver without changing legacy materialization", async () => {
    const f = boundFixture()
    expect(await materializeAssembly(options(f.document))).toMatchObject({
      ok: false,
      code: "mate-solver-unavailable",
    })
    expect(await materializeAssembly(options())).toMatchObject({ ok: true })
  })
})
function meshFixture(byteLength = 3, digest = "b".repeat(64)) {
  const document = base()
  const asset = sourceAssetSchema.parse({
    id: id(80),
    digest,
    byteLength,
    filename: "Body.stl",
    format: "stl",
    representation: "triangle-mesh",
    normalization: {
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    },
    outputs: [id(81)],
  })
  const body = { schemaVersion: 0, featureId: id(4), outputRole: meshImportOutputRole(id(81)) }
  const feature = {
    schemaVersion: 1,
    id: id(4),
    type: meshImportFeatureType.type,
    dependencies: [],
    references: [],
    semanticInputs: [],
    suppressed: false,
    parameters: {
      sourceAssetId: asset.id,
      source: {
        digest: asset.digest,
        byteLength: asset.byteLength,
        format: "stl",
        normalization: asset.normalization,
        parserPolicyVersion: 1,
      },
      outputs: [{ outputId: id(81), nodeKey: "stl.mesh" }],
    },
  }
  const current = documentSnapshotV4Schema.parse({
    ...document,
    assets: [asset],
    features: [...document.features, feature],
    history: [...document.history, { kind: "feature", id: id(4) }],
    parts: [
      ...document.parts,
      { ...document.parts[0], id: id(34), name: "Imported mesh", bodyHistory: [body] },
    ],
  })
  const definition = captureAssemblyDefinition(current, {
    schemaVersion: 1,
    id: id(50),
    name: "Frozen mesh",
    sources: [{ kind: "asset-output", assetId: asset.id, outputId: id(81), digest: asset.digest }],
    sourceFrame: pose,
  })
  return documentSnapshotV4Schema.parse({
    ...current,
    assembly: {
      ...emptyAssemblyAuthority(),
      definitions: [definition],
      instances: [
        {
          schemaVersion: 1,
          id: id(60),
          definitionId: id(50),
          name: "Mesh occurrence",
          grounded: true,
          worldFrame: pose,
        },
      ],
    },
  })
}
function success(result: Awaited<ReturnType<typeof materializeAssembly>>) {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result
}
describe("immutable assembly materialization", () => {
  it("rebuilds one frozen closure for repeated independent occurrences and normalizes a known default result", async () => {
    const input = options()
    input.document = documentSnapshotV4Schema.parse({
      ...input.document,
      assembly: {
        ...input.document.assembly,
        instances: [
          ...input.document.assembly.instances,
          {
            ...input.document.assembly.instances[0],
            id: id(61),
            name: "Second block",
            worldFrame: { ...pose, translation: [10, 0, 0] },
          },
        ],
      },
    })
    const result = success(await materializeAssembly(input))
    expect(input.rebuildPinnedModel).toHaveBeenCalledTimes(1)
    expect(result.occurrences.map(({ instanceId }) => instanceId)).toEqual<unknown>([
      id(60),
      id(61),
    ])
    expect(result.occurrences[0]?.geometry.outputRole).toBe("result")
    expect(result.occurrences[1]?.bounds.min).toEqual([10, 0, 0])
    expect(success(await materializeAssembly(input)).occurrences).toHaveLength(2)
    expect(input.rebuildPinnedModel).toHaveBeenCalledTimes(1)
  })
  it("uses the frozen source after its original feature is edited or deleted", async () => {
    const input = options()
    const saved = input.document.assembly
    const edited = documentSnapshotV4Schema.parse({
      ...input.document,
      features: input.document.features.map((feature) => ({
        ...feature,
        parameters: { ...feature.parameters, width: createLengthQuantity(20) },
      })),
    })
    success(await materializeAssembly({ ...input, document: edited }))
    const deleted = documentSnapshotV4Schema.parse({
      ...edited,
      features: [],
      history: [],
      parts: [],
    })
    const result = success(await materializeAssembly({ ...input, document: deleted }))
    expect(result.occurrences[0]?.geometry.shape.volume).toBe(24)
    expect(deleted.assembly).toEqual(saved)
    expect(input.rebuildPinnedModel).toHaveBeenCalledTimes(1)
    const rebuilt = input.rebuildPinnedModel.mock.calls[0]?.[0]
    expect(rebuilt?.features[0]?.parameters.width).toEqual(createLengthQuantity(2))
  })
  it("transforms positions and normals by world times inverse source frame without mutating source buffers", async () => {
    const input = options()
    input.document = documentSnapshotV4Schema.parse({
      ...input.document,
      assembly: {
        ...input.document.assembly,
        definitions: input.document.assembly.definitions.map((definition) => ({
          ...definition,
          sourceFrame: { ...pose, translation: [1, 0, 0] },
        })),
        instances: input.document.assembly.instances.map((instance) => ({
          ...instance,
          worldFrame: { translation: [10, 20, 0], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
        })),
      },
    })
    const result = success(await materializeAssembly(input))
    const occurrence = result.occurrences[0]
    expect(occurrence?.bounds.min[0]).toBeCloseTo(7)
    expect(occurrence?.bounds.min[1]).toBeCloseTo(19)
    expect(occurrence?.bounds.max).toEqual(expect.arrayContaining([4]))
    expect(occurrence?.mesh.positions[0]).toBeCloseTo(10)
    expect(occurrence?.mesh.positions[1]).toBeCloseTo(19)
    expect(occurrence?.mesh.normals[0]).toBeCloseTo(0)
    expect(occurrence?.mesh.normals[1]).toBeCloseTo(1)
    if (!occurrence) throw new Error("Expected materialized occurrence.")
    occurrence.geometry.mesh.positions.fill(999)
    occurrence.mesh.positions.fill(999)
    const again = success(await materializeAssembly(input))
    expect(again.occurrences[0]?.geometry.mesh.positions[0]).toBe(0)
    expect(again.occurrences[0]?.mesh.positions[0]).toBeCloseTo(10)
  })
  it("owns precise imported mesh coordinates across cache reuse and placed copies", async () => {
    const input = options(meshFixture())
    input.document.assembly.instances = input.document.assembly.instances.map((instance) => ({
      ...instance,
      worldFrame: { ...pose, translation: [0.01, 0.01, 0.01] },
    }))
    const sourcePositions = new Float64Array([132, 0, 0, 132.8, 0, 0, 132, 0.8, 0])
    let produced: FeatureRebuildState | undefined
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => {
      produced = state(snapshot, meshImportOutputRole(id(81)), true)
      for (const record of produced.geometry) {
        for (const body of [record.geometry, ...(record.geometry.bodies ?? [])]) {
          body.mesh = {
            ...body.mesh,
            positions: new Float32Array(sourcePositions),
            precisePositions: sourcePositions.slice(),
          }
          body.shape.bounds = { min: [132, 0, 0], max: [132.8, 0.8, 0] }
        }
      }
      return produced
    })
    const first = success(await materializeAssembly(input)).occurrences[0]
    if (!first) throw new Error("Missing precise occurrence")
    const expected = new Float64Array(Array.from(sourcePositions, (value) => value + 0.01))
    expect(first.geometry.mesh.precisePositions).toEqual(sourcePositions)
    expect(first.mesh.precisePositions).toEqual(expected)
    expect(first.mesh.positions).toEqual(new Float32Array(expected))
    expect(first.mesh.precisePositions?.[0]).not.toBe(first.mesh.positions[0])
    expect(first.mesh.precisePositions?.buffer).not.toBe(
      first.geometry.mesh.precisePositions?.buffer,
    )
    produced?.geometry[0]?.geometry.mesh.precisePositions?.fill(999)
    first.geometry.mesh.precisePositions?.fill(888)
    first.mesh.precisePositions?.fill(777)
    const again = success(await materializeAssembly(input)).occurrences[0]
    expect(again?.geometry.mesh.precisePositions).toEqual(sourcePositions)
    expect(again?.mesh.precisePositions).toEqual(expected)
    expect(input.rebuildPinnedModel).toHaveBeenCalledTimes(1)
  })
  it("rejects stale producer parameters, revisions and hashes without a partial occurrence result", async () => {
    for (const failure of ["revision", "parameters", "hash"] as const) {
      const input = options()
      input.rebuildPinnedModel.mockImplementation(async (snapshot) => {
        const rebuilt = state(snapshot)
        if (failure === "revision") return { ...rebuilt, revision: snapshot.revision + 1 }
        if (failure === "parameters")
          return {
            ...rebuilt,
            features: rebuilt.features.map((feature) => ({
              ...feature,
              parameters: { ...feature.parameters, width: createLengthQuantity(99) },
            })),
          }
        return {
          ...rebuilt,
          evaluation: {
            ...rebuilt.evaluation,
            records: [
              {
                featureId: featureIdSchema.parse(id(2)),
                status: "succeeded",
                contentHash: "c".repeat(64),
              },
            ],
          },
          geometry: rebuilt.geometry.map((record) => ({ ...record, contentHash: "c".repeat(64) })),
        }
      })
      const result = await materializeAssembly(input)
      expect(result).toMatchObject({
        ok: false,
        code: failure === "hash" ? "pinned-content-hash-mismatch" : "pinned-rebuild-stale",
      })
      expect(result).not.toHaveProperty("occurrences")
      input.rebuildPinnedModel.mockImplementation(async (snapshot) => state(snapshot))
      expect((await materializeAssembly(input)).ok).toBe(true)
      expect(input.rebuildPinnedModel).toHaveBeenCalledTimes(2)
    }
  })
  it("requires exact declared output roles for catalogs and never treats a mesh aggregate as result", async () => {
    const input = options()
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => state(snapshot, "other"))
    expect(await materializeAssembly(input)).toMatchObject({
      ok: false,
      code: "selected-output-missing",
    })
    const meshInput = options(meshFixture())
    meshInput.rebuildPinnedModel.mockImplementation(async (snapshot) =>
      state(snapshot, meshImportOutputRole(id(81)), true),
    )
    const result = success(await materializeAssembly(meshInput))
    expect(result.occurrences[0]?.representation).toBe("triangle-mesh")
    expect(result.occurrences[0]?.geometry.shape.solidCount).toBe(0)
    expect(result.occurrences[0]?.geometry.topologyCandidates).toEqual([])
    meshInput.cache.clear()
    meshInput.rebuildPinnedModel.mockImplementation(async (snapshot) => state(snapshot))
    expect(await materializeAssembly(meshInput)).toMatchObject({
      ok: false,
      code: "selected-output-missing",
    })
  })
  it("checks missing, mismatched and corrupt source bytes on every call including a cache hit", async () => {
    const input = options(meshFixture())
    input.rebuildPinnedModel.mockImplementation(async (snapshot) =>
      state(snapshot, meshImportOutputRole(id(81)), true),
    )
    expect((await materializeAssembly(input)).ok).toBe(true)
    input.readSourceBytes.mockResolvedValue(new Uint8Array([1, 2, 4]))
    expect(await materializeAssembly(input)).toMatchObject({
      ok: false,
      code: "source-bytes-invalid",
    })
    input.readSourceBytes.mockResolvedValue(new Uint8Array([1]))
    expect(await materializeAssembly(input)).toMatchObject({
      ok: false,
      code: "source-bytes-invalid",
    })
    expect(
      await materializeAssembly({ ...input, readSourceBytes: async () => null }),
    ).toMatchObject({ ok: false, code: "source-bytes-unavailable" })
    input.readSourceBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    expect((await materializeAssembly(input)).ok).toBe(true)
    expect(input.rebuildPinnedModel).toHaveBeenCalledTimes(1)
    expect(input.readSourceBytes).toHaveBeenCalledTimes(4)
    expect(input.sha256.mock.calls.filter(([data]) => data instanceof Uint8Array)).toHaveLength(3)
  })
  it("verifies frozen source bytes above 64 MiB before rebuilding an imported mesh", async () => {
    const bytes = new Uint8Array(64 * 1024 * 1024 + 1)
    bytes[bytes.length - 1] = 29
    const digest = createHash("sha256").update(bytes).digest("hex")
    const input = options(meshFixture(bytes.byteLength, digest))
    input.sha256.mockImplementation(async (value) =>
      createHash("sha256").update(value).digest("hex"),
    )
    input.readSourceBytes.mockResolvedValue(bytes)
    input.rebuildPinnedModel.mockImplementation(async (snapshot) =>
      state(snapshot, meshImportOutputRole(id(81)), true),
    )
    const result = success(await materializeAssembly(input))
    expect(result.occurrences).toHaveLength(1)
    expect(result.occurrences[0]?.representation).toBe("triangle-mesh")
    expect(input.readSourceBytes).toHaveBeenCalledTimes(1)
    expect(input.rebuildPinnedModel).toHaveBeenCalledTimes(1)
    expect(bytes.at(-1)).toBe(29)
  })
  it("materializes and transfers derived geometry and placed occurrences above 64 MiB", async () => {
    const input = options(meshFixture())
    const first = required(input.document.assembly.instances[0])
    input.document = documentSnapshotV4Schema.parse({
      ...input.document,
      assembly: {
        ...input.document.assembly,
        instances: [
          first,
          {
            ...first,
            id: id(61),
            name: "Second mesh",
            worldFrame: { ...pose, translation: [4, 0, 0] },
          },
        ],
      },
    })
    const dense = denseBoxMesh({ subdivisions: 320, min: [0, 0, 0], max: [2, 3, 4] })
    const positions = Float32Array.from(dense.vertices)
    const normals = new Float32Array(positions.length)
    const verticesPerFace = 321 * 321
    for (let vertex = 0; vertex < positions.length / 3; vertex++) {
      const face = Math.floor(vertex / verticesPerFace)
      normals[vertex * 3 + Math.floor(face / 2)] = face % 2 === 0 ? -1 : 1
    }
    const mesh = {
      positions,
      normals,
      indices: Uint32Array.from(dense.indices),
      triangleFaceIds: new Uint32Array(dense.indices.length / 3),
    }
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => {
      const rebuilt = state(snapshot, meshImportOutputRole(id(81)), true)
      const record = required(rebuilt.geometry[0])
      const body = required(record.geometry.bodies?.[0])
      return {
        ...rebuilt,
        geometry: [
          { ...record, geometry: { ...record.geometry, mesh, bodies: [{ ...body, mesh }] } },
        ],
      }
    })
    const result = success(await materializeAssembly(input))
    expect(result.occurrences).toHaveLength(2)
    expect(result.occurrences[0]?.mesh.positions).not.toBe(positions)
    expect(result.occurrences[0]?.geometry.mesh.normals).not.toBe(normals)
    expect(result.occurrences[1]?.bounds).toEqual({ min: [4, 0, 0], max: [6, 3, 4] })
    expect(
      result.occurrences.reduce(
        (total, occurrence) =>
          total +
          occurrence.mesh.positions.byteLength +
          occurrence.mesh.normals.byteLength +
          occurrence.mesh.indices.byteLength +
          occurrence.mesh.triangleFaceIds.byteLength,
        0,
      ),
    ).toBeGreaterThan(64 * 1024 * 1024)
    const transferred = assemblyInspectionSchema.parse({
      occurrences: result.occurrences.map(({ geometry, ...occurrence }) => ({
        ...occurrence,
        contentHash: geometry.contentHash,
        topologyCandidates: geometry.topologyCandidates,
      })),
      interference: [],
    })
    expect(transferred.occurrences).toHaveLength(2)
    expect(required(transferred.occurrences[0]).mesh.indices.length / 3).toBe(1_228_800)
  }, 30_000)
  it("includes mesh and geometry environment identities in the caller-owned cache", async () => {
    const input = options()
    success(await materializeAssembly(input))
    const fine = { ...meshPolicy, chordTolerance: 0.05 }
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => ({
      ...state(snapshot),
      mesh: fine,
      geometry: state(snapshot).geometry.map((record) => ({ ...record, meshPolicy: fine })),
    }))
    success(await materializeAssembly({ ...input, meshPolicy: fine }))
    expect(input.rebuildPinnedModel).toHaveBeenCalledTimes(2)
    const newer = { ...environment, modelingTolerancePolicyVersion: 2 }
    expect(
      await materializeAssembly({ ...input, meshPolicy: fine, contentEnvironment: newer }),
    ).toMatchObject({ ok: false, code: "pinned-rebuild-stale" })
    expect(input.rebuildPinnedModel).toHaveBeenCalledTimes(3)
  })
  it("invalidates pending cache publication on disposal and releases failed work for retry", async () => {
    const input = options()
    let finish: (() => void) | undefined
    input.rebuildPinnedModel.mockImplementation(
      (snapshot) =>
        new Promise((resolve) => {
          finish = () => resolve(state(snapshot))
        }),
    )
    const pending = materializeAssembly(input)
    await vi.waitFor(() => expect(finish).toBeDefined())
    input.cache.dispose()
    finish?.()
    expect(await pending).toMatchObject({ ok: false, code: "materialization-cache-disposed" })
    expect(await materializeAssembly(input)).toMatchObject({
      ok: false,
      code: "materialization-cache-disposed",
    })
  })
  it("uses exact revolute and prismatic drive frames from the grounded forest", async () => {
    for (const kind of ["revolute", "prismatic"] as const) {
      const input = options()
      input.document = documentSnapshotV4Schema.parse({
        ...input.document,
        assembly: {
          ...input.document.assembly,
          instances: [
            ...input.document.assembly.instances,
            {
              schemaVersion: 1,
              id: id(61),
              definitionId: id(50),
              name: "Driven block",
              grounded: false,
            },
          ],
          joints: [
            {
              schemaVersion: 1,
              id: id(70),
              kind,
              parentInstanceId: id(60),
              childInstanceId: id(61),
              parentFrame: pose,
              childFrame: pose,
              axis: [0, 0, 1],
              value: kind === "revolute" ? Math.PI / 2 : 7,
              limits: { min: 0, max: kind === "revolute" ? Math.PI / 2 : 7 },
            },
          ],
        },
      })
      const child = success(await materializeAssembly(input)).occurrences.find(
        ({ instanceId }) => instanceId === id(61),
      )
      if (kind === "prismatic") expect(child?.bounds.min).toEqual([0, 0, 7])
      else {
        expect(child?.bounds.min[0]).toBeCloseTo(-3)
        expect(child?.bounds.max[1]).toBeCloseTo(2)
      }
    }
  })
  it("rejects malformed meshes, non-finite evidence and transformed world overflow", async () => {
    const input = options()
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => {
      const rebuilt = state(snapshot)
      rebuilt.geometry[0]?.geometry.mesh.indices.fill(999)
      return rebuilt
    })
    expect(await materializeAssembly(input)).toMatchObject({
      ok: false,
      code: "pinned-geometry-invalid",
    })
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => {
      const rebuilt = state(snapshot)
      rebuilt.geometry[0]?.geometry.mesh.positions.fill(Number.NaN)
      return rebuilt
    })
    expect(await materializeAssembly(input)).toMatchObject({
      ok: false,
      code: "pinned-geometry-invalid",
    })
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => state(snapshot))
    const overflowing = documentSnapshotV4Schema.parse({
      ...input.document,
      assembly: {
        ...input.document.assembly,
        instances: input.document.assembly.instances.map((instance) => ({
          ...instance,
          worldFrame: { ...pose, translation: [100000, 0, 0] },
        })),
      },
    })
    expect(await materializeAssembly({ ...input, document: overflowing })).toMatchObject({
      ok: false,
      code: "transformed-geometry-out-of-bounds",
    })
  })
  it("rejects invalid authority before reading bytes or invoking geometry", async () => {
    const input = options()
    expect(
      await materializeAssembly({
        ...input,
        document: { ...input.document, assembly: { ...input.document.assembly, arbitrary: {} } },
      }),
    ).toMatchObject({ ok: false, code: "invalid-assembly-document" })
    expect(input.readSourceBytes).not.toHaveBeenCalled()
    expect(input.rebuildPinnedModel).not.toHaveBeenCalled()
  })
  it("copies runtime buffers before caching and keeps callback mutations outside frozen authority", async () => {
    const input = options()
    let produced: FeatureRebuildState | undefined
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => {
      produced = state(snapshot)
      return produced
    })
    success(await materializeAssembly(input))
    produced?.geometry[0]?.geometry.mesh.positions.fill(99)
    expect(
      success(await materializeAssembly(input)).occurrences[0]?.geometry.mesh.positions[0],
    ).toBe(0)
    input.cache.clear()
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => {
      Object.assign(snapshot.features[0]?.parameters ?? {}, { width: createLengthQuantity(99) })
      return state(snapshot)
    })
    expect(await materializeAssembly(input)).toMatchObject({
      ok: false,
      code: "pinned-rebuild-stale",
    })
    expect(
      input.document.assembly.definitions[0]?.pinnedModels[0]?.snapshot.features[0]?.parameters
        .width,
    ).toEqual(createLengthQuantity(2))
  })
  it("enforces the disposable cache node boundary before starting an oversized rebuild", async () => {
    const input = options()
    const pinned = input.document.assembly.definitions[0]?.pinnedModels[0]
    if (!pinned) throw new Error("Expected frozen source.")
    const build = vi.fn(async () => state(pinned.snapshot))
    await expect(input.cache.resolve("oversized", 4097, build)).rejects.toThrow("node budget")
    expect(build).not.toHaveBeenCalled()
  })
  it("rejects incomplete and mismatched successful dependency evidence", async () => {
    const input = options()
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => ({
      ...state(snapshot),
      geometry: [],
    }))
    expect(await materializeAssembly(input)).toMatchObject({
      ok: false,
      code: "pinned-geometry-invalid",
    })
    input.rebuildPinnedModel.mockImplementation(async (snapshot) => ({
      ...state(snapshot),
      geometry: state(snapshot).geometry.map((record) => ({
        ...record,
        contentHash: "f".repeat(64),
      })),
    }))
    expect(await materializeAssembly(input)).toMatchObject({
      ok: false,
      code: "pinned-geometry-invalid",
    })
  })
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required fixture evidence is missing.")
  return value
}
