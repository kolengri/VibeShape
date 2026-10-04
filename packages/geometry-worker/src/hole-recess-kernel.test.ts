import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine()
const documentId = "exact-hole-recesses"
const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3102"
const sourceHash = "a".repeat(64)
const resultHash = "b".repeat(64)
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
function request(
  typeId: string,
  schemaVersion: number,
  parameters: FeatureEvaluationInput["content"]["feature"]["parameters"],
  modifying = false,
): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected exact kernel environment.")
  return {
    documentId,
    featureId: modifying ? featureId : sourceId,
    contentHash: modifying ? resultHash : sourceHash,
    content: modifying
      ? {
          schemaVersion: 1,
          feature: {
            schemaVersion: 0,
            type: {
              moduleId: "org.vibeshape.core.part-design",
              moduleVersion: "0.1.0",
              typeId,
              schemaVersion,
            },
            parameters,
            inputs: [sourceHash],
            inputRoles: ["result"],
            references: [],
          },
          environment,
        }
      : {
          schemaVersion: 0,
          feature: {
            schemaVersion: 0,
            type: {
              moduleId: "org.vibeshape.core.part-design",
              moduleVersion: "0.1.0",
              typeId,
              schemaVersion,
            },
            parameters,
            inputs: [],
            references: [],
          },
          environment,
        },
    dependencies: modifying
      ? [{ featureId: sourceId, contentHash: sourceHash, outputRole: "result" }]
      : [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}
const base = {
  frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  centers: [[0, 0, 20]],
  diameter: 4,
  direction: "reverse",
  extent: "through-all",
}
describe("exact hole recess evaluation", () => {
  it.each([
    { kind: "counterbore", diameter: 8, depth: 3 },
    { kind: "countersink", diameter: 8, angle: Math.PI / 2 },
  ] as const)("cuts an exact $kind and retains the cached target", async (treatment) => {
    try {
      const source = await engine.evaluateFeature(
        request("org.vibeshape.feature.part-design.box", 1, {
          width: 20,
          depth: 20,
          height: 20,
          centered: false,
        }),
        vi.fn(),
      )
      if (!source.ok) throw new Error(source.diagnostic.message)
      const result = await engine.evaluateFeature(
        request("org.vibeshape.feature.part-design.hole", 3, { ...base, treatment }, true),
        vi.fn(),
      )
      if (!result.ok) throw new Error(result.diagnostic.message)
      const additional =
        treatment.kind === "counterbore"
          ? Math.PI * (4 ** 2 - 2 ** 2) * 3
          : (Math.PI * 2 * (4 ** 2 + 4 * 2 + 2 ** 2)) / 3 - Math.PI * 2 ** 2 * 2
      expect(result.result.shape.volume).toBeCloseTo(8000 - Math.PI * 2 ** 2 * 20 - additional, 5)
      expect(result.result.shape.solidCount).toBe(1)
      expect(result.result.shape.valid).toBe(true)
      const reread = await engine.evaluateFeature(
        request("org.vibeshape.feature.part-design.box", 1, {
          width: 20,
          depth: 20,
          height: 20,
          centered: false,
        }),
        vi.fn(),
      )
      expect(reread.ok && reread.result.shape.volume).toBeCloseTo(8000, 6)
      expect(engine.getHealth().ownedShapeCount).toBe(2)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
  it("rejects a recess outside the entry face and releases its failed result", async () => {
    await engine.evaluateFeature(
      request("org.vibeshape.feature.part-design.box", 1, {
        width: 20,
        depth: 20,
        height: 20,
        centered: false,
      }),
      vi.fn(),
    )
    try {
      const result = await engine.evaluateFeature(
        request(
          "org.vibeshape.feature.part-design.hole",
          3,
          {
            ...base,
            centers: [[0, 0, 25]],
            treatment: { kind: "counterbore", diameter: 8, depth: 2 },
          },
          true,
        ),
        vi.fn(),
      )
      expect(result).toMatchObject({ ok: false })
      expect(engine.getHealth().ownedShapeCount).toBe(1)
    } finally {
      engine.disposeDocument(documentId)
    }
  })
})
