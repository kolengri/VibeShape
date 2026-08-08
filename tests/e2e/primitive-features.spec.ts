import type { GeometryWorkerResponse } from "../../packages/protocol/src"
import { expect, test } from "./fixtures"

type FeatureResponse = Extract<GeometryWorkerResponse, { type: "featureEvaluated" }>
type HealthResponse = Extract<GeometryWorkerResponse, { type: "health" }>
type DisposalResponse = Extract<GeometryWorkerResponse, { type: "documentDisposed" }>

interface PrimitiveFeatureHarnessState {
  state: "running" | "passed" | "failed"
  box: FeatureResponse | null
  cachedBox: FeatureResponse | null
  cylinder: FeatureResponse | null
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

test("evaluates and caches canonical box and cylinder features in the geometry worker", async ({
  page,
}) => {
  await page.goto("/spikes/primitive-features.html")

  const status = page.getByRole("status")
  await expect(status).not.toHaveAttribute("data-state", "running", { timeout: 120_000 })
  await expect(status).toHaveAttribute("data-state", "passed")

  const state = await page.evaluate<PrimitiveFeatureHarnessState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_PRIMITIVE_FEATURES__"),
  )
  expect(state.error).toBeNull()
  const box = requireResult(state.box)
  const cachedBox = requireResult(state.cachedBox)
  const cylinder = requireResult(state.cylinder)

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
  expect(cylinder.shape.volume).toBeCloseTo(Math.PI * 5 ** 2 * 20, 5)
  expectBounds(cylinder.shape.bounds, { min: [-5, -5, -10], max: [5, 5, 10] })
  expect(cylinder.topologyCandidates.flatMap(({ semanticRole }) => semanticRole ?? [])).toEqual(
    expect.arrayContaining([
      "primitive.cylinder.cap.start",
      "primitive.cylinder.cap.end",
      "primitive.cylinder.wall",
    ]),
  )
  expectMesh(cylinder)

  expect(state.progress).toEqual(
    Array.from({ length: 3 }).flatMap(() => [
      "feature-validation",
      "feature-evaluation",
      "feature-tessellation",
      "complete",
    ]),
  )
  expect(state.health).toMatchObject({ ownedShapeCount: 2, activeDocuments: 1 })
  expect(state.disposal).toMatchObject({ ownedShapeCount: 0 })
})
