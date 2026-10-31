import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import {
  type ConnectMountsFeatureContentParameters,
  featureEvaluationEngineResultSchema,
} from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine()
const documentId = "exact-connect-mounts"
const parameters: ConnectMountsFeatureContentParameters = {
  points: [
    [0, 0, 0],
    [30, 0, 0],
  ],
  nodeRadius: 4,
  strutRadius: 2,
  connectionMode: "tree",
}
beforeAll(async () => {
  const filesystem = await import("node:fs")
  const wasmBinary = filesystem.readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(wasmBinary))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
})
afterAll(() => engine.disposeDocument(documentId))
function request(input: ConnectMountsFeatureContentParameters, hash = "a"): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected initialized exact kernel")
  return {
    documentId,
    featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
    contentHash: hash.repeat(64),
    content: {
      schemaVersion: 0,
      environment,
      feature: {
        schemaVersion: 0,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.part-design.connect-mounts",
          schemaVersion: 1,
        },
        parameters: input,
        inputs: [],
        references: [],
      },
    },
    dependencies: [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}
async function evaluate(input: ConnectMountsFeatureContentParameters, hash = "a") {
  const evaluated = await engine.evaluateFeature(request(input, hash), vi.fn())
  if (!evaluated.ok) throw new Error(evaluated.diagnostic.message)
  const parsed = featureEvaluationEngineResultSchema.safeParse(evaluated.result)
  if (!parsed.success) throw new Error(parsed.error.message)
  expect(evaluated.result.shape).toMatchObject({ valid: true, solidCount: 1 })
  expect(evaluated.result.shape.volume).toBeGreaterThan(0)
  expect(evaluated.result.mesh.indices.length).toBeGreaterThan(0)
  expect(evaluated.result.bodies?.map(({ outputRole }) => outputRole)).toEqual(["result"])
  return evaluated.result
}

describe("real exact Connect Mounts evaluation", () => {
  it("matches analytic capsule union volume and bounds, caches, and rebuilds", async () => {
    try {
      const first = await evaluate(parameters)
      // Two complete spheres and the cylinder, minus both spherical/cylinder overlaps.
      const r = 4,
        s = 2,
        length = 30,
        offset = Math.sqrt(r * r - s * s)
      const expected = (4 * Math.PI * (r ** 3 + offset ** 3)) / 3 + Math.PI * s ** 2 * length
      expect(first.shape.volume).toBeCloseTo(expected, 5)
      for (let axis = 0; axis < 3; axis += 1) {
        expect(first.shape.bounds.min[axis]).toBeCloseTo(-4, 5)
        expect(first.shape.bounds.max[axis]).toBeCloseTo(axis === 0 ? 34 : 4, 5)
      }
      expect(first.cache.brepHit).toBe(false)
      const cached = await evaluate(parameters)
      expect(cached.cache.brepHit).toBe(true)
      expect(engine.getHealth().ownedShapeCount).toBe(1)
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
      const rebuilt = await evaluate(parameters)
      expect(rebuilt.cache.brepHit).toBe(false)
      expect(rebuilt.shape.volume).toBeCloseTo(first.shape.volume, 7)
    } finally {
      engine.disposeDocument(documentId)
    }
  })

  it.each([
    {
      points: [
        [2, -4, 6],
        [5, 0, 18],
      ],
      nodeRadius: 2,
      strutRadius: 1,
      connectionMode: "tree",
    },
    {
      points: [
        [0, 0, 0],
        [30, 0, 0],
        [0, 20, 10],
        [12, 10, -18],
      ],
      nodeRadius: 4,
      strutRadius: 2,
      connectionMode: "tree",
    },
    {
      points: [
        [0, 0, 0],
        [30, 0, 0],
        [0, 20, 10],
        [12, 10, -18],
      ],
      nodeRadius: 4,
      strutRadius: 2,
      connectionMode: "complete",
    },
    {
      points: [
        [0, 0, 0],
        [0, 0, -30],
      ],
      nodeRadius: 4,
      strutRadius: 4,
      connectionMode: "tree",
    },
    {
      points: [
        [0, 0, 0],
        [0.001, 0, 0],
      ],
      nodeRadius: 0.001,
      strutRadius: 0.001,
      connectionMode: "tree",
    },
    {
      points: Array.from({ length: 16 }, (_, i) => [i * 3, 0, 0]),
      nodeRadius: 1,
      strutRadius: 0.5,
      connectionMode: "tree",
    },
    {
      points: Array.from({ length: 16 }, (_, i) => [i * 3, 0, 0]),
      nodeRadius: 1,
      strutRadius: 0.5,
      connectionMode: "complete",
    },
    {
      points: [
        [99_966, 0, 0],
        [99_995.999, 0, 0],
      ],
      nodeRadius: 4,
      strutRadius: 2,
      connectionMode: "tree",
    },
  ] satisfies ConnectMountsFeatureContentParameters[])(
    "builds a single solid for %j",
    async (input) => {
      try {
        await evaluate(input)
      } finally {
        engine.disposeDocument(documentId)
        expect(engine.getHealth().ownedShapeCount).toBe(0)
      }
    },
    30_000,
  )

  it("adds material for complete connections and changed radii without reusing old geometry", async () => {
    const treeInput: ConnectMountsFeatureContentParameters = {
      ...parameters,
      points: [
        [0, 0, 0],
        [30, 0, 0],
        [0, 20, 0],
      ],
    }
    try {
      const tree = await evaluate(treeInput)
      const complete = await evaluate({ ...treeInput, connectionMode: "complete" }, "b")
      const thicker = await evaluate({ ...treeInput, strutRadius: 3 }, "c")
      expect(complete.shape.volume).toBeGreaterThan(tree.shape.volume)
      expect(thicker.shape.volume).toBeGreaterThan(tree.shape.volume)
      expect(complete.cache.brepHit).toBe(false)
      expect(thicker.cache.brepHit).toBe(false)
    } finally {
      engine.disposeDocument(documentId)
    }
  })

  it("releases the exact body after each repeated rebuild and disposal", async () => {
    for (let i = 0; i < 25; i += 1) {
      await evaluate(parameters)
      expect(engine.getHealth().ownedShapeCount).toBe(1)
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
})
