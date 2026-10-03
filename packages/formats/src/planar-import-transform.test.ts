import { sketchEntityIdSchema, sketchIdSchema } from "@vibeshape/domain/identifiers"
import {
  authorPreparedPlanarImport,
  type PlanarImportPoint,
  planarImportCurvePoint,
} from "@vibeshape/domain/planar-import-authoring"
import { describe, expect, it } from "vitest"
import { type ImportedCurve, type ParsedGeometryImport, parseGeometryImport } from "./import"
import { preparePlanarImport } from "./planar-import-transform"

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function matrix(a: number, b: number, c: number, d: number) {
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, 7, -3, 0, 1]
}
function geometry(curve: ImportedCurve, transform = identity): ParsedGeometryImport {
  return {
    kind: "sketch-curves",
    format: "svg",
    units: { coordinateUnit: "mm", sourceUnit: "mm", millimetersPerUnit: 1, policy: "selected" },
    paths: [
      {
        id: "path:0",
        closed: curve.type === "circle" || curve.type === "ellipse",
        transform,
        segments: [curve],
      },
    ],
    warnings: [],
  }
}
function prepare(curve: ImportedCurve, transform = identity) {
  const result = preparePlanarImport(geometry(curve, transform))
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostic))
  const segment = result.prepared.paths[0]?.segments[0]
  if (!segment) throw new Error("A prepared curve is required.")
  return { ...result, segment }
}
function apply(point: PlanarImportPoint, transform: number[]): PlanarImportPoint {
  return [
    (transform[0] ?? 0) * point[0] + (transform[4] ?? 0) * point[1] + (transform[12] ?? 0),
    (transform[1] ?? 0) * point[0] + (transform[5] ?? 0) * point[1] + (transform[13] ?? 0),
  ]
}
function expectPoint(actual: PlanarImportPoint, expected: PlanarImportPoint) {
  expect(actual[0]).toBeCloseTo(expected[0], 9)
  expect(actual[1]).toBeCloseTo(expected[1], 9)
}

describe("exact affine planar conics", () => {
  it.each(
    [matrix(2, 0, 1, 1), matrix(-2, 0, 1, 1), matrix(0.5, 1, -2, 0.3), matrix(0, 3, 2, 0)].map(
      (transform) => ({ transform }),
    ),
  )("preserves a circle as orthogonal ellipse axes under $transform", ({ transform }) => {
    const center: PlanarImportPoint = [1, 2]
    const result = prepare({ type: "circle", center, radius: 3 }, transform)
    const curve = result.segment.curve
    if (curve.type !== "ellipse") throw new Error("General affine scale must produce an ellipse.")
    const a = curve.primaryAxis
    const b = curve.secondaryAxis
    expect(a[0] * b[0] + a[1] * b[1]).toBeCloseTo(0, 10)
    for (const parameter of [0, 0.2, 0.7, 1.5, 3, 4, 5.8]) {
      const point = apply(
        [center[0] + 3 * Math.cos(parameter), center[1] + 3 * Math.sin(parameter)],
        transform,
      )
      const offset: PlanarImportPoint = [point[0] - curve.center[0], point[1] - curve.center[1]]
      const x = (offset[0] * a[0] + offset[1] * a[1]) / (a[0] ** 2 + a[1] ** 2)
      const y = (offset[0] * b[0] + offset[1] * b[1]) / (b[0] ** 2 + b[1] ** 2)
      expect(x * x + y * y).toBeCloseTo(1, 11)
    }
    const transformedCenter = apply(center, transform)
    const xRadius = 3 * Math.hypot(transform[0] ?? 0, transform[4] ?? 0)
    const yRadius = 3 * Math.hypot(transform[1] ?? 0, transform[5] ?? 0)
    expectPoint(result.bounds.min, [transformedCenter[0] - xRadius, transformedCenter[1] - yRadius])
    expectPoint(result.bounds.max, [transformedCenter[0] + xRadius, transformedCenter[1] + yRadius])
  })

  it.each([1.2, -1.2, 4.5, -4.5])(
    "preserves every parameter fraction of a signed arc with sweep %s",
    (sweep) => {
      for (const transform of [matrix(2, 0, 1, 1), matrix(-2, 0, 1, 1), matrix(0, 2, 2, 0)]) {
        const source = {
          type: "arc" as const,
          center: [1, 2] as PlanarImportPoint,
          radius: 3,
          startAngle: 0.4,
          sweep,
        }
        const result = prepare(source, transform)
        const curve = result.segment.curve
        if (curve.type !== "arc" && curve.type !== "elliptical-arc")
          throw new Error("A partial arc must retain a partial conic.")
        for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
          const parameter = source.startAngle + fraction * sweep
          const expected = apply(
            [1 + 3 * Math.cos(parameter), 2 + 3 * Math.sin(parameter)],
            transform,
          )
          const preparedFraction = result.segment.sourceDirection === 1 ? fraction : 1 - fraction
          expectPoint(
            planarImportCurvePoint(curve, curve.startAngle + preparedFraction * curve.sweep),
            expected,
          )
        }
      }
    },
  )

  it("retains circles for exact similarities and converts an oblique authored ellipse", () => {
    expect(
      prepare({ type: "circle", center: [0, 0], radius: 2 }, matrix(0, 3, -3, 0)).segment.curve,
    ).toMatchObject({ type: "circle", center: [7, -3], radius: 6 })
    const result = prepare({ type: "ellipse", center: [0, 0], xAxis: [4, 1], yAxis: [2, 3] })
    expect(result.segment.curve.type).toBe("ellipse")
    expectPoint(result.bounds.min, [-Math.sqrt(20), -Math.sqrt(10)])
    expectPoint(result.bounds.max, [Math.sqrt(20), Math.sqrt(10)])
  })

  it("recovers a highly anisotropic shear parameter from the dominant row without minor-axis cancellation", () => {
    const transform = matrix(10_000, 10_000, 10_000, 10_000.0001)
    const source = {
      type: "arc" as const,
      center: [0, 0] as PlanarImportPoint,
      radius: 2,
      startAngle: 0.2,
      sweep: 1.5,
    }
    const result = prepare(source, transform)
    const curve = result.segment.curve
    if (curve.type !== "elliptical-arc")
      throw new Error("An anisotropic shear must remain an elliptical arc.")
    for (const fraction of [0, 0.1, 0.5, 0.9, 1]) {
      const parameter = source.startAngle + source.sweep * fraction
      const expected = apply([2 * Math.cos(parameter), 2 * Math.sin(parameter)], transform)
      const actual = planarImportCurvePoint(curve, curve.startAngle + curve.sweep * fraction)
      expect(Math.hypot(actual[0] - expected[0], actual[1] - expected[1])).toBeLessThan(1e-7)
    }
  })
})

describe("exact planar poles, source policy and failures", () => {
  it("authors an actual DXF block with nonuniformly scaled closed bulges as one exact closed sketch path", async () => {
    const polyline = "0\nLWPOLYLINE\n8\nOutline\n90\n2\n70\n1\n10\n0\n20\n0\n42\n1\n10\n2\n20\n0\n"
    const block = `0\nBLOCK\n2\nFixture\n70\n0\n10\n0\n20\n0\n30\n0\n${polyline}0\nENDBLK\n`
    const insert = "0\nINSERT\n2\nFixture\n10\n10\n20\n20\n30\n0\n41\n2\n42\n3\n50\n90\n"
    const source = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n${block}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${insert}0\nENDSEC\n0\nEOF\n`
    const parsed = await parseGeometryImport({
      format: "dxf",
      bytes: Uint8Array.from(source, (character) => character.charCodeAt(0)),
    })
    if (!parsed.ok) throw new Error(parsed.diagnostic.message)
    const result = preparePlanarImport(parsed.geometry)
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostic))
    let next = 2
    const uuid = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`
    const authored = authorPreparedPlanarImport(result.prepared, {
      id: sketchIdSchema.parse(uuid(1)),
      label: "DXF outline",
      plane: "xy",
      createEntityId: () => sketchEntityIdSchema.parse(uuid(next++)),
    })
    expect(result.prepared.paths[0]?.closed).toBe(true)
    expect(authored.paths[0]?.curves).toHaveLength(2)
    const arc = authored.sketch.entities.find((entity) => entity.type === "elliptical-arc")
    const line = authored.sketch.entities.find((entity) => entity.type === "line")
    if (arc?.type !== "elliptical-arc" || line?.type !== "line")
      throw new Error("The exact bulge and closing line must remain authored curves.")
    expect(new Set([arc.startPointId, arc.endPointId])).toEqual(
      new Set([line.startPointId, line.endPointId]),
    )
    expectPoint(result.bounds.min, [10, 20])
    expectPoint(result.bounds.max, [13, 24])
  })
  it("transforms Bezier poles and elevates quadratics without a polyline", () => {
    const transform = matrix(2, 1, 3, 2)
    const q = prepare(
      { type: "quadratic-bezier", start: [0, 0], control: [3, 6], end: [9, 0] },
      transform,
    ).segment.curve
    if (q.type !== "cubic-bezier") throw new Error("A quadratic must become an exact cubic.")
    expectPoint(q.start, [7, -3])
    expectPoint(q.control1, apply([2, 4], transform))
    expectPoint(q.control2, apply([5, 4], transform))
    expectPoint(q.end, apply([9, 0], transform))
    const c = prepare(
      { type: "cubic-bezier", start: [0, 0], control1: [1, 4], control2: [5, 3], end: [6, 0] },
      transform,
    ).segment.curve
    expect(c).toMatchObject({
      type: "cubic-bezier",
      control1: apply([1, 4], transform),
      control2: apply([5, 3], transform),
    })
  })

  it("uses analytical Bezier and arc extrema rather than endpoint or pole bounds", () => {
    expect(
      prepare({ type: "quadratic-bezier", start: [0, 0], control: [5, 10], end: [10, 0] }).bounds,
    ).toEqual({ min: [0, 0], max: [10, 5] })
    const result = prepare({
      type: "arc",
      center: [0, 0],
      radius: 2,
      startAngle: 0.2,
      sweep: Math.PI,
    })
    expectPoint(result.bounds.max, [2 * Math.cos(0.2), 2])
    expectPoint(result.bounds.min, [-2, -2 * Math.sin(0.2)])
  })

  it("retains source-unit metadata without applying normalization twice or flipping Y", async () => {
    const parsed = await parseGeometryImport({
      format: "svg",
      units: "in",
      bytes: Uint8Array.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 2 L3 4"/></svg>',
        (character) => character.charCodeAt(0),
      ),
    })
    if (!parsed.ok) throw new Error(parsed.diagnostic.message)
    const source = JSON.stringify(parsed.geometry)
    const result = preparePlanarImport(parsed.geometry)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.diagnostic.message)
    expect(result.prepared.units).toMatchObject({
      sourceUnit: "in",
      millimetersPerUnit: 25.4,
      coordinateUnit: "mm",
    })
    expect(result.prepared.paths[0]?.segments[0]?.curve).toMatchObject({
      type: "line",
      start: [25.4, 50.8],
      end: [76.19999999999999, 101.6],
    })
    expect(JSON.stringify(parsed.geometry)).toBe(source)
  })

  it("rejects singular, near-flat, nonplanar, nonfinite, world and native budget failures", () => {
    const circle: ImportedCurve = { type: "circle", center: [0, 0], radius: 2 }
    const outOfPlane = [...identity]
    outOfPlane[14] = 1
    const nonfinite = [...identity]
    nonfinite[0] = NaN
    for (const transform of [
      matrix(1, 0, 0, 0),
      matrix(1, 0, 0, 1e-9),
      outOfPlane,
      nonfinite,
      matrix(100_000, 0, 0, 100_000),
    ])
      expect(preparePlanarImport(geometry(circle, transform)).ok).toBe(false)
    expect(
      preparePlanarImport({ kind: "sketch-curves", paths: Array(1_663).fill(null) }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-geometry" } })
    expect(preparePlanarImport({ kind: "triangle-mesh", meshes: [] })).toMatchObject({
      ok: false,
      diagnostic: { code: "unsupported-geometry" },
    })
  })
})
