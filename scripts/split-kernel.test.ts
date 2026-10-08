import { testAssetPath } from "../tests/unit/support/assets"
/// <reference path="../packages/geometry-worker/src/vite-modules.d.ts" />

import { afterEach, describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { ReplicadGeometryEngine } from "../packages/geometry-worker/src/engine"
import {
  type FeatureContentIdentity,
  type FeatureEvaluationDependency,
  featureContentIdentitySchema,
  serializeFeatureContentIdentity,
} from "../packages/protocol/src/index"
import { vi } from "../tests/unit/support/bun-test"

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
describe("Split with the pinned real OCCT kernel", () => {
  it("retains exact side roles, conserves volume, rebuilds dependents and exports independently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response(await readFile(resolve(testAssetPath(url))))),
    )
    const engine = new ReplicadGeometryEngine()
    const metadata = await engine.initialize()
    expect(metadata.opencascadePackageVersion).toBe("0.23.0")
    const documentId = "split-kernel-fixture"
    const evaluate = async (
      featureId: string,
      parameters: unknown,
      dependencies: readonly FeatureEvaluationDependency[] = [],
      featureType = type("split"),
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
    const box = { width: 20, depth: 30, height: 40, centered: false, origin: [0, 0, 0] }
    try {
      const source = requireSuccess(await evaluate(id(1), box, [], type("box")))
      const dependency = { featureId: id(1), contentHash: source.contentHash, outputRole: "result" }
      for (const [index, [plane, offset]] of (
        [
          ["XY", 10],
          ["XZ", 5],
          ["YZ", -5],
        ] as const
      ).entries()) {
        const split = requireSuccess(await evaluate(id(index + 2), { plane, offset }, [dependency]))
        expect(split.result.shape.solidCount).toBe(2)
        expect(split.result.shape.volume).toBeCloseTo(24000, 5)
        expect(split.result.bodies?.map(({ outputRole }) => outputRole)).toEqual([
          "split.negative",
          "split.positive",
        ])
        expect(
          split.result.bodies?.every(
            ({ shape, topologyCandidates }) =>
              shape.valid && shape.solidCount === 1 && topologyCandidates.length > 0,
          ),
        ).toBe(true)
        expect(split.result.bodies?.reduce((sum, { shape }) => sum + shape.volume, 0)).toBeCloseTo(
          24000,
          5,
        )
      }
      const split = requireSuccess(await evaluate(id(2), { plane: "XY", offset: 10 }, [dependency]))
      expect(split.result.cache.brepHit).toBe(true)
      expect(requireSuccess(await evaluate(id(1), box, [], type("box"))).result.shape).toEqual(
        source.result.shape,
      )
      for (const role of ["split.negative", "split.positive"]) {
        const side = { featureId: id(2), contentHash: split.contentHash, outputRole: role }
        const placed = requireSuccess(
          await evaluate(
            id(10),
            { translation: [50, 0, 0], rotation: [0, 0, 0] },
            [side],
            type("placement"),
          ),
        )
        expect(placed.result.shape.volume).toBeCloseTo(role === "split.negative" ? 6000 : 18000, 5)
        for (const format of ["step", "stl"] as const) {
          const exported = await engine.exportDocument({ documentId, features: [side], format })
          expect(exported.bodyCount).toBe(1)
          expect(exported.file.byteLength).toBeGreaterThan(100)
        }
      }
      for (const parameters of [
        { plane: "XY", offset: 0 },
        { plane: "XY", offset: 40 },
        { plane: "XY", offset: 50 },
      ])
        expect(await evaluate(id(20), parameters, [dependency])).toMatchObject({
          ok: false,
          diagnostic: { code: "invalid-feature-geometry" },
        })
      expect(
        await evaluate(id(20), { plane: "XY", offset: 10 }, [
          { ...dependency, outputRole: "body.missing" },
        ]),
      ).toMatchObject({ ok: false, diagnostic: { code: "missing-feature-dependency" } })
      expect(await evaluate(id(20), { plane: "XY", offset: 10 })).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      })
      const changed = requireSuccess(await evaluate(id(1), { ...box, height: 50 }, [], type("box")))
      const rebuilt = requireSuccess(
        await evaluate(id(2), { plane: "XY", offset: 10 }, [
          { ...dependency, contentHash: changed.contentHash },
        ]),
      )
      expect(rebuilt.contentHash).not.toBe(split.contentHash)
      expect(rebuilt.result.shape.volume).toBeCloseTo(30000, 5)
      expect(await evaluate(id(21), { plane: "XY", offset: 10 }, [dependency])).toMatchObject({
        ok: false,
        diagnostic: { code: "missing-feature-dependency" },
      })
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  }, 60_000)
})
