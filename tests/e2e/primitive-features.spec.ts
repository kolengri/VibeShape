import type { GeometryWorkerResponse } from "../../packages/protocol/src"
import { expect, test } from "./fixtures"

type FeatureResponse = Extract<GeometryWorkerResponse, { type: "featureEvaluated" }>
type HealthResponse = Extract<GeometryWorkerResponse, { type: "health" }>
type DisposalResponse = Extract<GeometryWorkerResponse, { type: "documentDisposed" }>

interface FeatureEvaluationHarnessState {
  state: "running" | "passed" | "failed"
  box: FeatureResponse | null
  cachedBox: FeatureResponse | null
  positionedBox: FeatureResponse | null
  cylinder: FeatureResponse | null
  extrusion: FeatureResponse | null
  circularArcExtrusion: FeatureResponse | null
  ellipseExtrusion: FeatureResponse | null
  ellipticalArcExtrusion: FeatureResponse | null
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
  const positionedBox = requireResult(state.positionedBox)
  const cylinder = requireResult(state.cylinder)
  const extrusion = requireResult(state.extrusion)
  const circularArcExtrusion = requireResult(state.circularArcExtrusion)
  const ellipseExtrusion = requireResult(state.ellipseExtrusion)
  const ellipticalArcExtrusion = requireResult(state.ellipticalArcExtrusion)
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

  expect(positionedBox.shape.valid).toBe(true)
  expect(positionedBox.shape.volume).toBeCloseTo(20 * 30 * 25.4, 5)
  expectBounds(positionedBox.shape.bounds, { min: [2, -23, 7], max: [22, 7, 32.4] })
  expect(
    positionedBox.topologyCandidates.flatMap(({ semanticRole }) => semanticRole ?? []),
  ).toEqual(
    expect.arrayContaining([
      "primitive.box.cap.start",
      "primitive.box.cap.end",
      "primitive.box.side.x-min",
      "primitive.box.side.x-max",
      "primitive.box.side.y-min",
      "primitive.box.side.y-max",
    ]),
  )

  expect(cylinder.cache.brepHit).toBe(false)
  expect(cylinder.shape.valid).toBe(true)
  expect(cylinder.shape.solidCount).toBe(1)
  expect(cylinder.shape.volume).toBeCloseTo(Math.PI * 5 ** 2 * 60, 5)
  expectBounds(cylinder.shape.bounds, { min: [-5, -5, -30], max: [5, 5, 30] })
  expect(cylinder.topologyCandidates.flatMap(({ semanticRole }) => semanticRole ?? [])).toEqual(
    expect.arrayContaining([
      "primitive.cylinder.cap.start",
      "primitive.cylinder.cap.end",
      "primitive.cylinder.edge.start",
      "primitive.cylinder.edge.end",
      "primitive.cylinder.wall",
    ]),
  )
  const circularEdges = cylinder.topologyCandidates.filter(
    (candidate) => candidate.referenceGeometry?.kind === "circle-edge",
  )
  expect(circularEdges).toHaveLength(2)
  for (const edge of circularEdges) {
    if (edge.referenceGeometry?.kind !== "circle-edge") continue
    expect(edge.signature.geometryClass).toBe("CIRCLE")
    expect(edge.referenceGeometry.center.slice(0, 2)).toEqual([0, 0])
    expect(edge.referenceGeometry.radius).toBeCloseTo(5)
    expect(Math.hypot(...edge.referenceGeometry.normal)).toBeCloseTo(1)
  }
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

  expect(circularArcExtrusion.cache.brepHit).toBe(false)
  expect(circularArcExtrusion.shape.valid).toBe(true)
  expect(circularArcExtrusion.shape.solidCount).toBe(1)
  expect(circularArcExtrusion.shape.volume).toBeCloseTo((75 * Math.PI + 50) * 12, 5)
  expectBounds(circularArcExtrusion.shape.bounds, {
    min: [-10, -10, 0],
    max: [10, 10, 12],
  })
  const circularArcEdges = circularArcExtrusion.topologyCandidates.filter(
    (candidate) => candidate.referenceGeometry?.kind === "arc-edge",
  )
  expect(circularArcEdges).toHaveLength(2)
  for (const edge of circularArcEdges) {
    if (edge.referenceGeometry?.kind !== "arc-edge") continue
    const geometry = edge.referenceGeometry
    const angle = (point: readonly [number, number, number]) => {
      const relative = [
        point[0] - geometry.center[0],
        point[1] - geometry.center[1],
        point[2] - geometry.center[2],
      ] as const
      const x =
        relative[0] * geometry.xAxis[0] +
        relative[1] * geometry.xAxis[1] +
        relative[2] * geometry.xAxis[2]
      const y =
        relative[0] * geometry.yAxis[0] +
        relative[1] * geometry.yAxis[1] +
        relative[2] * geometry.yAxis[2]
      const value = Math.atan2(y, x)
      return value < 0 ? value + Math.PI * 2 : value
    }
    const start = angle(geometry.start)
    const middleDelta = (angle(geometry.middle) - start + Math.PI * 2) % (Math.PI * 2)
    const endDelta = (angle(geometry.end) - start + Math.PI * 2) % (Math.PI * 2)
    const sweep = middleDelta <= endDelta + 1e-9 ? endDelta : Math.PI * 2 - endDelta
    for (const point of [geometry.start, geometry.middle, geometry.end]) {
      expect(
        Math.hypot(
          point[0] - geometry.center[0],
          point[1] - geometry.center[1],
          point[2] - geometry.center[2],
        ),
      ).toBeCloseTo(10)
    }
    expect(sweep).toBeGreaterThan(Math.PI)
  }
  expectMesh(circularArcExtrusion)

  expect(ellipseExtrusion.cache.brepHit).toBe(false)
  expect(ellipseExtrusion.shape.valid).toBe(true)
  expect(ellipseExtrusion.shape.solidCount).toBe(1)
  expect(ellipseExtrusion.shape.volume).toBeCloseTo(Math.PI * 5 * 10 * 12, 5)
  expectBounds(ellipseExtrusion.shape.bounds, { min: [-5, -10, 0], max: [5, 10, 12] })
  expect(
    ellipseExtrusion.topologyCandidates.flatMap(({ semanticRole }) => semanticRole ?? []),
  ).toEqual(
    expect.arrayContaining([
      "extrusion.cap.start",
      "extrusion.cap.end",
      "extrusion.side.0195b5ac-b220-7a2c-8c33-67a36a7f3310",
    ]),
  )
  expectMesh(ellipseExtrusion)

  expect(ellipticalArcExtrusion.cache.brepHit).toBe(false)
  expect(ellipticalArcExtrusion.shape.valid).toBe(true)
  expect(ellipticalArcExtrusion.shape.solidCount).toBe(1)
  expect(ellipticalArcExtrusion.shape.volume).toBeCloseTo(Math.PI * 10 * 5 * 6, 5)
  expectBounds(ellipticalArcExtrusion.shape.bounds, { min: [-10, 0, 0], max: [10, 5, 12] })
  expect(
    ellipticalArcExtrusion.topologyCandidates.flatMap(({ semanticRole }) => semanticRole ?? []),
  ).toEqual(
    expect.arrayContaining([
      "extrusion.cap.start",
      "extrusion.cap.end",
      "extrusion.side.0195b5ac-b220-7a2c-8c33-67a36a7f3311",
      "extrusion.side.0195b5ac-b220-7a2c-8c33-67a36a7f3312",
    ]),
  )
  expectMesh(ellipticalArcExtrusion)

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
    ...Array.from({ length: 13 }).flatMap(() => [
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
  expect(state.health).toMatchObject({ ownedShapeCount: 12, activeDocuments: 1 })
  expect(state.disposal).toMatchObject({ ownedShapeCount: 0 })
})
