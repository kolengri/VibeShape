// @vitest-environment node
/// <reference path="../packages/geometry-worker/src/vite-modules.d.ts" />
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReplicadGeometryEngine } from "../packages/geometry-worker/src/engine"
import {
  type FeatureContentIdentity,
  type FeatureEvaluationDependency,
  featureContentIdentitySchema,
  serializeFeatureContentIdentity,
} from "../packages/protocol/src/index"

const id = (number: number) => `0195b5ac-b220-7a2c-8c33-${String(number).padStart(12, "0")}`
function requireSuccess<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
const type = (name: string) => ({
  moduleId: "org.vibeshape.core.part-design",
  moduleVersion: "0.1.0",
  typeId: `org.vibeshape.feature.part-design.${name}`,
  schemaVersion: 1,
})
afterEach(() => vi.unstubAllGlobals())
describe("Pattern with the pinned real OCCT kernel", () => {
  it("copies linear and circular instances with stable roles and exports exact selected instances", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(await readFile(resolve(url.startsWith("/@fs/") ? url.slice(4) : `.${url}`))),
      ),
    )
    const engine = new ReplicadGeometryEngine()
    const metadata = await engine.initialize()
    expect(metadata.opencascadePackageVersion).toBe("0.23.0")
    const documentId = "pattern-engine-fixture"
    const evaluate = async (
      featureId: string,
      parameters: unknown,
      dependencies: readonly FeatureEvaluationDependency[] = [],
      featureType = type("pattern"),
    ) => {
      const content: FeatureContentIdentity = featureContentIdentitySchema.parse({
        schemaVersion: dependencies.length ? 1 : 0,
        environment: metadata.featureContentEnvironment,
        feature: {
          schemaVersion: 0,
          type: featureType,
          parameters,
          inputs: dependencies.map(({ contentHash }) => contentHash),
          references: [],
          ...(dependencies.length
            ? { inputRoles: dependencies.map(({ outputRole }) => outputRole) }
            : {}),
        },
      })
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(serializeFeatureContentIdentity(content)),
      )
      const contentHash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
      const result = await engine.evaluateFeature(
        {
          documentId,
          featureId,
          content,
          contentHash,
          dependencies: [...dependencies],
          mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
        },
        vi.fn(),
      )
      return { ...result, contentHash }
    }
    const box = { width: 2, depth: 2, height: 2, centered: false, origin: [10, 0, 0] }
    try {
      const source = requireSuccess(await evaluate(id(1), box, [], type("box")))
      const dependency = { featureId: id(1), contentHash: source.contentHash, outputRole: "result" }
      const linear = { kind: "linear", axis: "X", count: 3, spacing: -5 }
      const first = requireSuccess(await evaluate(id(2), linear, [dependency]))
      expect(first.result.bodies?.map(({ outputRole }) => outputRole)).toEqual([
        "pattern.instance.0",
        "pattern.instance.1",
        "pattern.instance.2",
      ])
      expect(first.result.shape.volume).toBeCloseTo(24, 6)
      for (const [index, value] of [9, 4, -1].entries())
        expect(first.result.bodies?.[index]?.shape.bounds.min[0]).toBeCloseTo(value, 6)
      expect(requireSuccess(await evaluate(id(2), linear, [dependency])).result.cache.brepHit).toBe(
        true,
      )
      const circular = {
        kind: "circular",
        axis: "Z",
        count: 4,
        angle: Math.PI * 2,
        center: [0, 0, 0],
      }
      const full = requireSuccess(await evaluate(id(3), circular, [dependency]))
      expect(full.result.shape.solidCount).toBe(4)
      expect(
        full.result.bodies?.map(({ shape }) =>
          shape.bounds.min.map((value) => (Math.abs(value) < 1e-6 ? 0 : Math.round(value))),
        ),
      ).toEqual([
        [9, -1, 0],
        [-1, 9, 0],
        [-11, -1, 0],
        [-1, -11, 0],
      ])
      const partial = requireSuccess(
        await evaluate(id(3), { ...circular, count: 3, angle: Math.PI }, [dependency]),
      )
      expect(partial.result.shape.solidCount).toBe(3)
      expect(partial.result.bodies?.[2]?.shape.bounds.min[0]).toBeCloseTo(-11, 6)
      expect(requireSuccess(await evaluate(id(1), box, [], type("box"))).result.shape).toEqual(
        source.result.shape,
      )
      for (const format of ["step", "stl"] as const) {
        const exported = await engine.exportDocument({
          documentId,
          features: [
            { featureId: id(2), contentHash: first.contentHash, outputRole: "pattern.instance.2" },
          ],
          format,
        })
        expect(exported.bodyCount).toBe(1)
        expect(exported.file.byteLength).toBeGreaterThan(100)
      }
      for (const format of ["step", "stl"] as const) {
        const exported = await engine.exportDocument({
          documentId,
          features: [0, 1, 2].map((index) => ({
            featureId: id(2),
            contentHash: first.contentHash,
            outputRole: `pattern.instance.${index}`,
          })),
          format,
        })
        expect(exported.bodyCount).toBe(3)
        expect(exported.file.byteLength).toBeGreaterThan(100)
      }
      const changed = requireSuccess(await evaluate(id(2), { ...linear, count: 2 }, [dependency]))
      expect(changed.result.bodies?.map(({ outputRole }) => outputRole)).toEqual([
        "pattern.instance.0",
        "pattern.instance.1",
      ])
      expect(
        await evaluate(
          id(4),
          { plane: "XY" },
          [
            {
              featureId: id(2),
              contentHash: changed.contentHash,
              outputRole: "pattern.instance.2",
            },
          ],
          type("mirror"),
        ),
      ).toMatchObject({ ok: false, diagnostic: { code: "missing-feature-dependency" } })
      expect(await evaluate(id(4), { ...linear, count: 257 }, [dependency])).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      })
      expect(await evaluate(id(4), { ...linear, spacing: 60000 }, [dependency])).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      })
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  }, 60_000)
})
