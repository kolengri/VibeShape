import type { GeometryWorkerResponse } from "../../packages/protocol/src"
import { expect, test } from "./fixtures"

type FeatureResponse = Extract<GeometryWorkerResponse, { type: "featureEvaluated" }>
type HealthResponse = Extract<GeometryWorkerResponse, { type: "health" }>
type DisposalResponse = Extract<GeometryWorkerResponse, { type: "documentDisposed" }>

interface FeatureEvaluationHarnessState {
  state: "running" | "passed" | "failed"
  box: FeatureResponse | null
  cachedBox: FeatureResponse | null
  cylinder: FeatureResponse | null
  extrusion: FeatureResponse | null
  extrusionAdd: FeatureResponse | null
  extrusionIntersect: FeatureResponse | null
  extrusionRemove: FeatureResponse | null
  boolean: FeatureResponse | null
  cachedBoolean: FeatureResponse | null
  invalidBooleanDiagnostic: string | null
  missingDependencyDiagnostic: string | null
  health: HealthResponse | null
  disposal: DisposalResponse | null
  progress: string[]
  error: string | null
}

function requireResult<Result>(result: Result | null) {
  expect(result).not.toBeNull()
  if (!result) throw new Error("The primitive feature worker did not publish a result.")
  return result
}

function expectBounds(
  actual: { min: readonly number[]; max: readonly number[] },
  expected: { min: readonly number[]; max: readonly number[] },
) {
  for (const [index, value] of expected.min.entries()) {
    expect(actual.min[index]).toBeCloseTo(value, 6)
  }
  for (const [index, value] of expected.max.entries()) {
    expect(actual.max[index]).toBeCloseTo(value, 6)
  }
}

function expectMesh(result: FeatureResponse) {
  expect(result.mesh.positions.length).toBeGreaterThan(0)
  expect(result.mesh.normals.length).toBe(result.mesh.positions.length)
  expect(result.mesh.indices.length).toBeGreaterThan(0)
  expect(result.mesh.indices.length % 3).toBe(0)
  expect(result.mesh.triangleFaceIds.length).toBe(result.mesh.indices.length / 3)
}

test("evaluates and caches canonical primitive and Boolean features in the geometry worker", async ({
  page,
}) => {
  await page.goto("/spikes/primitive-features.html")

  const status = page.getByRole("status")
  await expect(status).not.toHaveAttribute("data-state", "running", { timeout: 120_000 })
  await expect(status).toHaveAttribute("data-state", "passed")

  const state = await page.evaluate<FeatureEvaluationHarnessState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_PRIMITIVE_FEATURES__"),
  )
  expect(state.error).toBeNull()
  const box = requireResult(state.box)
  const cachedBox = requireResult(state.cachedBox)
  const cylinder = requireResult(state.cylinder)
  const extrusion = requireResult(state.extrusion)
  const extrusionAdd = requireResult(state.extrusionAdd)
  const extrusionIntersect = requireResult(state.extrusionIntersect)
  const extrusionRemove = requireResult(state.extrusionRemove)
  const boolean = requireResult(state.boolean)
  const cachedBoolean = requireResult(state.cachedBoolean)

  expect(box.cache.brepHit).toBe(false)
  expect(cachedBox.cache.brepHit).toBe(true)
  expect(cachedBox.contentHash).toBe(box.contentHash)
  expect(box.shape.valid).toBe(true)
  expect(box.shape.solidCount).toBe(1)
  expect(box.shape.volume).toBeCloseTo(20 * 30 * 25.4, 5)
  expectBounds(box.shape.bounds, { min: [-10, -15, 0], max: [10, 15, 25.4] })
  expect(box.topologyCandidates.flatMap(({ semanticRole }) => semanticRole ?? [])).toEqual(
    expect.arrayContaining([
      "primitive.box.cap.start",
      "primitive.box.cap.end",
      "primitive.box.side.x-min",
      "primitive.box.side.x-max",
      "primitive.box.side.y-min",
      "primitive.box.side.y-max",
    ]),
  )
  expectMesh(box)

  expect(cylinder.cache.brepHit).toBe(false)
  expect(cylinder.shape.valid).toBe(true)
  expect(cylinder.shape.solidCount).toBe(1)
  expect(cylinder.shape.volume).toBeCloseTo(Math.PI * 5 ** 2 * 60, 5)
  expectBounds(cylinder.shape.bounds, { min: [-5, -5, -30], max: [5, 5, 30] })
  expect(cylinder.topologyCandidates.flatMap(({ semanticRole }) => semanticRole ?? [])).toEqual(
    expect.arrayContaining([
      "primitive.cylinder.cap.start",
      "primitive.cylinder.cap.end",
      "primitive.cylinder.wall",
    ]),
  )
  expectMesh(cylinder)

  expect(extrusion.cache.brepHit).toBe(false)
  expect(extrusion.shape.valid).toBe(true)
  expect(extrusion.shape.solidCount).toBe(1)
  expect(extrusion.shape.volume).toBeCloseTo(20 * 10 * 18, 5)
  expectBounds(extrusion.shape.bounds, { min: [0, -9, 0], max: [20, 9, 10] })
  expect(extrusion.topologyCandidates.flatMap(({ semanticRole }) => semanticRole ?? [])).toEqual(
    expect.arrayContaining([
      "extrusion.cap.start",
      "extrusion.cap.end",
      "extrusion.side.0195b5ac-b220-7a2c-8c33-67a36a7f3301",
      "extrusion.side.0195b5ac-b220-7a2c-8c33-67a36a7f3302",
      "extrusion.side.0195b5ac-b220-7a2c-8c33-67a36a7f3303",
      "extrusion.side.0195b5ac-b220-7a2c-8c33-67a36a7f3304",
    ]),
  )
  expectMesh(extrusion)

  expect(extrusionAdd.shape.volume).toBeCloseTo(20 * 30 * 25.4 + 20 * 10 * 18 - 10 * 10 * 18, 5)
  expectBounds(extrusionAdd.shape.bounds, { min: [-10, -15, 0], max: [20, 15, 25.4] })
  expectMesh(extrusionAdd)
  expect(extrusionRemove.shape.volume).toBeCloseTo(20 * 30 * 25.4 - 10 * 10 * 18, 5)
  expectBounds(extrusionRemove.shape.bounds, { min: [-10, -15, 0], max: [10, 15, 25.4] })
  expectMesh(extrusionRemove)
  expect(extrusionIntersect.shape.volume).toBeCloseTo(10 * 10 * 18, 5)
  expectBounds(extrusionIntersect.shape.bounds, { min: [0, -9, 0], max: [10, 9, 10] })
  expectMesh(extrusionIntersect)

  expect(boolean.cache.brepHit).toBe(false)
  expect(cachedBoolean.cache.brepHit).toBe(true)
  expect(cachedBoolean.contentHash).toBe(boolean.contentHash)
  expect(boolean.shape.valid).toBe(true)
  expect(boolean.shape.solidCount).toBe(1)
  expect(boolean.shape.volume).toBeCloseTo(20 * 30 * 25.4 - Math.PI * 5 ** 2 * 25.4, 5)
  expectBounds(boolean.shape.bounds, { min: [-10, -15, 0], max: [10, 15, 25.4] })
  expect(boolean.topologyCandidates.length).toBeGreaterThan(0)
  expectMesh(boolean)
  expect(state.invalidBooleanDiagnostic).toBe("invalid-feature-geometry")
  expect(state.missingDependencyDiagnostic).toBe("missing-feature-dependency")

  expect(state.progress).toEqual([
    ...Array.from({ length: 9 }).flatMap(() => [
      "feature-validation",
      "feature-evaluation",
      "feature-tessellation",
      "complete",
    ]),
    "feature-validation",
    "feature-evaluation",
    "feature-validation",
    "feature-evaluation",
    "feature-tessellation",
    "complete",
    "feature-validation",
  ])
  expect(state.health).toMatchObject({ ownedShapeCount: 8, activeDocuments: 1 })
  expect(state.disposal).toMatchObject({ ownedShapeCount: 0 })
})
