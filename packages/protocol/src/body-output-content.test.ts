import { describe, expect, it } from "vitest"
import {
  featureContentIdentitySchema,
  featureEvaluationEngineResultSchema,
  featureEvaluationInputSchema,
  GEOMETRY_PROTOCOL_VERSION,
  geometryWorkerRequestSchema,
} from "./geometry-worker"

const environment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "spike-2",
    kernelId: "org.opencascade.occt",
    kernelVersion: "0.23.0",
    kernelSourceRevision: null,
  },
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
} as const

const featureType = {
  moduleId: "org.vibeshape.core.part-design",
  moduleVersion: "0.1.0",
  typeId: "org.vibeshape.feature.part-design.boolean",
  schemaVersion: 1,
} as const

const inputHashes = ["a".repeat(64), "b".repeat(64)] as const
const dependencyIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
] as const
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3103"

const bodyShape = {
  valid: true,
  volume: 1,
  surfaceArea: 6,
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  faceCount: 6,
  edgeCount: 12,
  solidCount: 1,
} as const

function bodyResult(overrides: Record<string, unknown> = {}) {
  const mesh = {
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 0, 1]),
    indices: new Uint32Array([0, 0, 0]),
    triangleFaceIds: new Uint32Array([1]),
  }
  const topologyCandidates = [] as const
  return {
    engine: {
      adapter: "replicad",
      adapterVersion: "spike-2",
      replicadVersion: "0.23.1",
      opencascadePackageVersion: "0.23.0",
      opencascadeSourceRevision: null,
      wasmBytes: 1,
      initializedInMs: 1,
      featureContentEnvironment: environment,
    },
    shape: bodyShape,
    topologyCandidates,
    mesh,
    bodies: [{ outputRole: "result", shape: bodyShape, mesh, topologyCandidates }],
    cache: { brepHit: false },
    timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
    ...overrides,
  }
}

const v1Content = {
  schemaVersion: 1,
  feature: {
    schemaVersion: 0,
    type: featureType,
    parameters: { operation: "subtract" },
    inputs: inputHashes,
    inputRoles: ["body.primary", null],
    references: [],
  },
  environment,
} as const

function request(content: unknown = v1Content) {
  return {
    protocolVersion: GEOMETRY_PROTOCOL_VERSION,
    requestId: "request-1",
    documentId: "document-1",
    revision: 0,
    generation: 1,
    type: "evaluateFeature" as const,
    featureId,
    content,
    contentHash: "c".repeat(64),
    dependencies: [
      { featureId: dependencyIds[0], contentHash: inputHashes[0], outputRole: "body.primary" },
      { featureId: dependencyIds[1], contentHash: inputHashes[1] },
    ],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}

describe("body output role protocol", () => {
  it("accepts a mixed named and whole-result v1 input list", () => {
    expect(geometryWorkerRequestSchema.safeParse(request()).success).toBe(true)
  })

  it("validates direct evaluation inputs and strips the worker envelope", () => {
    const parsed = featureEvaluationInputSchema.parse(request())
    expect(parsed).toEqual({
      documentId: "document-1",
      featureId,
      content: v1Content,
      contentHash: "c".repeat(64),
      dependencies: request().dependencies,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    })
    expect(
      featureEvaluationInputSchema.safeParse({
        ...parsed,
        dependencies: [
          { ...parsed.dependencies[0], contentHash: "d".repeat(64) },
          parsed.dependencies[1],
        ],
      }).success,
    ).toBe(false)
    expect(
      featureEvaluationInputSchema.safeParse({
        ...parsed,
        dependencies: [
          { ...parsed.dependencies[0], outputRole: "body.secondary" },
          parsed.dependencies[1],
        ],
      }).success,
    ).toBe(false)
  })

  it("validates the derived body catalog and preserves the root aliases", () => {
    const result = bodyResult()
    expect(featureEvaluationEngineResultSchema.safeParse(result).success).toBe(true)
    expect(result.bodies[0]?.mesh).toBe(result.mesh)
    expect(result.bodies[0]?.topologyCandidates).toBe(result.topologyCandidates)
    expect(
      featureEvaluationEngineResultSchema.safeParse({
        ...result,
        bodies: [{ ...result.bodies[0], outputRole: "result" }, { ...result.bodies[0] }],
      }).success,
    ).toBe(false)
    expect(
      featureEvaluationEngineResultSchema.safeParse({
        ...result,
        bodies: [{ ...result.bodies[0], shape: { ...bodyShape, solidCount: 2 } }],
      }).success,
    ).toBe(false)
    expect(
      featureEvaluationEngineResultSchema.safeParse({
        ...result,
        bodies: [{ ...result.bodies[0], mesh: { ...result.mesh, positions: [] } }],
      }).success,
    ).toBe(false)
    expect(
      featureEvaluationEngineResultSchema.safeParse({
        ...result,
        bodies: Array.from({ length: 257 }, (_, index) => ({
          ...result.bodies[0],
          outputRole: `body.${index}`,
        })),
        shape: { ...bodyShape, solidCount: 257 },
      }).success,
    ).toBe(false)
  })

  it("requires a non-empty, bounded role list with at least one named input", () => {
    expect(
      featureContentIdentitySchema.safeParse({
        ...v1Content,
        feature: { ...v1Content.feature, inputRoles: [] },
      }).success,
    ).toBe(false)
    expect(
      featureContentIdentitySchema.safeParse({
        ...v1Content,
        feature: { ...v1Content.feature, inputRoles: [null, null] },
      }).success,
    ).toBe(false)
    expect(
      featureContentIdentitySchema.safeParse({
        ...v1Content,
        feature: { ...v1Content.feature, inputRoles: ["body.primary"] },
      }).success,
    ).toBe(false)
    expect(
      featureContentIdentitySchema.safeParse({
        ...v1Content,
        feature: { ...v1Content.feature, inputRoles: ["Body.Primary", null] },
      }).success,
    ).toBe(false)
    expect(
      featureContentIdentitySchema.safeParse({
        ...v1Content,
        feature: { ...v1Content.feature, inputRoles: ["a".repeat(129), null] },
      }).success,
    ).toBe(false)
    expect(
      featureContentIdentitySchema.safeParse({
        ...v1Content,
        feature: (() => {
          const { inputRoles: _inputRoles, ...feature } = v1Content.feature
          return feature
        })(),
      }).success,
    ).toBe(false)
    for (const invalidRole of ["", " "]) {
      expect(
        featureContentIdentitySchema.safeParse({
          ...v1Content,
          feature: { ...v1Content.feature, inputRoles: [invalidRole, null] },
        }).success,
      ).toBe(false)
    }
  })

  it("keeps v0 backward compatible while rejecting injected output roles", () => {
    const v0 = {
      schemaVersion: 0,
      feature: {
        schemaVersion: 0,
        type: { ...featureType, typeId: "org.vibeshape.feature.part-design.box" },
        parameters: { width: 20, depth: 30, height: 25.4, centered: true },
        inputs: [],
        references: [],
      },
      environment,
    } as const

    expect(featureContentIdentitySchema.safeParse(v0).success).toBe(true)
    expect(
      featureContentIdentitySchema.safeParse({
        ...v0,
        feature: { ...v0.feature, inputRoles: [] },
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request(v0),
        dependencies: [],
      }).success,
    ).toBe(true)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request(v0),
        dependencies: [
          { featureId: dependencyIds[0], contentHash: inputHashes[0], outputRole: "body.primary" },
        ],
      }).success,
    ).toBe(false)
    const v0WithInput = {
      ...v0,
      feature: { ...v0.feature, inputs: [inputHashes[0]] },
    }
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request(v0WithInput),
        dependencies: [
          { featureId: dependencyIds[0], contentHash: inputHashes[0], outputRole: "body.primary" },
        ],
      }).success,
    ).toBe(false)
    expect(
      featureEvaluationInputSchema.safeParse({
        ...request(v0WithInput),
        dependencies: [
          { featureId: dependencyIds[0], contentHash: inputHashes[0], outputRole: "body.primary" },
        ],
      }).success,
    ).toBe(false)
  })

  it("rejects missing, swapped, or same-hash wrong roles", () => {
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request(),
        dependencies: [
          { featureId: dependencyIds[0], contentHash: inputHashes[0] },
          request().dependencies[1],
        ],
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request(),
        dependencies: request().dependencies.map((dependency) => ({
          ...dependency,
          outputRole: dependency.outputRole === undefined ? "body.primary" : undefined,
        })),
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request(),
        dependencies: request().dependencies.map((dependency) => ({
          ...dependency,
          outputRole: dependency.outputRole === undefined ? "body.primary" : "body.secondary",
        })),
      }).success,
    ).toBe(false)
    for (const outputRole of [null, "", " ", "a".repeat(129)]) {
      expect(
        geometryWorkerRequestSchema.safeParse({
          ...request(),
          dependencies: [{ ...request().dependencies[0], outputRole }, request().dependencies[1]],
        }).success,
      ).toBe(false)
    }
  })
})
