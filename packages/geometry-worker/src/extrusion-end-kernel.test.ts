import { featureEvaluationInputSchema } from "@vibeshape/protocol"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine(undefined, (references, candidates) => {
  const ids = references.map((reference) =>
    candidates.filter(
      (candidate) => JSON.stringify(candidate.signature) === JSON.stringify(reference.signature),
    ),
  )
  return ids.every((matches) => matches.length === 1)
    ? {
        ok: true,
        candidateIds: ids.flatMap((matches) => matches.map(({ candidateId }) => candidateId)),
      }
    : { ok: false, reason: "missing" }
})
const documentId = "extrusion-end-invariants"
const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3202"
const hash = "a".repeat(64)
beforeAll(async () => {
  const { readFileSync } = await vi.importActual<{ readFileSync(path: URL): Uint8Array }>("node:fs")
  const bytes = readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(bytes))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
})
afterAll(() => engine.disposeDocument(documentId))
const parameters = {
  sketchId: sourceId,
  frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  profiles: [
    {
      outer: {
        sourceEntityIds: [sourceId],
        segments: [{ entityId: sourceId, type: "circle", center: [0, 0], radius: 2 }],
      },
      holes: [],
    },
  ],
  distance: 10,
  symmetric: false,
  reversed: false,
  secondDistance: null,
  operation: "new",
  startOffset: 2,
  draftAngle: 0,
  endCondition: { kind: "distance" },
}
function request(
  changes: FeatureEvaluationInput["content"]["feature"]["parameters"],
  support = false,
): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected exact kernel environment.")
  return featureEvaluationInputSchema.parse({
    documentId,
    featureId,
    contentHash: "b".repeat(64),
    dependencies: support ? [{ featureId: sourceId, contentHash: hash, outputRole: "result" }] : [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    content: {
      schemaVersion: support ? 1 : 0,
      feature: {
        schemaVersion: 0,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.part-design.extrusion",
          schemaVersion: 6,
        },
        parameters: { ...parameters, ...changes },
        inputs: support ? [hash] : [],
        ...(support ? { inputRoles: ["result"] } : {}),
        references: [],
      },
      environment,
    },
  })
}
async function evaluate(
  changes: FeatureEvaluationInput["content"]["feature"]["parameters"],
  support = false,
) {
  const result = await engine.evaluateFeature(request(changes, support), vi.fn())
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.result
}
async function endpoint() {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected exact kernel environment.")
  const source = await engine.evaluateFeature(
    {
      documentId,
      featureId: sourceId,
      contentHash: hash,
      dependencies: [],
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      content: {
        schemaVersion: 0,
        feature: {
          schemaVersion: 0,
          type: {
            moduleId: "org.vibeshape.core.part-design",
            moduleVersion: "0.1.0",
            typeId: "org.vibeshape.feature.part-design.box",
            schemaVersion: 1,
          },
          parameters: { width: 20, depth: 20, height: 4, centered: false, origin: [0, 0, 8] },
          inputs: [],
          references: [],
        },
        environment,
      },
    },
    vi.fn(),
  )
  if (!source.ok) throw new Error(source.diagnostic.message)
  return source.result
}
describe("exact extrusion end conditions", () => {
  it("shifts both caps by the authored start offset", async () => {
    try {
      const result = await evaluate({})
      expect(result.shape.bounds.min[2]).toBeCloseTo(2, 6)
      expect(result.shape.bounds.max[2]).toBeCloseTo(12, 6)
      expect(result.shape.volume).toBeCloseTo(40 * Math.PI, 5)
    } finally {
      engine.disposeDocument(documentId)
    }
  })
  it("constructs a drafted analytic circular profile", async () => {
    try {
      const result = await evaluate({ draftAngle: Math.PI / 36 })
      expect(result.shape.valid).toBe(true)
      expect(result.shape.solidCount).toBe(1)
      expect(result.shape.volume).not.toBeCloseTo(40 * Math.PI, 4)
    } finally {
      engine.disposeDocument(documentId)
    }
  })
  it("terminates on the exact bounded planar face", async () => {
    try {
      const source = await endpoint()
      const candidate = source.topologyCandidates.find(
        ({ signature }) => signature.kind === "face" && Math.abs(signature.centroid[2] - 12) < 1e-6,
      )
      if (!candidate) throw new Error("Expected endpoint top face.")
      const face = {
        schemaVersion: 1,
        kind: "face",
        outputRole: "result",
        signature: JSON.parse(JSON.stringify(candidate.signature)),
        ...(candidate.semanticRole ? { semanticRole: candidate.semanticRole } : {}),
      }
      const result = await evaluate(
        {
          distance: 20,
          endCondition: {
            kind: "up-to-face",
            inputIndex: 0,
            outputRole: "result",
            sourceContentHash: hash,
            face,
            planeOrigin: [0, 0, 12],
            planeNormal: [0, 0, 1],
          },
        },
        true,
      )
      expect(result.shape.volume).toBeCloseTo(40 * Math.PI, 4)
      expect(result.shape.valid).toBe(true)
      expect(result.shape.bounds.max[2]).toBeCloseTo(12, 4)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
  it("terminates at the first complete body intersection and retains its support", async () => {
    try {
      await endpoint()
      const result = await evaluate(
        {
          distance: 20,
          endCondition: {
            kind: "up-to-body",
            inputIndex: 0,
            outputRole: "result",
            sourceContentHash: hash,
          },
        },
        true,
      )
      expect(result.shape.volume).toBeCloseTo(24 * Math.PI, 4)
      expect(result.shape.bounds.max[2]).toBeCloseTo(8, 4)
      expect(engine.getHealth().ownedShapeCount).toBe(2)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
  it("rejects a finite face that only partially covers the end cap", async () => {
    try {
      const source = await endpoint()
      const candidate = source.topologyCandidates.find(
        ({ signature }) => signature.kind === "face" && Math.abs(signature.centroid[2] - 12) < 1e-6,
      )
      if (!candidate) throw new Error("Expected endpoint top face.")
      const result = await engine.evaluateFeature(
        request(
          {
            distance: 20,
            frame: { ...parameters.frame, origin: [11, 0, 0] },
            endCondition: {
              kind: "up-to-face",
              inputIndex: 0,
              outputRole: "result",
              sourceContentHash: hash,
              planeOrigin: [0, 0, 12],
              planeNormal: [0, 0, 1],
              face: {
                schemaVersion: 1,
                kind: "face",
                outputRole: "result",
                signature: JSON.parse(JSON.stringify(candidate.signature)),
              },
            },
          },
          true,
        ),
        vi.fn(),
      )
      expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-geometry" } })
      expect(engine.getHealth().ownedShapeCount).toBe(1)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
  it("cuts through one exact Pattern body and leaves the sibling output unchanged", async () => {
    try {
      const source = await endpoint()
      const patternId = "0195b5ac-b220-7a2c-8c33-67a36a7f3203"
      const patternHash = "c".repeat(64)
      const environment = engine.getFeatureContentEnvironment()
      if (!environment) throw new Error("Expected exact kernel environment.")
      const patternInput = featureEvaluationInputSchema.parse({
        documentId,
        featureId: patternId,
        contentHash: patternHash,
        dependencies: [{ featureId: sourceId, contentHash: hash, outputRole: "result" }],
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
        content: {
          schemaVersion: 1,
          environment,
          feature: {
            schemaVersion: 0,
            type: {
              moduleId: "org.vibeshape.core.part-design",
              moduleVersion: "0.1.0",
              typeId: "org.vibeshape.feature.part-design.pattern",
              schemaVersion: 1,
            },
            inputs: [hash],
            inputRoles: ["result"],
            references: [],
            parameters: { kind: "linear", count: 2, axis: "X", spacing: 30 },
          },
        },
      })
      const patterned = await engine.evaluateFeature(patternInput, vi.fn())
      if (!patterned.ok) throw new Error(patterned.diagnostic.message)
      const ownedBefore = engine.getHealth().ownedShapeCount
      // Source, Pattern aggregate, and its two exact named outputs remain independently owned.
      expect(ownedBefore).toBe(4)
      const input = request(
        {
          operation: "remove",
          distance: 20,
          frame: { ...parameters.frame, origin: [30, 0, 0] },
          endCondition: {
            kind: "through-all",
            inputIndex: 0,
            outputRole: "pattern.instance.1",
            sourceContentHash: patternHash,
          },
        },
        true,
      )
      input.dependencies = [
        { featureId: patternId, contentHash: patternHash, outputRole: "pattern.instance.1" },
      ]
      input.content.feature.inputs = [patternHash]
      if (input.content.schemaVersion !== 1) throw new Error("Expected exact body identity.")
      input.content.feature.inputRoles = ["pattern.instance.1"]
      const result = await engine.evaluateFeature(input, vi.fn())
      if (!result.ok) throw new Error(result.diagnostic.message)
      expect(result.result.shape.volume).toBeCloseTo(source.shape.volume - 16 * Math.PI, 4)
      expect(result.result.shape.bounds.min[0]).toBeCloseTo(20, 5)
      const unchanged = await engine.evaluateFeature(patternInput, vi.fn())
      if (!unchanged.ok) throw new Error(unchanged.diagnostic.message)
      expect(unchanged.result.cache.brepHit).toBe(true)
      expect(unchanged.result.bodies?.map(({ shape }) => shape.volume)).toEqual([
        source.shape.volume,
        source.shape.volume,
      ])
      expect(engine.getHealth().ownedShapeCount).toBe(ownedBefore + 1)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
  it("fails closed when the endpoint misses the complete profile", async () => {
    try {
      await endpoint()
      const result = await engine.evaluateFeature(
        request(
          {
            frame: { ...parameters.frame, origin: [30, 0, 0] },
            endCondition: {
              kind: "up-to-body",
              inputIndex: 0,
              outputRole: "result",
              sourceContentHash: hash,
            },
          },
          true,
        ),
        vi.fn(),
      )
      expect(result.ok).toBe(false)
      expect(engine.getHealth().ownedShapeCount).toBe(1)
    } finally {
      engine.disposeDocument(documentId)
    }
  })
  it("rejects a mismatched endpoint hash before accessing the native source", async () => {
    try {
      await endpoint()
      const result = await engine.evaluateFeature(
        request(
          {
            endCondition: {
              kind: "through-all",
              inputIndex: 0,
              outputRole: "result",
              sourceContentHash: "c".repeat(64),
            },
          },
          true,
        ),
        vi.fn(),
      )
      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      })
      expect(engine.getHealth().ownedShapeCount).toBe(1)
    } finally {
      engine.disposeDocument(documentId)
    }
  })
})
