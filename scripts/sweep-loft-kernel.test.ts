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
describe("Sweep and Loft with the pinned real OCCT kernel", () => {
  it("evaluates analytical curves, caches exact identities, rejects invalid supports and exports exact solids", async () => {
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
    const documentId = "sweep-loft-engine-fixture"
    const evaluate = async (
      featureId: string,
      parameters: unknown,
      dependencies: readonly FeatureEvaluationDependency[] = [],
      featureType = type("loft"),
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
    const frame = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }
    const section = (sketchId: string, z: number, radius: number) => ({
      sketchId,
      frame: { ...frame, origin: [0, 0, z] },
      outer: {
        sourceEntityIds: [id(100)],
        segments: [{ entityId: id(100), type: "circle", center: [0, 0], radius }],
      },
      holes: [],
    })
    const loftParameters = {
      sections: [section(id(50), 0, 2), section(id(51), 10, 2)],
      ruled: false,
    }
    const sweepParameters = {
      profile: {
        ...section(id(60), 0, 2),
        frame: { ...frame, yAxis: [0, 0, -1], normal: [0, 1, 0] },
      },
      path: {
        sketchId: id(61),
        frame,
        sourceEntityIds: [id(101)],
        startPointId: id(102),
        segments: [
          {
            entityId: id(101),
            type: "line",
            startPointId: id(102),
            endPointId: id(103),
            start: [0, 0],
            end: [0, 10],
          },
        ],
      },
    }
    try {
      for (const [featureId, name, parameters] of [
        [id(1), "loft", loftParameters],
        [id(2), "sweep", sweepParameters],
      ] as const) {
        const result = requireSuccess(await evaluate(featureId, parameters, [], type(name)))
        expect(result.result.shape.valid).toBe(true)
        expect(result.result.shape.solidCount).toBe(1)
        expect(result.result.shape.volume).toBeCloseTo(Math.PI * 40, 5)
        expect(result.result.bodies?.map(({ outputRole }) => outputRole)).toEqual(["result"])
        const cached = requireSuccess(await evaluate(featureId, parameters, [], type(name)))
        expect(cached.result.cache.brepHit).toBe(true)
        for (const format of ["step", "stl"] as const) {
          const output = await engine.exportDocument({
            documentId,
            features: [{ featureId, contentHash: result.contentHash, outputRole: "result" }],
            format,
          })
          expect(output.bodyCount).toBe(1)
          expect(output.file.byteLength).toBeGreaterThan(100)
        }
      }
      const changed = requireSuccess(
        await evaluate(id(1), {
          ...loftParameters,
          sections: [section(id(50), 0, 2), section(id(51), 20, 2)],
        }),
      )
      expect(changed.result.cache.brepHit).toBe(false)
      expect(changed.result.shape.volume).toBeCloseTo(Math.PI * 80, 5)
      expect(
        await evaluate(id(3), {
          ...loftParameters,
          sections: [section(id(50), 0, 2), section(id(51), 0, 2)],
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-geometry" } })
      expect(
        await evaluate(id(3), {
          ...loftParameters,
          sections: [
            { ...section(id(50), 0, 2), supportFeatureId: id(90) },
            section(id(51), 10, 2),
          ],
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-parameters" } })
      expect(
        await evaluate(
          id(4),
          { ...sweepParameters, profile: { ...sweepParameters.profile, frame } },
          [],
          type("sweep"),
        ),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-parameters" } })
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  }, 60_000)
})
