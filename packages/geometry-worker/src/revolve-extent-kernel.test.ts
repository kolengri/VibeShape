import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { featureEvaluationInputSchema } from "@vibeshape/protocol"
import { getOC, makeBox, type Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"
import { fuseOwnedRevolveTools, partitionRevolveProfileSolids } from "./occt-revolve-extent"

const engine = new ReplicadGeometryEngine(undefined, (references, candidates) => {
  const ids = references.map((reference) =>
    candidates.filter(
      (candidate) => JSON.stringify(candidate.signature) === JSON.stringify(reference.signature),
    ),
  )
  return ids.every((matches) => matches.length === 1)
    ? {
        ok: true,
        candidateIds: ids.flatMap((matches) => matches.map(({ candidateId }) => candidateId)),
      }
    : { ok: false, reason: "missing" }
})
const documentId = "revolve-extent-kernel"
const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const boxId = id(1)
const revolveId = id(2)
const boxHash = "a".repeat(64)
const DEG = Math.PI / 180
const TOLERANCE = 1e-6
const occt = () => getOC() as unknown as OpenCascadeInstance

beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
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
}, 60_000)
afterEach(() => {
  engine.disposeDocument(documentId)
  expect(engine.getHealth().ownedShapeCount).toBe(0)
})

type Dependency = { featureId: string; contentHash: string; outputRole: string }
function featureInput(
  input: Readonly<{
    id: string
    typeId: string
    schemaVersion: number
    parameters: unknown
    dependencies?: readonly Dependency[]
    contentHash?: string
  }>,
): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected exact kernel environment.")
  const dependencies = input.dependencies ?? []
  return featureEvaluationInputSchema.parse({
    documentId,
    featureId: input.id,
    contentHash: input.contentHash ?? "b".repeat(64),
    dependencies,
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    content: {
      schemaVersion: dependencies.length ? 1 : 0,
      environment,
      feature: {
        schemaVersion: 0,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: `org.vibeshape.feature.part-design.${input.typeId}`,
          schemaVersion: input.schemaVersion,
        },
        parameters: input.parameters,
        inputs: dependencies.map(({ contentHash }) => contentHash),
        ...(dependencies.length
          ? { inputRoles: dependencies.map(({ outputRole }) => outputRole) }
          : {}),
        references: [],
      },
    },
  })
}

async function evaluate(input: FeatureEvaluationInput) {
  const result = await engine.evaluateFeature(input, vi.fn())
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.result
}

async function failure(input: FeatureEvaluationInput) {
  const result = await engine.evaluateFeature(input, vi.fn())
  if (result.ok) throw new Error("Expected the revolve evaluation to fail.")
  return result.diagnostic
}

/** A sketch-plane rectangle with radial extent x0..x1 about the sketch Y axis. */
function rectangle(x0: number, x1: number, y0: number, y1: number, seed: number) {
  const points = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as const
  const segments = points.map((start, index) => ({
    entityId: id(seed + index),
    type: "line",
    startPointId: id(seed + 10 + index),
    endPointId: id(seed + 10 + ((index + 1) % 4)),
    start,
    end: points[(index + 1) % 4],
  }))
  return {
    outer: { sourceEntityIds: segments.map(({ entityId }) => entityId), segments },
    holes: [],
  }
}

type Profile = ReturnType<typeof rectangle>
function revolveContent(
  overrides: Readonly<{
    profiles?: readonly Profile[]
    angle?: number
    secondAngle?: number | null
    symmetric?: boolean
    reversed?: boolean
    operation?: "new" | "add" | "remove" | "intersect"
    endCondition?: unknown
  }> = {},
) {
  const profiles = overrides.profiles ?? [rectangle(2, 5, 0, 4, 100)]
  return {
    sketchId: id(10),
    frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    profiles,
    axis: { kind: "origin-axis", axis: "y" },
    axisOrigin: [0, 0, 0],
    axisDirection: [0, 1, 0],
    angleRadians: overrides.angle ?? Math.PI / 2,
    operation: overrides.operation ?? "new",
    symmetric: overrides.symmetric ?? false,
    reversed: overrides.reversed ?? false,
    secondAngleRadians: overrides.secondAngle ?? null,
    endCondition: overrides.endCondition ?? { kind: "angle" },
    profileOutputRoles: profiles.map((_, index) => `revolve.profile.${id(200 + index)}`),
  }
}

let evaluationCount = 0
/** Each evaluation gets fresh content identity so a cached B-Rep never answers another case. */
function revolveInput(parameters: unknown, dependencies: readonly Dependency[] = []) {
  evaluationCount += 1
  return featureInput({
    id: revolveId,
    typeId: "revolve",
    schemaVersion: 8,
    contentHash: evaluationCount.toString(16).padStart(64, "0"),
    parameters,
    dependencies,
  })
}

/** Pappus: a rectangle x0..x1 by height h swept through angle θ about the Y axis. */
const pappus = (angle: number, x0: number, x1: number, height: number) =>
  (angle / 2) * (x1 * x1 - x0 * x0) * height

function blocker(origin: [number, number, number], size: [number, number, number]) {
  return featureInput({
    id: boxId,
    typeId: "box",
    schemaVersion: 1,
    contentHash: boxHash,
    parameters: { width: size[0], depth: size[1], height: size[2], centered: false, origin },
  })
}
const boxDependency: Dependency = { featureId: boxId, contentHash: boxHash, outputRole: "result" }
const bodyEnd = {
  kind: "up-to-body",
  inputIndex: 0,
  sourceContentHash: boxHash,
  outputRole: "result",
}

type Evaluated = Awaited<ReturnType<typeof evaluate>>
function face(source: Evaluated, direction: readonly [number, number, number], at: number) {
  const axis = direction.findIndex((value) => value !== 0)
  const matches = (source.bodies?.[0]?.topologyCandidates ?? []).filter(
    ({ kind, signature }) =>
      kind === "face" &&
      direction.every(
        (value, index) => Math.abs((signature.direction?.[index] ?? 0) - value) < 1e-9,
      ) &&
      Math.abs((signature.centroid[axis] ?? Number.NaN) - at) < 1e-9,
  )
  expect(matches).toHaveLength(1)
  return { schemaVersion: 1, kind: "face", outputRole: "result", signature: matches[0]?.signature }
}

describe("Revolve v8 angular extents", () => {
  it("splits a symmetric angle equally across the sketch plane", async () => {
    const result = await evaluate(revolveInput(revolveContent({ symmetric: true })))
    expect(result.shape.volume).toBeCloseTo(pappus(Math.PI / 2, 2, 5, 4), 6)
    expect(result.shape.bounds.min[2]).toBeCloseTo(-5 * Math.sin(45 * DEG), 6)
    expect(result.shape.bounds.max[2]).toBeCloseTo(5 * Math.sin(45 * DEG), 6)
    expect(result.bodies?.map(({ outputRole }) => outputRole)).toEqual(["result"])
  })

  it.each([
    [false, -5, 2.5],
    [true, -2.5, 5],
  ] as const)("sweeps independent two-sided angles (reversed %p)", async (reversed, minZ, maxZ) => {
    const result = await evaluate(
      revolveInput(revolveContent({ angle: 90 * DEG, secondAngle: 30 * DEG, reversed })),
    )
    expect(result.shape.volume).toBeCloseTo(pappus(120 * DEG, 2, 5, 4), 6)
    expect(result.shape.bounds.min[2]).toBeCloseTo(minZ, 6)
    expect(result.shape.bounds.max[2]).toBeCloseTo(maxZ, 6)
    expect(result.shape.bounds.min[0]).toBeCloseTo(0, 6)
  })

  it("reverses a one-sided angle and closes a full two-sided turn", async () => {
    const reversed = await evaluate(revolveInput(revolveContent({ reversed: true })))
    expect(reversed.shape.bounds.min[2]).toBeCloseTo(0, 6)
    expect(reversed.shape.bounds.max[2]).toBeCloseTo(5, 6)
    const full = await evaluate(
      revolveInput(revolveContent({ angle: 300 * DEG, secondAngle: 60 * DEG })),
    )
    expect(full.shape.volume).toBeCloseTo(pappus(2 * Math.PI, 2, 5, 4), 5)
    expect(full.shape.solidCount).toBe(1)
  })

  it("rejects a total angle beyond one turn before native evaluation", async () => {
    const diagnostic = await failure(
      revolveInput(revolveContent({ angle: 300 * DEG, secondAngle: 61 * DEG })),
    )
    expect(diagnostic.code).toBe("invalid-feature-parameters")
  })
})

describe("Revolve v8 dynamic endpoints", () => {
  // The blocker occupies x <= 0 below the sketch plane, so its x = 0 face is first reached at 90 degrees.
  // Box origins are centered in X and Y and name the base in Z.
  const wall = () => blocker([-5, 2.5, -10], [10, 15, 9])

  it("ends exactly at the first contact with an up-to-body endpoint", async () => {
    await evaluate(wall())
    const result = await evaluate(
      revolveInput(revolveContent({ endCondition: bodyEnd }), [boxDependency]),
    )
    expect(result.shape.volume).toBeCloseTo(pappus(Math.PI / 2, 2, 5, 4), 5)
    expect(result.shape.bounds.min[0]).toBeGreaterThan(-TOLERANCE)
    expect(result.shape.bounds.min[2]).toBeCloseTo(-5, 6)
    expect(result.shape.bounds.max[2]).toBeLessThan(TOLERANCE)
  })

  it("ends exactly at a selected body-bound face", async () => {
    const box = await evaluate(wall())
    const endCondition = { ...bodyEnd, kind: "up-to-face", face: face(box, [1, 0, 0], 0) }
    const result = await evaluate(revolveInput(revolveContent({ endCondition }), [boxDependency]))
    expect(result.shape.volume).toBeCloseTo(pappus(Math.PI / 2, 2, 5, 4), 5)
    expect(result.shape.bounds.min[0]).toBeGreaterThan(-TOLERANCE)
  })

  it("rejects a face that is not the first contact", async () => {
    const box = await evaluate(wall())
    const endCondition = { ...bodyEnd, kind: "up-to-face", face: face(box, [-1, 0, 0], -10) }
    const diagnostic = await failure(
      revolveInput(revolveContent({ endCondition }), [boxDependency]),
    )
    expect(diagnostic.message).toContain("first contact")
  })

  it("fails clearly when the endpoint body is unreachable", async () => {
    await evaluate(blocker([-5, 22.5, -10], [10, 5, 9]))
    const diagnostic = await failure(
      revolveInput(revolveContent({ endCondition: bodyEnd }), [boxDependency]),
    )
    expect(diagnostic.message).toContain("completely block every revolve profile")
  })

  it("rejects dynamic endpoints combined with a second angle", async () => {
    await evaluate(wall())
    const diagnostic = await failure(
      revolveInput(revolveContent({ endCondition: bodyEnd, secondAngle: DEG }), [boxDependency]),
    )
    expect(diagnostic.code).toBe("invalid-feature-parameters")
  })
})

describe("Revolve v8 multi-profile New outputs", () => {
  it("publishes one valid named output per separate profile solid", async () => {
    const result = await evaluate(
      revolveInput(
        revolveContent({ profiles: [rectangle(2, 3, 0, 4, 100), rectangle(4, 5, 0, 4, 120)] }),
      ),
    )
    expect(result.shape.solidCount).toBe(2)
    expect(result.bodies?.map(({ outputRole }) => outputRole)).toEqual([
      `revolve.profile.${id(200)}`,
      `revolve.profile.${id(201)}`,
    ])
    expect(result.bodies?.map(({ shape }) => shape.volume)).toEqual([
      expect.closeTo(pappus(Math.PI / 2, 2, 3, 4), 6),
      expect.closeTo(pappus(Math.PI / 2, 4, 5, 4), 6),
    ])
    for (const body of result.bodies ?? []) {
      expect(body.shape.valid).toBe(true)
      expect(body.shape.solidCount).toBe(1)
    }
  })

  it("keeps one result output when the profile solids merge", async () => {
    const result = await evaluate(
      revolveInput(
        revolveContent({ profiles: [rectangle(2, 3, 0, 4, 100), rectangle(3, 5, 0, 4, 120)] }),
      ),
    )
    expect(result.shape.solidCount).toBe(1)
    expect(result.shape.volume).toBeCloseTo(pappus(Math.PI / 2, 2, 5, 4), 5)
    expect(result.bodies?.map(({ outputRole }) => outputRole)).toEqual(["result"])
  })

  it("rejects a partial merge that has no per-profile identity", async () => {
    const diagnostic = await failure(
      revolveInput(
        revolveContent({
          profiles: [
            rectangle(2, 3, 0, 4, 100),
            rectangle(3, 4, 0, 4, 120),
            rectangle(4.5, 5, 0, 4, 140),
          ],
        }),
      ),
    )
    expect(diagnostic.message).toContain("one separate solid per profile")
  })

  it("lets a downstream feature target one named profile output", async () => {
    const roles = [`revolve.profile.${id(200)}`, `revolve.profile.${id(201)}`]
    const bundle = featureInput({
      id: revolveId,
      typeId: "revolve",
      schemaVersion: 8,
      contentHash: "c".repeat(64),
      parameters: revolveContent({
        profiles: [rectangle(2, 3, 0, 4, 100), rectangle(4, 5, 0, 4, 120)],
      }),
    })
    await evaluate(bundle)
    const placed = await evaluate(
      featureInput({
        id: id(3),
        typeId: "placement",
        schemaVersion: 1,
        parameters: { translation: [0, 0, 10], rotation: [0, 0, 0] },
        dependencies: [
          { featureId: revolveId, contentHash: "c".repeat(64), outputRole: roles[1] ?? "" },
        ],
      }),
    )
    expect(placed.shape.volume).toBeCloseTo(pappus(Math.PI / 2, 4, 5, 4), 6)
    // Replaying the cached bundle restores the same named outputs.
    const replay = await evaluate(bundle)
    expect(replay.cache.brepHit).toBe(true)
    expect(replay.bodies?.map(({ outputRole }) => outputRole)).toEqual(roles)
  })
})

describe("Revolve v8 native ownership", () => {
  function spiedBoxes(origins: readonly [number, number, number][]) {
    const shapes = origins.map(
      (origin) =>
        makeBox(origin, [origin[0] + 1, origin[1] + 1, origin[2] + 1]) as unknown as Shape3D,
    )
    return { shapes, deleted: shapes.map((shape) => vi.spyOn(shape, "delete")) }
  }

  it("releases every profile tool when a partial merge fails", () => {
    const { shapes, deleted } = spiedBoxes([
      [0, 0, 0],
      [1, 0, 0],
      [5, 0, 0],
    ])
    expect(() => partitionRevolveProfileSolids(occt(), shapes, ["a.b", "a.c", "a.d"])).toThrow(
      "one separate solid per profile",
    )
    for (const spy of deleted) expect(spy).toHaveBeenCalledTimes(1)
  })

  it("transfers separate solids and releases every merged tool", () => {
    const separate = spiedBoxes([
      [0, 0, 0],
      [5, 0, 0],
    ])
    const outputs = partitionRevolveProfileSolids(occt(), separate.shapes, ["a.b", "a.c"])
    expect(outputs.merged).toBeNull()
    for (const spy of separate.deleted) expect(spy).not.toHaveBeenCalled()
    for (const output of outputs.separate) output.shape.delete()
    const merged = spiedBoxes([
      [0, 0, 0],
      [0.5, 0, 0],
    ])
    const result = partitionRevolveProfileSolids(occt(), merged.shapes, ["a.b", "a.c"])
    for (const spy of merged.deleted) expect(spy).toHaveBeenCalledTimes(1)
    result.merged?.delete()
  })

  it("releases unfused tools when a fuse fails", () => {
    const { shapes, deleted } = spiedBoxes([
      [0, 0, 0],
      [5, 0, 0],
      [9, 0, 0],
    ])
    vi.spyOn(shapes[1] as Shape3D, "wrapped", "get").mockImplementation(() => {
      throw new Error("native failure")
    })
    expect(() => fuseOwnedRevolveTools(occt(), shapes)).toThrow()
    for (const spy of deleted) expect(spy).toHaveBeenCalledTimes(1)
  })
})
