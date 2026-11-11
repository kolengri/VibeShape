import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { type CoilFeatureContentParameters, helixLength } from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine()
const documentId = "exact-coil-engine"
const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f4101"
const coilId = "0195b5ac-b220-7a2c-8c33-67a36a7f4102"
const sourceHash = "a".repeat(64)
beforeAll(async () => {
  const fs = await import("node:fs")
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

const helix = {
  origin: [0, 0, 0] as [number, number, number],
  direction: [0, 0, 1] as [number, number, number],
  handedness: "right" as const,
  radius: 10,
  pitch: 5,
  turns: 3,
  startAngle: 0,
}
function type(typeId: string, schemaVersion = 1) {
  return {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId,
    schemaVersion,
  }
}
function environment() {
  const value = engine.getFeatureContentEnvironment()
  if (!value) throw new Error("Expected exact kernel environment.")
  return value
}
function box(): FeatureEvaluationInput {
  return {
    documentId,
    featureId: sourceId,
    contentHash: sourceHash,
    content: {
      schemaVersion: 0,
      environment: environment(),
      feature: {
        schemaVersion: 0,
        type: type("org.vibeshape.feature.part-design.box"),
        parameters: { width: 24, depth: 24, height: 2.5, centered: false },
        inputs: [],
        references: [],
      },
    },
    dependencies: [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}
function coil(parameters: CoilFeatureContentParameters, hash = "b"): FeatureEvaluationInput {
  const feature = {
    schemaVersion: 0 as const,
    type: type("org.vibeshape.feature.part-design.coil"),
    parameters: JSON.parse(JSON.stringify(parameters)),
    references: [],
  }
  const modifying = parameters.operation !== "new"
  return {
    documentId,
    featureId: coilId,
    contentHash: hash.repeat(64),
    content: modifying
      ? {
          schemaVersion: 1,
          environment: environment(),
          feature: { ...feature, inputs: [sourceHash], inputRoles: ["result"] },
        }
      : { schemaVersion: 0, environment: environment(), feature: { ...feature, inputs: [] } },
    dependencies: modifying
      ? [{ featureId: sourceId, contentHash: sourceHash, outputRole: "result" }]
      : [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}
const circular = { kind: "circular" as const, diameter: 2 }

describe("registered exact Coil evaluation", () => {
  it("evaluates, caches and disposes a new-body coil with analytic volume", async () => {
    try {
      const input = coil({ helix, section: circular, operation: "new" })
      const result = await engine.evaluateFeature(JSON.parse(JSON.stringify(input)), vi.fn())
      if (!result.ok) throw new Error(result.diagnostic.message)
      const expected = Math.PI * helixLength(helix)
      expect(result.result.shape).toMatchObject({ valid: true, solidCount: 1 })
      expect(Math.abs(result.result.shape.volume - expected) / expected).toBeLessThan(2e-3)
      expect(result.result.bodies?.map(({ outputRole }) => outputRole)).toEqual(["result"])
      expect(await engine.evaluateFeature(input, vi.fn())).toMatchObject({ ok: true })
      expect(engine.getHealth().ownedShapeCount).toBe(1)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it.each([
    ["add", (target: number, tool: number) => [target, target + tool]],
    ["remove", (target: number) => [0, target]],
    ["intersect", (_target: number, tool: number) => [0, tool]],
  ] as const)("applies %s against the exact named target body", async (operation, range) => {
    try {
      const base = await engine.evaluateFeature(box(), vi.fn())
      if (!base.ok) throw new Error(base.diagnostic.message)
      const targetVolume = base.result.shape.volume
      const toolVolume = Math.PI * helixLength(helix)
      const result = await engine.evaluateFeature(
        coil(
          { helix, section: circular, operation },
          { add: "c", remove: "d", intersect: "e" }[operation],
        ),
        vi.fn(),
      )
      if (!result.ok) throw new Error(result.diagnostic.message)
      const [minimum = Number.NaN, maximum = Number.NaN] = range(targetVolume, toolVolume)
      expect(result.result.shape).toMatchObject({ valid: true })
      expect(result.result.shape.volume).toBeGreaterThan(minimum)
      expect(result.result.shape.volume).toBeLessThan(maximum)
      expect(engine.getHealth().ownedShapeCount).toBe(2)
    } finally {
      engine.disposeDocument(documentId)
    }
  })

  it("rejects missing targets and self-intersecting content without retaining shapes", async () => {
    try {
      const missing = coil({ helix, section: circular, operation: "new" })
      const modifying = { ...missing, content: { ...missing.content } }
      Object.assign(modifying.content.feature, {
        parameters: { helix, section: circular, operation: "add" },
      })
      expect(await engine.evaluateFeature(modifying, vi.fn())).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      })
      // A new-body coil with one axis producer must index that producer, not a phantom slot.
      const base = coil({ helix, section: circular, operation: "new" }, "9")
      const phantom: FeatureEvaluationInput = {
        ...base,
        content: {
          schemaVersion: 0,
          environment: environment(),
          feature: {
            ...base.content.feature,
            parameters: JSON.parse(
              JSON.stringify({ helix, section: circular, operation: "new", supportInputIndex: 3 }),
            ),
            inputs: [sourceHash],
          },
        },
        dependencies: [{ featureId: sourceId, contentHash: sourceHash }],
      }
      expect(await engine.evaluateFeature(phantom, vi.fn())).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      })
      const tight = await engine.evaluateFeature(
        coil({ helix: { ...helix, pitch: 1.5 }, section: circular, operation: "new" }, "f"),
        vi.fn(),
      )
      expect(tight).toMatchObject({ ok: false })
      expect(!tight.ok && tight.diagnostic.message).toContain("Adjacent coil turns would intersect")
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    } finally {
      engine.disposeDocument(documentId)
    }
  })
})
