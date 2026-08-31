import { projectWorldEllipticalEdgeToSupport } from "../../packages/application/src/sketch-curve-projection"
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
  ellipticalArcMinor: FeatureResponse | null
  ellipticalArcMajor: FeatureResponse | null
  ellipticalArcWrapped: FeatureResponse | null
  ellipticalArcReflected: FeatureResponse | null
  extrusionAdd: FeatureResponse | null
  extrusionIntersect: FeatureResponse | null
  extrusionRemove: FeatureResponse | null
  revolve: FeatureResponse | null
  revolveAdd: FeatureResponse | null
  revolveIntersect: FeatureResponse | null
  revolveRemove: FeatureResponse | null
  boolean: FeatureResponse | null
  cachedBoolean: FeatureResponse | null
  invalidBooleanDiagnostic: string | null
  legacyRevolveOperationDiagnostic: string | null
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

type EllipticalArcCase = Readonly<{
  name: string
  result: FeatureResponse | null
  start: readonly [number, number]
  end: readonly [number, number]
  sweep: number
  bounds: { min: readonly number[]; max: readonly number[] }
  middleAngle: number
  primaryAxisPoint: readonly [number, number]
  secondaryAxisPoint: readonly [number, number]
}>

type Vector3 = readonly [number, number, number]

type EllipticalArcFixture = Omit<EllipticalArcCase, "result"> &
  Readonly<{
    resultKey:
      | "ellipticalArcMinor"
      | "ellipticalArcMajor"
      | "ellipticalArcWrapped"
      | "ellipticalArcReflected"
  }>

const ellipticalArcFixtures: readonly EllipticalArcFixture[] = [
  {
    name: "minor",
    resultKey: "ellipticalArcMinor",
    start: [10, 0],
    end: [0, 5],
    sweep: Math.PI / 2,
    middleAngle: Math.PI / 4,
    primaryAxisPoint: [10, 0],
    secondaryAxisPoint: [0, 5],
    bounds: { min: [0, 0, 0], max: [10, 5, 12] },
  },
  {
    name: "major",
    resultKey: "ellipticalArcMajor",
    start: [0, 5],
    end: [10, 0],
    sweep: Math.PI * 1.5,
    middleAngle: Math.PI * 1.25,
    primaryAxisPoint: [10, 0],
    secondaryAxisPoint: [0, 5],
    bounds: { min: [-10, -5, 0], max: [10, 5, 12] },
  },
  {
    name: "wrapped",
    resultKey: "ellipticalArcWrapped",
    start: [10 * Math.cos(0.2), -5 * Math.sin(0.2)],
    end: [10 * Math.cos(0.2), 5 * Math.sin(0.2)],
    sweep: 0.4,
    middleAngle: 0,
    primaryAxisPoint: [10, 0],
    secondaryAxisPoint: [0, 5],
    bounds: {
      min: [10 * Math.cos(0.2), -5 * Math.sin(0.2), 0],
      max: [10, 5 * Math.sin(0.2), 12],
    },
  },
  {
    name: "reflected",
    resultKey: "ellipticalArcReflected",
    start: [-10, 0],
    end: [10, 0],
    sweep: Math.PI,
    middleAngle: Math.PI / 2,
    primaryAxisPoint: [-10, 0],
    secondaryAxisPoint: [0, 5],
    bounds: { min: [-10, 0, 0], max: [10, 5, 12] },
  },
]

function expectPointOnEllipse(
  point: Vector3,
  center: Vector3,
  xAxis: Vector3,
  yAxis: Vector3,
  majorRadius: number,
  minorRadius: number,
) {
  const relative: Vector3 = [point[0] - center[0], point[1] - center[1], point[2] - center[2]]
  const x = relative[0] * xAxis[0] + relative[1] * xAxis[1] + relative[2] * xAxis[2]
  const y = relative[0] * yAxis[0] + relative[1] * yAxis[1] + relative[2] * yAxis[2]
  expect(x ** 2 / majorRadius ** 2 + y ** 2 / minorRadius ** 2).toBeCloseTo(1, 6)
}

function requireProjectedPoint(points: readonly { x: number; y: number }[], index: number) {
  const point = points[index]
  if (!point) throw new Error(`Expected projected point ${index}.`)
  return point
}

function expectEllipticalArcCase(fixture: EllipticalArcCase) {
  const result = requireResult(fixture.result)
  expect(result.shape.valid).toBe(true)
  expect(result.shape.solidCount).toBe(1)
  const area = (10 * 5 * (fixture.sweep - Math.sin(fixture.sweep))) / 2
  expect(result.shape.volume, fixture.name).toBeCloseTo(area * 12, 5)
  expectBounds(result.shape.bounds, fixture.bounds)
  const edges = result.topologyCandidates.filter(
    (candidate) => candidate.referenceGeometry?.kind === "elliptical-arc-edge",
  )
  expect(edges).toHaveLength(2)
  for (const candidate of edges) {
    if (candidate.referenceGeometry?.kind !== "elliptical-arc-edge") continue
    const geometry = candidate.referenceGeometry
    expect(geometry.majorRadius).toBeCloseTo(10, 6)
    expect(geometry.minorRadius).toBeCloseTo(5, 6)
    expect(Math.hypot(...geometry.xAxis)).toBeCloseTo(1, 6)
    expect(Math.hypot(...geometry.yAxis)).toBeCloseTo(1, 6)
    expect(Math.hypot(...geometry.normal)).toBeCloseTo(1, 6)
    const cross: Vector3 = [
      geometry.xAxis[1] * geometry.yAxis[2] - geometry.xAxis[2] * geometry.yAxis[1],
      geometry.xAxis[2] * geometry.yAxis[0] - geometry.xAxis[0] * geometry.yAxis[2],
      geometry.xAxis[0] * geometry.yAxis[1] - geometry.xAxis[1] * geometry.yAxis[0],
    ]
    expect(
      cross[0] * geometry.normal[0] + cross[1] * geometry.normal[1] + cross[2] * geometry.normal[2],
    ).toBeCloseTo(1, 6)
    for (const point of [geometry.start, geometry.middle, geometry.end]) {
      expectPointOnEllipse(point, geometry.center, geometry.xAxis, geometry.yAxis, 10, 5)
    }
    const authored: readonly (readonly [number, number])[] = [fixture.start, fixture.end]
    const captured: readonly (readonly [number, number])[] = [
      [geometry.start[0], geometry.start[1]],
      [geometry.end[0], geometry.end[1]],
    ]
    expect(
      captured.some((point) =>
        authored.some(
          (expected) => Math.hypot(point[0] - expected[0], point[1] - expected[1]) < 1e-6,
        ),
      ),
    ).toBe(true)
    expect(
      captured.every((point) =>
        authored.some(
          (expected) => Math.hypot(point[0] - expected[0], point[1] - expected[1]) < 1e-6,
        ),
      ),
    ).toBe(true)
    const expectedMiddle: readonly [number, number] = [
      fixture.primaryAxisPoint[0] * Math.cos(fixture.middleAngle) +
        fixture.secondaryAxisPoint[0] * Math.sin(fixture.middleAngle),
      fixture.primaryAxisPoint[1] * Math.cos(fixture.middleAngle) +
        fixture.secondaryAxisPoint[1] * Math.sin(fixture.middleAngle),
    ]
    expect(
      Math.hypot(geometry.middle[0] - expectedMiddle[0], geometry.middle[1] - expectedMiddle[1]),
    ).toBeLessThan(1e-5)
    const projected = projectWorldEllipticalEdgeToSupport(geometry, {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    })
    expect(projected?.type).toBe("elliptical-arc")
    expect(projected).not.toBeNull()
    if (projected?.type !== "elliptical-arc") continue
    const projectedStart = requireProjectedPoint(projected.points, 3)
    const projectedEnd = requireProjectedPoint(projected.points, 4)
    expect(
      Math.hypot(projectedStart.x - geometry.start[0], projectedStart.y - geometry.start[1]),
    ).toBeLessThan(1e-6)
    expect(
      Math.hypot(projectedEnd.x - geometry.end[0], projectedEnd.y - geometry.end[1]),
    ).toBeLessThan(1e-6)
  }
  expectMesh(result)
}

function expectEllipticalArcCases(state: FeatureEvaluationHarnessState) {
  for (const fixture of ellipticalArcFixtures) {
    expectEllipticalArcCase({ ...fixture, result: state[fixture.resultKey] })
  }
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
  const extrusionAdd = requireResult(state.extrusionAdd)
  const extrusionIntersect = requireResult(state.extrusionIntersect)
  const extrusionRemove = requireResult(state.extrusionRemove)
  const revolve = requireResult(state.revolve)
  const revolveAdd = requireResult(state.revolveAdd)
  const revolveIntersect = requireResult(state.revolveIntersect)
  const revolveRemove = requireResult(state.revolveRemove)
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

  expectEllipticalArcCases(state)

  expect(extrusionAdd.shape.volume).toBeCloseTo(20 * 30 * 25.4 + 20 * 10 * 18 - 10 * 10 * 18, 5)
  expectBounds(extrusionAdd.shape.bounds, { min: [-10, -15, 0], max: [20, 15, 25.4] })
  expectMesh(extrusionAdd)
  expect(extrusionRemove.shape.volume).toBeCloseTo(20 * 30 * 25.4 - 10 * 10 * 18, 5)
  expectBounds(extrusionRemove.shape.bounds, { min: [-10, -15, 0], max: [10, 15, 25.4] })
  expectMesh(extrusionRemove)
  expect(extrusionIntersect.shape.volume).toBeCloseTo(10 * 10 * 18, 5)
  expectBounds(extrusionIntersect.shape.bounds, { min: [0, -9, 0], max: [10, 9, 10] })
  expectMesh(extrusionIntersect)

  expect(revolve.shape.volume).toBeCloseTo(Math.PI * 10 ** 2 * 10, 5)
  expectBounds(revolve.shape.bounds, { min: [-10, 0, -10], max: [10, 10, 10] })
  expectMesh(revolve)
  expect(revolveAdd.shape.volume).toBeCloseTo(20 * 30 * 25.4 + Math.PI * 10 ** 2 * 5, 5)
  expectBounds(revolveAdd.shape.bounds, { min: [-10, -15, -10], max: [10, 15, 25.4] })
  expectMesh(revolveAdd)
  expect(revolveRemove.shape.volume).toBeCloseTo(20 * 30 * 25.4 - Math.PI * 10 ** 2 * 5, 5)
  expectBounds(revolveRemove.shape.bounds, { min: [-10, -15, 0], max: [10, 15, 25.4] })
  expectMesh(revolveRemove)
  expect(revolveIntersect.shape.volume).toBeCloseTo(Math.PI * 10 ** 2 * 5, 5)
  expectBounds(revolveIntersect.shape.bounds, { min: [-10, 0, 0], max: [10, 10, 10] })
  expectMesh(revolveIntersect)

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
  expect(state.legacyRevolveOperationDiagnostic).toBe("invalid-feature-parameters")
  expect(state.missingDependencyDiagnostic).toBe("missing-feature-dependency")

  expect(state.progress).toEqual([
    ...Array.from({ length: 20 }).flatMap(() => [
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
  expect(state.health).toMatchObject({ ownedShapeCount: 19, activeDocuments: 1 })
  expect(state.disposal).toMatchObject({ ownedShapeCount: 0 })
})
