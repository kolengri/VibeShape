import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { featureEvaluationInputSchema } from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine(undefined, (references, candidates) => {
  const matches = references.map((reference) =>
    candidates.filter(
      (candidate) => JSON.stringify(candidate.signature) === JSON.stringify(reference.signature),
    ),
  )
  return matches.every((items) => items.length === 1)
    ? {
        ok: true,
        candidateIds: matches.flatMap((items) => items.map(({ candidateId }) => candidateId)),
      }
    : { ok: false, reason: "missing" }
})
const documentId = "curved-extrusion-worker-boundary"
const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3301"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"
const hash = "a".repeat(64)
const type = (typeId: string, schemaVersion: number) => ({
  moduleId: "org.vibeshape.core.part-design",
  moduleVersion: "0.1.0",
  typeId: `org.vibeshape.feature.part-design.${typeId}`,
  schemaVersion,
})
beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
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
async function request(changes: Record<string, unknown> = {}, version = 7) {
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
          type: type("sphere", 1),
          parameters: { radius: 4, origin: [0, 0, 8] },
          inputs: [],
          references: [],
        },
        environment,
      },
    },
    vi.fn(),
  )
  if (!source.ok) throw new Error(source.diagnostic.message)
  const candidate = source.result.topologyCandidates.find(
    ({ signature }) => signature.kind === "face" && signature.geometryClass === "SPHERE",
  )
  if (!candidate) throw new Error("Expected native spherical face evidence.")
  const face = {
    schemaVersion: 1,
    kind: "face",
    outputRole: "result",
    signature: JSON.parse(JSON.stringify(candidate.signature)),
  }
  const input: FeatureEvaluationInput = featureEvaluationInputSchema.parse({
    documentId,
    featureId,
    contentHash: "b".repeat(64),
    dependencies: [{ featureId: sourceId, contentHash: hash, outputRole: "result" }],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    content: {
      schemaVersion: 1,
      feature: {
        schemaVersion: 0,
        type: type("extrusion", version),
        inputs: [hash],
        inputRoles: ["result"],
        references: changes.supportFeatureId
          ? [
              {
                schemaVersion: 0,
                inputIndex: 0,
                kind: "face",
                signature: face.signature,
              },
            ]
          : [],
        parameters: {
          sketchId: sourceId,
          frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
          profiles: [
            {
              outer: {
                sourceEntityIds: [sourceId],
                segments: [{ entityId: sourceId, type: "circle", center: [0, 0], radius: 1 }],
              },
              holes: [],
            },
          ],
          distance: 13,
          symmetric: false,
          reversed: false,
          secondDistance: null,
          operation: "new",
          startOffset: 0,
          draftAngle: 0,
          endCondition: {
            kind: "up-to-curved-face",
            inputIndex: 0,
            outputRole: "result",
            sourceContentHash: hash,
            face,
          },
          ...changes,
        },
      },
      environment,
    },
  })
  return { input, source: source.result, face }
}
describe("curved extrusion worker boundary", () => {
  it("evaluates v7 against current exact spherical body evidence and keeps its endpoint owned", async () => {
    try {
      const { input, source } = await request()
      const result = await engine.evaluateFeature(input, vi.fn())
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.diagnostic.message)
      expect(result.result.shape).toMatchObject({ valid: true, solidCount: 1 })
      expect(result.result.shape.volume).toBeGreaterThan(4 * Math.PI)
      expect(result.result.shape.volume).toBeLessThan(4.2 * Math.PI)
      expect(result.result.shape.bounds.min[2]).toBeCloseTo(0, 6)
      expect(source.shape.volume).toBeCloseTo((256 * Math.PI) / 3, 5)
      expect(engine.getHealth().ownedShapeCount).toBe(2)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
  it.each([
    ["offset", { startOffset: 1 }, 1],
    ["drafted", { startOffset: 1, draftAngle: Math.PI / 90 }, 1],
    [
      "reversed",
      {
        reversed: true,
        distance: 17,
        frame: { origin: [0, 0, 20], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
      },
      8 + Math.sqrt(15),
    ],
    ["shared support", { supportFeatureId: sourceId }, 0],
  ] as const)("retains exact %s geometry with complete caps", async (_name, changes, minimum) => {
    try {
      const { input } = await request(changes)
      const result = await engine.evaluateFeature(input, vi.fn())
      if (!result.ok) throw new Error(result.diagnostic.message)
      expect(result.result.shape).toMatchObject({ valid: true, solidCount: 1 })
      expect(result.result.shape.bounds.min[2]).toBeCloseTo(minimum, 5)
      expect(result.result.shape.volume).toBeGreaterThan(0)
      expect(engine.getHealth().ownedShapeCount).toBe(2)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
  it.each(["stale", "wrong-role", "partial", "legacy"] as const)(
    "rejects %s evidence without retaining a failed result",
    async (failure) => {
      try {
        const { input, face } = await request({}, failure === "legacy" ? 6 : 7)
        if (failure === "stale" || failure === "wrong-role") {
          input.content.feature.parameters.endCondition = {
            kind: "up-to-curved-face",
            inputIndex: 0,
            sourceContentHash: failure === "stale" ? "c".repeat(64) : hash,
            outputRole: failure === "wrong-role" ? "pattern.instance.1" : "result",
            face,
          }
        }
        if (failure === "partial") {
          input.content.feature.parameters.frame = {
            origin: [4, 0, 0],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
            normal: [0, 0, 1],
          }
        }
        const result = await engine.evaluateFeature(input, vi.fn())
        expect(result).toMatchObject({ ok: false })
        expect(engine.getHealth().ownedShapeCount).toBe(1)
      } finally {
        engine.disposeDocument(documentId)
        expect(engine.getHealth().ownedShapeCount).toBe(0)
      }
    },
  )
})
