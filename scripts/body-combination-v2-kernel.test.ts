// @vitest-environment node
/// <reference path="../packages/geometry-worker/src/vite-modules.d.ts" />
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { ReplicadGeometryEngine } from "../packages/geometry-worker/src/engine"
import {
  type FeatureEvaluationDependency,
  featureContentIdentitySchema,
  featureEvaluationInputSchema,
  serializeFeatureContentIdentity,
} from "../packages/protocol/src/index"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const outputRoles = [700, 701].map((n) => `body.${id(n)}`)
let engine: ReplicadGeometryEngine
let metadata: Awaited<ReturnType<ReplicadGeometryEngine["initialize"]>>
const documentId = "body-combination-v2-kernel"
function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
async function hash(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")
}
type Slot = { inputIndex: number; contentHash: string; outputRole: string }
async function evaluate(
  name: string,
  featureId: string,
  parameters: unknown,
  dependencies: readonly FeatureEvaluationDependency[] = [],
  inputSlots?: Slot[],
  source?: Parameters<ReplicadGeometryEngine["evaluateFeature"]>[2],
) {
  const content = featureContentIdentitySchema.parse({
    schemaVersion: inputSlots ? 2 : dependencies.length ? 1 : 0,
    environment: metadata.featureContentEnvironment,
    feature: {
      schemaVersion: 0,
      type: {
        moduleId: "org.vibeshape.core.part-design",
        moduleVersion: "0.1.0",
        typeId: `org.vibeshape.feature.part-design.${name}`,
        schemaVersion: inputSlots ? 2 : 1,
      },
      parameters,
      inputs: dependencies.map(({ contentHash }) => contentHash),
      references: [],
      ...(inputSlots
        ? { inputSlots }
        : dependencies.length
          ? { inputRoles: dependencies.map(({ outputRole }) => outputRole) }
          : {}),
    },
  })
  const contentHash = await hash(new TextEncoder().encode(serializeFeatureContentIdentity(content)))
  const input = featureEvaluationInputSchema.parse({
    documentId,
    featureId,
    content,
    contentHash,
    dependencies,
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  })
  return { ...(await engine.evaluateFeature(input, vi.fn(), source)), input, contentHash }
}
async function pattern(spacing = 3, count = 2) {
  const box = success(
    await evaluate("box", id(1), {
      width: 4,
      depth: 4,
      height: 4,
      centered: false,
      origin: [0, 0, 0],
    }),
  )
  const producer = success(
    await evaluate("pattern", id(2), { kind: "linear", axis: "X", count, spacing }, [
      { featureId: id(1), contentHash: box.contentHash, outputRole: "result" },
    ]),
  )
  return { box, producer, dependency: { featureId: id(2), contentHash: producer.contentHash } }
}
function slots(contentHash: string, roles = ["pattern.instance.0", "pattern.instance.1"]): Slot[] {
  return roles.map((outputRole) => ({ inputIndex: 0, contentHash, outputRole }))
}
beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(await readFile(resolve(url.startsWith("/@fs/") ? url.slice(4) : `.${url}`))),
    ),
  )
  engine = new ReplicadGeometryEngine()
  metadata = await engine.initialize()
  expect(metadata.opencascadePackageVersion).toBe("0.23.0")
}, 60_000)
afterEach(() => {
  engine.disposeDocument(documentId)
  expect(engine.getHealth().ownedShapeCount).toBe(0)
})
afterAll(() => vi.unstubAllGlobals())
describe("same-producer exact body combinations with pinned OCCT", () => {
  it("copies both ordered Pattern bodies into Compound, exports them and preserves the cached producer", async () => {
    const { producer, dependency } = await pattern(10)
    const combined = success(
      await evaluate(
        "compound",
        id(5),
        { outputRoles },
        [dependency],
        slots(producer.contentHash).reverse(),
      ),
    )
    expect(combined.result.shape).toMatchObject({ valid: true, solidCount: 2 })
    expect(combined.result.shape.volume).toBeCloseTo(128, 5)
    expect(combined.result.bodies?.map(({ outputRole }) => outputRole)).toEqual(outputRoles)
    expect(combined.result.bodies?.[0]?.shape.bounds.min[0]).toBeCloseTo(8, 5)
    expect(combined.result.bodies?.[1]?.shape.bounds.min[0]).toBeCloseTo(-2, 5)
    const before = producer.result.bodies?.map(({ shape }) => shape)
    expect((await pattern(10)).producer.result.bodies?.map(({ shape }) => shape)).toEqual(before)
    expect(
      success(await engine.evaluateFeature(combined.input, vi.fn())).result.cache.brepHit,
    ).toBe(true)
    for (const format of ["step", "stl"] as const) {
      const exported = await engine.exportDocument({
        documentId,
        features: outputRoles.map((outputRole) => ({
          featureId: id(5),
          contentHash: combined.contentHash,
          outputRole,
        })),
        format,
      })
      expect(exported.bodyCount).toBe(2)
      expect(exported.file.byteLength).toBeGreaterThan(100)
    }
  })
  it("fuses overlapping Pattern instances as one Union without changing either source body", async () => {
    const { producer, dependency } = await pattern()
    const joined = success(
      await evaluate("union", id(5), {}, [dependency], slots(producer.contentHash)),
    )
    expect(joined.result.shape).toMatchObject({ valid: true, solidCount: 1 })
    expect(joined.result.shape.volume).toBeCloseTo(112, 5)
    expect((await pattern()).producer.result.shape).toEqual(producer.result.shape)
    const exported = await engine.exportDocument({
      documentId,
      features: [{ featureId: id(5), contentHash: joined.contentHash, outputRole: "result" }],
      format: "step",
    })
    expect(exported.bodyCount).toBe(1)
  })
  it("allows disjoint Compound bodies but rejects a disconnected Union atomically", async () => {
    const { producer, dependency } = await pattern(10)
    const before = engine.getHealth().ownedShapeCount
    expect(
      await evaluate("union", id(5), {}, [dependency], slots(producer.contentHash)),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-geometry" } })
    expect(engine.getHealth().ownedShapeCount).toBe(before)
    expect((await pattern(10)).producer.result.shape).toEqual(producer.result.shape)
  })
  it("rejects an unavailable or stale body slot before returning a cached Compound", async () => {
    const { producer, dependency } = await pattern(10)
    const combined = success(
      await evaluate("compound", id(5), { outputRoles }, [dependency], slots(producer.contentHash)),
    )
    if (combined.input.content.schemaVersion !== 2) throw new Error("Expected ordered content")
    const changedSlots = combined.input.content.feature.inputSlots.map((slot, index) =>
      index ? { ...slot, outputRole: "pattern.instance.99" } : slot,
    )
    const badRole = {
      ...combined.input,
      content: {
        ...combined.input.content,
        feature: { ...combined.input.content.feature, inputSlots: changedSlots },
      },
    }
    expect(await engine.evaluateFeature(badRole, vi.fn())).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-feature-dependency" },
    })
    await pattern(10, 3)
    expect(await engine.evaluateFeature(combined.input, vi.fn())).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-feature-dependency" },
    })
  })
  it("resolves both Split sides from one producer and fuses them back to the original solid", async () => {
    const box = success(
      await evaluate("box", id(1), {
        width: 4,
        depth: 4,
        height: 4,
        centered: false,
        origin: [0, 0, 0],
      }),
    )
    const split = success(
      await evaluate("split", id(2), { plane: "XY", offset: 2 }, [
        { featureId: id(1), contentHash: box.contentHash, outputRole: "result" },
      ]),
    )
    const joined = success(
      await evaluate(
        "union",
        id(5),
        {},
        [{ featureId: id(2), contentHash: split.contentHash }],
        slots(split.contentHash, ["split.positive", "split.negative"]),
      ),
    )
    expect(joined.result.shape).toMatchObject({ valid: true, solidCount: 1 })
    expect(joined.result.shape.volume).toBeCloseTo(64, 5)
  })
  it("preserves interleaved bodies from multiple unique producers", async () => {
    const { producer, dependency } = await pattern(10)
    const extra = success(
      await evaluate("box", id(3), {
        width: 2,
        depth: 2,
        height: 2,
        centered: false,
        origin: [20, 0, 0],
      }),
    )
    const combined = success(
      await evaluate(
        "compound",
        id(5),
        { outputRoles: [...outputRoles, `body.${id(702)}`] },
        [dependency, { featureId: id(3), contentHash: extra.contentHash }],
        [
          slots(producer.contentHash)[1],
          { inputIndex: 1, contentHash: extra.contentHash, outputRole: "result" },
          slots(producer.contentHash)[0],
        ].filter((value) => value !== undefined),
      ),
    )
    expect(combined.result.shape.volume).toBeCloseTo(136, 5)
    expect(combined.result.bodies?.map(({ shape }) => Math.round(shape.bounds.min[0]))).toEqual([
      8, 19, -2,
    ])
  })
  it("uses both exact outputs of an immutable multi-body STEP import", async () => {
    const { producer, dependency } = await pattern(10)
    const exported = await engine.exportDocument({
      documentId,
      features: slots(producer.contentHash).map(({ outputRole }) => ({
        ...dependency,
        outputRole,
      })),
      format: "step",
    })
    const bytes = Uint8Array.from(exported.file)
    const source = {
      format: "step" as const,
      digest: await hash(bytes),
      byteLength: bytes.byteLength,
      normalization: {
        sourceUnit: "millimeter" as const,
        scaleToMillimeters: 1,
        normalizedUnit: "millimeter" as const,
      },
      unitPolicy: "step-system-mm" as const,
      readerPolicyVersion: 1 as const,
    }
    const inspection = await engine.inspectSourceImport({
      source,
      bytes,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    })
    const outputs = inspection.outputs.map(({ signature }, index) => ({
      outputId: id(100 + index),
      signature,
    }))
    const asset = {
      id: id(50),
      digest: source.digest,
      byteLength: bytes.byteLength,
      filename: "Bodies.step",
      format: "step" as const,
      representation: "exact-solid" as const,
      normalization: source.normalization,
      outputs: outputs.map(({ outputId }) => outputId),
    }
    const imported = success(
      await evaluate(
        "imported",
        id(4),
        { source, outputs, matchingPolicyVersion: 1 },
        [],
        undefined,
        { asset, bytes },
      ),
    )
    const roles = outputs.map(({ outputId }) => `import.${outputId}`)
    const combined = success(
      await evaluate(
        "compound",
        id(5),
        { outputRoles },
        [{ featureId: id(4), contentHash: imported.contentHash }],
        slots(imported.contentHash, roles),
      ),
    )
    expect(combined.result.shape).toMatchObject({ valid: true, solidCount: 2 })
    expect(combined.result.shape.volume).toBeCloseTo(128, 5)
    expect(
      success(await engine.evaluateFeature(imported.input, vi.fn(), { asset, bytes })).result.shape,
    ).toEqual(imported.result.shape)
  })
})
