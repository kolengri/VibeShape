import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine()
const documentId = "fdm-exact-engine-ownership"
const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3102"
const sourceHash = "a".repeat(64),
  resultHash = "b".repeat(64)
beforeAll(async () => {
  const fs = await vi.importActual<{ readFileSync(path: URL): Uint8Array }>("node:fs")
  const bytes = fs.readFileSync(
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
function request(
  typeId: string,
  parameters: FeatureEvaluationInput["content"]["feature"]["parameters"],
  modifying = false,
): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected exact kernel environment.")
  const feature = {
    schemaVersion: 0 as const,
    type: {
      moduleId: "org.vibeshape.core.part-design",
      moduleVersion: "0.1.0",
      typeId,
      schemaVersion: 1,
    },
    parameters,
    references: [],
  }
  return {
    documentId,
    featureId: modifying ? featureId : sourceId,
    contentHash: modifying ? resultHash : sourceHash,
    content: modifying
      ? {
          schemaVersion: 1,
          feature: { ...feature, inputs: [sourceHash], inputRoles: ["result"] },
          environment,
        }
      : { schemaVersion: 0, feature: { ...feature, inputs: [] }, environment },
    dependencies: modifying
      ? [{ featureId: sourceId, contentHash: sourceHash, outputRole: "result" }]
      : [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}
const fdmType = "org.vibeshape.feature.part-design.fdm"
const source = () =>
  request("org.vibeshape.feature.part-design.box", {
    width: 20,
    depth: 20,
    height: 20,
    centered: false,
  })
const common = { axis: "Z", origin: { x: 0, y: 0, z: 0 } }
describe("registered exact FDM evaluation", () => {
  it("repeats successful modifier/cache/disposal cycles without retaining temporary shapes", async () => {
    for (let cycle = 0; cycle < 5; cycle++) {
      try {
        const base = await engine.evaluateFeature(source(), vi.fn())
        if (!base.ok) throw new Error(base.diagnostic.message)
        const input = request(
          fdmType,
          { ...common, kind: "corner-relief", radius: 2, depth: 20 },
          true,
        )
        const result = await engine.evaluateFeature(input, vi.fn())
        if (!result.ok) throw new Error(result.diagnostic.message)
        expect(result.result.shape).toMatchObject({ valid: true, solidCount: 1 })
        expect(result.result.shape.volume).toBeCloseTo(8000 - Math.PI * 4 * 20, 5)
        expect(result.result.bodies?.[0]?.outputRole).toBe("result")
        expect(
          await engine.evaluateFeature(JSON.parse(JSON.stringify(input)), vi.fn()),
        ).toMatchObject({ ok: true })
        const retained = await engine.evaluateFeature(source(), vi.fn())
        expect(retained.ok && retained.result.shape.volume).toBeCloseTo(8000, 6)
        expect(engine.getHealth().ownedShapeCount).toBe(2)
      } finally {
        engine.disposeDocument(documentId)
        expect(engine.getHealth().ownedShapeCount).toBe(0)
      }
    }
  })
  it("creates an independent coupon from canonical content after serialization", async () => {
    try {
      const input = request(fdmType, {
        ...common,
        kind: "calibration-coupon",
        diameterStart: 4,
        diameterStep: 0.2,
        holeCount: 3,
        spacing: 8,
        thickness: 3,
        margin: 2,
      })
      const result = await engine.evaluateFeature(JSON.parse(JSON.stringify(input)), vi.fn())
      expect(result).toMatchObject({ ok: true, result: { shape: { valid: true, solidCount: 1 } } })
      expect(engine.getHealth().ownedShapeCount).toBe(1)
    } finally {
      engine.disposeDocument(documentId)
    }
  })
  it("rejects malformed body roles and failed disconnected additions without taking target ownership", async () => {
    try {
      await engine.evaluateFeature(source(), vi.fn())
      const input = request(
        fdmType,
        {
          ...common,
          origin: { x: 50, y: 0, z: 0 },
          kind: "membrane",
          width: 5,
          length: 5,
          thickness: 0.2,
          mode: "sheet",
        },
        true,
      )
      const result = await engine.evaluateFeature(input, vi.fn())
      expect(result).toMatchObject({ ok: false })
      expect(engine.getHealth().ownedShapeCount).toBe(1)
      const invalid = {
        ...input,
        dependencies: [
          { featureId: sourceId, contentHash: sourceHash, outputRole: "body.missing" },
        ],
      }
      expect(await engine.evaluateFeature(invalid, vi.fn())).toMatchObject({ ok: false })
      expect(engine.getHealth().ownedShapeCount).toBe(1)
      const retained = await engine.evaluateFeature(source(), vi.fn())
      expect(retained.ok && retained.result.shape.volume).toBeCloseTo(8000, 6)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
})
