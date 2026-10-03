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
describe("Mirror with the pinned real OCCT kernel", () => {
  it("reflects asymmetric bounds across all origin planes, preserves source, rebuilds dependents, fails closed and exports one body", async () => {
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
    const documentId = "mirror-kernel-fixture"
    const evaluate = async (
      featureId: string,
      parameters: unknown,
      dependencies: readonly FeatureEvaluationDependency[] = [],
      featureType = type("mirror"),
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
    const box = { width: 4, depth: 6, height: 8, centered: false, origin: [10, 20, 30] }
    try {
      const source = requireSuccess(await evaluate(id(1), box, [], type("box")))
      const dependency = { featureId: id(1), contentHash: source.contentHash, outputRole: "result" }
      const expected = [
        ["XY", [8, 17, -38], [12, 23, -30]],
        ["XZ", [8, -23, 30], [12, -17, 38]],
        ["YZ", [-12, 17, 30], [-8, 23, 38]],
      ] as const
      for (const [index, [plane, min, max]] of expected.entries()) {
        const mirrored = requireSuccess(await evaluate(id(index + 2), { plane }, [dependency]))
        expect(mirrored.result.shape.solidCount).toBe(1)
        expect(mirrored.result.shape.volume).toBeCloseTo(192, 6)
        expect(mirrored.result.bodies?.map(({ outputRole }) => outputRole)).toEqual(["result"])
        for (const axis of [0, 1, 2] as const) {
          expect(mirrored.result.shape.bounds.min[axis]).toBeCloseTo(min[axis], 6)
          expect(mirrored.result.shape.bounds.max[axis]).toBeCloseTo(max[axis], 6)
        }
      }
      const sourceAfter = requireSuccess(await evaluate(id(1), box, [], type("box")))
      expect(sourceAfter.result.shape).toEqual(source.result.shape)
      const oldMirror = requireSuccess(await evaluate(id(2), { plane: "XY" }, [dependency]))
      expect(oldMirror.result.cache.brepHit).toBe(true)
      for (const selected of [
        { ...dependency, outputRole: "body.missing" },
        { ...dependency, contentHash: "f".repeat(64) },
      ]) {
        expect(await evaluate(id(8), { plane: "XY" }, [selected])).toMatchObject({
          ok: false,
          diagnostic: { code: "missing-feature-dependency" },
        })
      }
      expect(engine.getHealth().ownedShapeCount).toBe(4)
      const rebuiltSource = await evaluate(id(1), { ...box, width: 6 }, [], type("box"))
      const rebuilt = requireSuccess(
        await evaluate(id(2), { plane: "XY" }, [
          { ...dependency, contentHash: rebuiltSource.contentHash },
        ]),
      )
      expect(rebuilt.result.shape.volume).toBeCloseTo(288, 6)
      expect(rebuilt.contentHash).not.toBe(oldMirror.contentHash)
      expect(await evaluate(id(8), { plane: "XY" }, [dependency])).toMatchObject({
        ok: false,
        diagnostic: { code: "missing-feature-dependency" },
      })
      for (const format of ["step", "stl"] as const) {
        const exported = await engine.exportDocument({
          documentId,
          features: [{ featureId: id(2), contentHash: rebuilt.contentHash, outputRole: "result" }],
          format,
        })
        expect(exported.bodyCount).toBe(1)
        expect(exported.file.byteLength).toBeGreaterThan(100)
      }
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  }, 60_000)
})
