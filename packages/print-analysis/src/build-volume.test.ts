import { describe, expect, it } from "bun:test"
import { type PrintPreparationMesh, printerProfileSchema } from "@vibeshape/protocol"
import { checkPrintVolume, PRINT_VOLUME_EPSILON_MM } from "./build-volume"
import type { Point } from "./mesh-geometry"

const printer = printerProfileSchema.parse({
  version: 1,
  name: "Test rectangular printer",
  width: 200,
  depth: 100,
  height: 80,
})

function box(name: string, min: Point, max: Point): PrintPreparationMesh {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  return {
    name,
    vertices: [
      x0,
      y0,
      z0,
      x1,
      y0,
      z0,
      x1,
      y1,
      z0,
      x0,
      y1,
      z0,
      x0,
      y0,
      z1,
      x1,
      y0,
      z1,
      x1,
      y1,
      z1,
      x0,
      y1,
      z1,
    ],
    triangles: [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
      0, 4, 3, 4, 7,
    ],
  }
}

const inside = box("Body", [-10, -10, 0], [10, 10, 20])

describe("current-placement rectangular build-volume checks", () => {
  it("accepts every exact rectangular boundary and reports dimensions from real vertices", () => {
    const result = checkPrintVolume([box("Boundary", [-100, -50, 0], [100, 50, 80])], printer)
    expect(result).toMatchObject({
      fits: true,
      bounds: { min: [-100, -50, 0], max: [100, 50, 80] },
      dimensions: [200, 100, 80],
      signedOutside: { min: [0, 0, 0], max: [0, 0, 0] },
      overruns: [],
      limits: { min: [-100, -50, 0], max: [100, 50, 80] },
      meshes: [{ index: 0, name: "Boundary", fits: true, dimensions: [200, 100, 80] }],
    })
  })

  it("checks placement even when the dimensions alone fit and leaves inputs unchanged", () => {
    const translated = box("Translated", [90, -10, 0], [110, 10, 20])
    const before = {
      ...translated,
      vertices: [...translated.vertices],
      triangles: [...translated.triangles],
    }
    const result = checkPrintVolume([translated], printer)
    expect(result).toMatchObject({
      fits: false,
      dimensions: [20, 20, 20],
      signedOutside: { min: [-190, -40, 0], max: [10, -40, -60] },
      overruns: [{ axis: "x", side: "max", millimeters: 10 }],
      meshes: [{ fits: false }],
    })
    expect(translated).toEqual(before)
    expect(checkPrintVolume([translated], printer)).toEqual(result)
  })

  it("reports actionable overruns on both sides of all three axes", () => {
    const result = checkPrintVolume([box("Outside", [-102, -53, -4], [105, 56, 87])], printer)
    expect(result.fits).toBe(false)
    expect(result.signedOutside).toEqual({ min: [2, 3, 4], max: [5, 6, 7] })
    expect(result.overruns).toEqual([
      { axis: "x", side: "min", millimeters: 2 },
      { axis: "x", side: "max", millimeters: 5 },
      { axis: "y", side: "min", millimeters: 3 },
      { axis: "y", side: "max", millimeters: 6 },
      { axis: "z", side: "min", millimeters: 4 },
      { axis: "z", side: "max", millimeters: 7 },
    ])
  })

  it("rejects a below-bed mesh without seating it", () => {
    const result = checkPrintVolume([box("Below bed", [-10, -10, -1], [10, 10, 19])], printer)
    expect(result.bounds.min[2]).toBe(-1)
    expect(result.overruns).toEqual([{ axis: "z", side: "min", millimeters: 1 }])
    expect(result.fits).toBe(false)
  })

  it("rejects excess height in the current orientation without rotating it", () => {
    const result = checkPrintVolume([box("Tall", [-10, -10, 0], [10, 10, 81])], printer)
    expect(result.dimensions).toEqual([20, 20, 81])
    expect(result.overruns).toEqual([{ axis: "z", side: "max", millimeters: 1 }])
    expect(result.fits).toBe(false)
  })

  it("insets XY by the margin without changing the bed height", () => {
    const profile = { ...printer, margin: 5 }
    const boundary = box("Usable boundary", [-95, -45, 0], [95, 45, 80])
    expect(checkPrintVolume([boundary], profile)).toMatchObject({
      fits: true,
      limits: { min: [-95, -45, 0], max: [95, 45, 80] },
      dimensions: [190, 90, 80],
    })
    const result = checkPrintVolume([box("Margin conflict", [-96, -46, 0], [96, 46, 80])], profile)
    expect(result.overruns).toEqual([
      { axis: "x", side: "min", millimeters: 1 },
      { axis: "x", side: "max", millimeters: 1 },
      { axis: "y", side: "min", millimeters: 1 },
      { axis: "y", side: "max", millimeters: 1 },
    ])
    expect(result.fits).toBe(false)
  })

  it("combines world bounds while retaining individual mesh dimensions and fit", () => {
    const left = box("Left", [-90, -10, 0], [-70, 10, 20])
    const right = box("Right", [80, -20, 0], [110, 20, 30])
    const result = checkPrintVolume([left, right], printer)
    expect(result).toMatchObject({
      fits: false,
      bounds: { min: [-90, -20, 0], max: [110, 20, 30] },
      dimensions: [200, 40, 30],
      meshes: [
        { index: 0, name: "Left", fits: true, dimensions: [20, 20, 20], overruns: [] },
        {
          index: 1,
          name: "Right",
          fits: false,
          dimensions: [30, 40, 30],
          overruns: [{ axis: "x", side: "max", millimeters: 10 }],
        },
      ],
    })
  })

  it("includes support meshes and accepts all ten prepared result meshes", () => {
    const bodies = Array.from({ length: 8 }, (_, index) => ({ ...inside, name: `Body ${index}` }))
    const supports = [
      box("Support left", [-101, -5, 0], [-90, 5, 20]),
      box("Support right", [90, -5, 0], [99, 5, 20]),
    ]
    expect(checkPrintVolume(bodies, printer).fits).toBe(true)
    const result = checkPrintVolume([...bodies, ...supports], printer)
    expect(result.meshes).toHaveLength(10)
    expect(result.meshes[8]).toMatchObject({ name: "Support left", fits: false })
    expect(result.meshes[9]).toMatchObject({ name: "Support right", fits: true })
    expect(result.overruns).toEqual([{ axis: "x", side: "min", millimeters: 1 }])
    expect(result.fits).toBe(false)
  })

  it("uses every vertex instead of inferring bounds from triangle indices", () => {
    const mesh = { ...inside, vertices: [...inside.vertices, 101, 0, 1] }
    expect(checkPrintVolume([mesh], printer).overruns).toEqual([
      { axis: "x", side: "max", millimeters: 1 },
    ])
  })

  it("tolerates only tiny numerical noise and retains its signed distance", () => {
    const noise = PRINT_VOLUME_EPSILON_MM / 2
    const result = checkPrintVolume(
      [box("Noise", [-100 - noise, -50, -noise], [100, 50, 80])],
      printer,
    )
    expect(PRINT_VOLUME_EPSILON_MM).toBeLessThanOrEqual(1e-6)
    expect(result.fits).toBe(true)
    expect(result.overruns).toEqual([])
    expect(result.signedOutside.min[0]).toBeCloseTo(noise, 10)
    expect(result.signedOutside.min[2]).toBe(noise)
    expect(result.bounds.min[2]).toBe(-noise)
    expect(
      checkPrintVolume(
        [box("Real overrun", [-10, -10, -2 * PRINT_VOLUME_EPSILON_MM], [10, 10, 20])],
        printer,
      ).fits,
    ).toBe(false)
  })

  it.each([-120, -80, 0, 80, 120])("preserves dimensions under X translation by %s mm", (x) => {
    const result = checkPrintVolume([box("Shifted", [x - 10, -10, 0], [x + 10, 10, 20])], printer)
    expect(result.dimensions).toEqual([20, 20, 20])
    expect(result.fits).toBe(Math.abs(x) + 10 <= printer.width / 2)
    expect(result.fits).toBe(result.meshes.every((mesh) => mesh.fits))
  })

  it.each(
    [
      [],
      Array.from({ length: 11 }, () => inside),
      [{ ...inside, vertices: [] }],
      [{ ...inside, vertices: [...inside.vertices, 0] }],
      [{ ...inside, vertices: [Number.NaN, ...inside.vertices.slice(1)] }],
      [{ ...inside, vertices: [Infinity, ...inside.vertices.slice(1)] }],
      [{ ...inside, vertices: [100_001, ...inside.vertices.slice(1)] }],
      [{ ...inside, triangles: [] }],
      [{ ...inside, triangles: [...inside.triangles, 0] }],
      [{ ...inside, triangles: [-1, ...inside.triangles.slice(1)] }],
      [{ ...inside, triangles: [8, ...inside.triangles.slice(1)] }],
      [{ ...inside, triangles: [Number.NaN, ...inside.triangles.slice(1)] }],
      [{ ...inside, name: "" }],
      [{ ...inside, unknown: true }],
    ].map((meshes) => ({ meshes })),
  )("rejects empty, malformed, non-finite, or excessive mesh input %j", ({ meshes }) => {
    expect(() => checkPrintVolume(meshes, printer)).toThrow()
  })

  it("rejects malformed callers and profiles at the analysis boundary", () => {
    for (const raw of [null, undefined, {}, [null], [{ name: "Incomplete" }]]) {
      // @ts-expect-error Deliberately exercise untrusted runtime callers.
      expect(() => checkPrintVolume(raw, printer)).toThrow()
    }
    for (const profile of [
      { ...printer, height: Infinity },
      { ...printer, margin: 50 },
    ]) {
      expect(() => checkPrintVolume([inside], profile)).toThrow()
    }
  })

  it("bounds the total triangle budget across body and support meshes", () => {
    const large = { ...inside, triangles: Array.from({ length: 156_003 }, () => 0) }
    expect(() => checkPrintVolume([large, large], printer)).toThrow(/104,000 triangles/)
  })
})
