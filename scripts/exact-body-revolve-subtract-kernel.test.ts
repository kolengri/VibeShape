// @vitest-environment node
/// <reference path="../packages/geometry-worker/src/vite-modules.d.ts" />
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { ReplicadGeometryEngine } from "../packages/geometry-worker/src/engine"
import {
  type FeatureEvaluatedResponse,
  type FeatureEvaluationDependency,
  featureContentIdentitySchema,
  featureEvaluationInputSchema,
  serializeFeatureContentIdentity,
} from "../packages/protocol/src/index"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
let engine: ReplicadGeometryEngine
let metadata: Awaited<ReturnType<ReplicadGeometryEngine["initialize"]>>
const documentId = "exact-body-revolve-subtract-kernel"
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
  version = inputSlots ? 2 : 1,
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
        schemaVersion: version,
      },
      parameters,
      inputs: dependencies.map(({ contentHash }) => contentHash),
      references: [],
      ...(inputSlots
        ? { inputSlots }
        : dependencies.length
          ? { inputRoles: dependencies.map(({ outputRole }) => outputRole ?? null) }
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

function revolveParameters(operation: "add" | "remove" | "intersect") {
  const points = [
    [-2, 0],
    [2, 0],
    [2, 2],
    [-2, 2],
  ]
  const segments = points.map((start, index) => ({
    entityId: id(20 + index),
    type: "line",
    startPointId: id(30 + index),
    endPointId: id(30 + ((index + 1) % 4)),
    start,
    end: points[(index + 1) % 4],
  }))
  return {
    sketchId: id(10),
    frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    profiles: [
      { outer: { sourceEntityIds: segments.map(({ entityId }) => entityId), segments }, holes: [] },
    ],
    axis: { kind: "origin-axis", axis: "x" },
    axisOrigin: [0, 0, 0],
    axisDirection: [1, 0, 0],
    angleRadians: Math.PI * 2,
    operation,
  }
}
function assertSourceBodiesUnchanged(
  before: FeatureEvaluatedResponse["shape"][] | undefined,
  replayed: FeatureEvaluatedResponse["shape"][] | undefined,
) {
  if (!before || !replayed) throw new Error("Expected source body catalogs.")
  expect(replayed).toHaveLength(before.length)
  for (const [index, shape] of replayed.entries()) {
    const original = before[index]
    if (!original) throw new Error("Unexpected source body.")
    expect(shape.volume).toBeCloseTo(original.volume, 8)
    expect(shape.solidCount).toBe(original.solidCount)
    for (const coordinate of [0, 1, 2]) {
      expect(shape.bounds.min[coordinate]).toBeCloseTo(original.bounds.min[coordinate] as number, 8)
      expect(shape.bounds.max[coordinate]).toBeCloseTo(original.bounds.max[coordinate] as number, 8)
    }
  }
}
describe("exact-body Subtract v2 and Revolve v7 with pinned OCCT", () => {
  it("subtracts ordered roles of one producer without mutating either role or its sibling", async () => {
    const { producer, dependency } = await pattern(3, 3)
    const before = producer.result.bodies?.map(({ shape }) => shape)
    for (const reverse of [false, true]) {
      const selected = slots(producer.contentHash)
      const cut = success(
        await evaluate(
          "boolean",
          id(reverse ? 6 : 5),
          { operation: "subtract" },
          [dependency],
          reverse ? selected.reverse() : selected,
        ),
      )
      expect(cut.result.shape).toMatchObject({ valid: true, solidCount: 1 })
      expect(cut.result.shape.volume).toBeCloseTo(48, 5)
      expect(cut.result.shape.bounds.min[0]).toBeCloseTo(reverse ? 2 : -2, 5)
      expect(success(await engine.evaluateFeature(cut.input, vi.fn())).result.cache.brepHit).toBe(
        true,
      )
    }
    expect((await pattern(3, 3)).producer.result.bodies?.map(({ shape }) => shape)).toEqual(before)
  })
  it("binds target/tool roles to distinct ordered producer inputs", async () => {
    const { producer, dependency } = await pattern(3, 3)
    const tool = success(
      await evaluate("box", id(9), {
        width: 4,
        depth: 4,
        height: 4,
        centered: false,
        origin: [6, 0, 0],
      }),
    )
    const result = success(
      await evaluate(
        "boolean",
        id(5),
        { operation: "subtract" },
        [dependency, { featureId: id(9), contentHash: tool.contentHash }],
        [
          { inputIndex: 0, contentHash: producer.contentHash, outputRole: "pattern.instance.1" },
          { inputIndex: 1, contentHash: tool.contentHash, outputRole: "result" },
        ],
      ),
    )
    expect(result.result.shape).toMatchObject({ valid: true, solidCount: 1 })
    expect(result.result.shape.volume).toBeCloseTo(48, 5)
    expect(result.result.shape.bounds.min[0]).toBeCloseTo(1, 5)
    expect(result.result.shape.bounds.max[0]).toBeCloseTo(4, 5)
    expect(
      success(await engine.evaluateFeature(tool.input, vi.fn())).result.shape.volume,
    ).toBeCloseTo(64, 5)
  })
  it.each(["add", "remove", "intersect"] as const)(
    "applies %s only to the selected Pattern body",
    async (operation) => {
      const { producer } = await pattern(10, 3)
      const before = producer.result.bodies?.map(({ shape }) => shape)
      const result = success(
        await evaluate(
          "revolve",
          id(5),
          revolveParameters(operation),
          [
            {
              featureId: id(2),
              contentHash: producer.contentHash,
              outputRole: "pattern.instance.0",
            },
          ],
          undefined,
          undefined,
          7,
        ),
      )
      expect(result.result.shape).toMatchObject({ valid: true, solidCount: 1 })
      expect(result.result.shape.volume).toBeCloseTo(
        operation === "add"
          ? 64 + 8 * Math.PI
          : operation === "remove"
            ? 64 - 8 * Math.PI
            : 8 * Math.PI,
        5,
      )
      expect(result.result.shape.bounds.min[0]).toBeCloseTo(-2, 5)
      expect(result.result.shape.bounds.max[0]).toBeCloseTo(2, 5)
      expect(result.result.shape.bounds.min[2]).toBeCloseTo(operation === "add" ? -2 : 0, 5)
      expect(result.result.shape.bounds.max[2]).toBeCloseTo(operation === "intersect" ? 2 : 4, 5)
      assertSourceBodiesUnchanged(
        before,
        (await pattern(10, 3)).producer.result.bodies?.map(({ shape }) => shape),
      )
      expect(
        success(await engine.evaluateFeature(result.input, vi.fn())).result.cache.brepHit,
      ).toBe(true)
    },
  )
  it("rejects an empty exact-body intersection and releases temporary native shapes", async () => {
    const { producer, dependency } = await pattern(10, 3)
    const before = producer.result.bodies?.map(({ shape }) => shape)
    const baseline = engine.getHealth().ownedShapeCount
    const result = await evaluate(
      "revolve",
      id(6),
      revolveParameters("intersect"),
      [{ ...dependency, outputRole: "pattern.instance.2" }],
      undefined,
      undefined,
      7,
    )

    expect(result).toMatchObject({ ok: false })
    expect(engine.getHealth().ownedShapeCount).toBe(baseline)
    assertSourceBodiesUnchanged(
      before,
      (await pattern(10, 3)).producer.result.bodies?.map(({ shape }) => shape),
    )
  })
  it("fails closed for missing/stale roles, repeated bodies and unnamed Revolve targets without native leaks", async () => {
    const { producer, dependency } = await pattern()
    const baseline = engine.getHealth().ownedShapeCount
    await expect(
      evaluate(
        "boolean",
        id(5),
        { operation: "subtract" },
        [dependency],
        slots(producer.contentHash, ["pattern.instance.0", "pattern.instance.0"]),
      ),
    ).rejects.toThrow("unique")
    for (const selected of [slots(producer.contentHash, ["pattern.instance.0", "missing"])]) {
      expect(
        await evaluate("boolean", id(5), { operation: "subtract" }, [dependency], selected),
      ).toMatchObject({ ok: false })
      expect(engine.getHealth().ownedShapeCount).toBe(baseline)
    }
    expect(
      await evaluate(
        "boolean",
        id(5),
        { operation: "subtract" },
        [{ ...dependency, contentHash: "f".repeat(64) }],
        slots("f".repeat(64)),
      ),
    ).toMatchObject({ ok: false })
    expect(engine.getHealth().ownedShapeCount).toBe(baseline)
    await expect(
      evaluate("revolve", id(6), revolveParameters("add"), [dependency], undefined, undefined, 7),
    ).rejects.toThrow("named role")
    expect(engine.getHealth().ownedShapeCount).toBe(baseline)
    for (const outputRole of ["missing"]) {
      expect(
        await evaluate(
          "revolve",
          id(6),
          revolveParameters("add"),
          [{ ...dependency, ...(outputRole ? { outputRole } : {}) }],
          undefined,
          undefined,
          7,
        ),
      ).toMatchObject({ ok: false })
      expect(engine.getHealth().ownedShapeCount).toBe(baseline)
    }
  })
})
