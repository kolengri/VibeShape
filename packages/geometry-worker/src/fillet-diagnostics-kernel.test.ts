import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { makeBox, makeSphere, type Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"
import { inspectOcctBody } from "./occt-body-validation"
import { FilletBuildError, treatAllOcctEdges, treatSelectedOcctEdges } from "./occt-edge-treatment"

const engine = new ReplicadGeometryEngine()
let occt: OpenCascadeInstance
beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  const wasm = readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(wasm))),
  )
  try {
    await engine.initialize()
    const { getOC } = await import("replicad")
    occt = getOC()
  } finally {
    vi.unstubAllGlobals()
  }
}, 60_000)
afterAll(() => expect(engine.getHealth().ownedShapeCount).toBe(0))

function edgeKeys(shape: Shape3D) {
  const edges = shape.edges
  try {
    return edges.map((edge) => edge.hashCode)
  } finally {
    for (const edge of edges) edge.delete()
  }
}

function filletFailure(build: () => Shape3D) {
  try {
    const unexpected = build()
    unexpected.delete()
    throw new Error("Expected a rejected fillet.")
  } catch (error) {
    if (!(error instanceof FilletBuildError)) throw error
    return error
  }
}

describe("real OCCT fillet failure diagnostics", () => {
  it("returns the actionable failure through the engine without caching substitute geometry", async () => {
    const documentId = "fillet-diagnostic-engine"
    const environment = engine.getFeatureContentEnvironment()
    if (!environment) throw new Error("Expected initialized geometry environment.")
    const source: FeatureEvaluationInput = {
      documentId,
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
      contentHash: "a".repeat(64),
      content: {
        schemaVersion: 0,
        environment,
        feature: {
          schemaVersion: 0,
          type: {
            moduleId: "org.vibeshape.core.part-design",
            moduleVersion: "0.1.0",
            typeId: "org.vibeshape.feature.part-design.box",
            schemaVersion: 1,
          },
          parameters: { width: 20, depth: 20, height: 20, centered: false, origin: [0, 0, 0] },
          inputs: [],
          references: [],
        },
      },
      dependencies: [],
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    }
    const fillet: FeatureEvaluationInput = {
      ...source,
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
      contentHash: "b".repeat(64),
      content: {
        schemaVersion: 0,
        environment,
        feature: {
          schemaVersion: 0,
          type: {
            ...source.content.feature.type,
            typeId: "org.vibeshape.feature.part-design.fillet",
          },
          parameters: { radius: 40 },
          inputs: [source.contentHash],
          references: [],
        },
      },
      dependencies: [{ featureId: source.featureId, contentHash: source.contentHash }],
    }
    try {
      expect((await engine.evaluateFeature(source, vi.fn())).ok).toBe(true)
      const result = await engine.evaluateFeature(fillet, vi.fn())
      expect(result).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-feature-geometry",
          message: expect.stringContaining("This tested radius is not a maximum."),
          // The document worker forwards only marked messages over the catalog advice.
          userActionable: true,
        },
      })
      expect(engine.getHealth().ownedShapeCount).toBe(1)
    } finally {
      engine.disposeDocument(documentId)
    }
  })

  it.each(["all", "selected"] as const)(
    "rejects an oversized box %s-edge radius and proves the suggested radius without changing the source",
    (scope) => {
      const source = makeBox([0, 0, 0], [20, 20, 20])
      try {
        const keys = edgeKeys(source)
        const selected = keys.slice(0, 1)
        const build = (radius: number) =>
          scope === "all"
            ? treatAllOcctEdges(occt, source, "fillet", radius)
            : treatSelectedOcctEdges(occt, source, "fillet", radius, selected)
        const error = filletFailure(() => build(40))
        expect(error.suggestedRadius).toBeGreaterThan(0)
        expect(error.suggestedRadius).toBeLessThan(40)
        expect(error.message).toContain("not a maximum")
        const explicit = build(error.suggestedRadius as number)
        try {
          const metrics = inspectOcctBody(occt, explicit)
          expect(metrics).toMatchObject({ valid: true, solidCount: 1 })
          expect(metrics.volume).toBeGreaterThan(0)
          expect(metrics.volume).toBeLessThan(8000)
        } finally {
          explicit.delete()
        }
        expect(inspectOcctBody(occt, source)).toMatchObject({ valid: true, solidCount: 1 })
        expect(inspectOcctBody(occt, source).volume).toBeCloseTo(8000, 5)
        expect(edgeKeys(source)).toEqual(keys)
      } finally {
        source.delete()
      }
    },
  )

  it("keeps the successful requested fillet geometry unchanged", () => {
    const source = makeBox([0, 0, 0], [20, 20, 20])
    try {
      const result = treatAllOcctEdges(occt, source, "fillet", 2)
      try {
        const metrics = inspectOcctBody(occt, result)
        expect(metrics).toMatchObject({ valid: true, solidCount: 1 })
        // Rounded cube: inner box, six face slabs, twelve quarter cylinders, eight sphere octants.
        const expectedVolume =
          16 ** 3 + 6 * 16 ** 2 * 2 + 3 * Math.PI * 16 * 2 ** 2 + (4 / 3) * Math.PI * 2 ** 3
        expect(metrics.volume).toBeCloseTo(expectedVolume, 6)
      } finally {
        result.delete()
      }
    } finally {
      source.delete()
    }
  })

  it("does not invent a smaller radius for an ineligible smooth sphere seam", () => {
    const source = makeSphere(10)
    try {
      const error = filletFailure(() => treatAllOcctEdges(occt, source, "fillet", 2))
      expect(error.suggestedRadius).toBeUndefined()
      expect(error.message).toContain("no eligible sharp edge contours")
      expect(inspectOcctBody(occt, source)).toMatchObject({ valid: true, solidCount: 1 })
    } finally {
      source.delete()
    }
  })

  it("does not claim that an unsuccessful bounded search proves a geometry-wide radius limit", () => {
    const source = makeBox([0, 0, 0], [20, 1, 0.1])
    try {
      const error = filletFailure(() => treatAllOcctEdges(occt, source, "fillet", 100))
      expect(error.suggestedRadius).toBeUndefined()
      expect(error.message).toContain("Bounded smaller-radius checks")
      expect(inspectOcctBody(occt, source).volume).toBeCloseTo(2, 6)
    } finally {
      source.delete()
    }
  })

  it("rejects invalid selected edges without a misleading radius suggestion", () => {
    const source = makeBox([0, 0, 0], [20, 20, 20])
    try {
      expect(() => treatSelectedOcctEdges(occt, source, "fillet", 2, [-1])).toThrow("unavailable")
      expect(inspectOcctBody(occt, source).volume).toBeCloseTo(8000, 5)
    } finally {
      source.delete()
    }
  })
})
