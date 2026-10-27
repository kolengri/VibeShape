import { expect, it } from "bun:test"
import type { QuickLightweightingInput } from "./quick-contract"
import { generateQuickIsosurface, quickGridSchema } from "./quick-isosurface"

const request: QuickLightweightingInput = {
  schemaVersion: 1,
  mesh: { vertices: [], indices: [] },
  mode: "preserve-exterior",
  removalPercent: 0.1,
  cellSizeMm: 1,
  skinThicknessMm: 2,
}

it("extracts complete dense surfaces beyond the former 120,000-triangle buffer", () => {
  const resolution = 40
  const envelope: number[] = []
  const lattice: number[] = []
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        envelope.push(
          Math.min(x - 2, y - 2, z - 2, resolution - 3 - x, resolution - 3 - y, resolution - 3 - z),
        )
        lattice.push((x + y + z) % 2)
      }
    }
  }
  const result = generateQuickIsosurface(
    {
      schemaVersion: 1,
      mesh: { vertices: [], indices: [] },
      mode: "open-organic",
      removalPercent: 50,
      cellSizeMm: 1,
      skinThicknessMm: 0,
    },
    {
      resolution,
      envelope,
      lattice,
      sourceVolumeCells: resolution ** 3,
      thresholdMin: 0.25,
      thresholdMax: 0.75,
    },
  )
  expect(result.indices.length / 3).toBeGreaterThan(120_000)
  expect(result.vertices.length).toBe(result.indices.length * 3)
  expect(result.vertices.every(Number.isFinite)).toBe(true)
  expect(result.indices.at(-1)).toBe(result.vertices.length / 3 - 1)
})

it("retains a positive-volume candidate below half a percent of the source volume", () => {
  const resolution = 10
  const envelope = Array.from({ length: resolution ** 3 }, (_, index) => {
    const x = index % resolution
    const y = Math.floor(index / resolution) % resolution
    const z = Math.floor(index / resolution ** 2)
    return 2 - Math.hypot(x - 4.5, y - 4.5, z - 4.5)
  })
  const result = generateQuickIsosurface(request, {
    resolution,
    envelope,
    lattice: Array.from({ length: resolution ** 3 }, () => 1),
    sourceVolumeCells: 100_000,
    thresholdMin: 0.25,
    thresholdMax: 0.75,
  })
  expect(result.indices.length).toBeGreaterThan(0)
  expect(result.vertices.every(Number.isFinite)).toBe(true)
  // The cavity lies in a four-cell-wide box: its volume is below 64,
  // independently of the extraction's own triangle-volume calculation.
  for (const coordinate of result.vertices) {
    expect(coordinate).toBeGreaterThan(-0.5)
    expect(coordinate).toBeLessThan(3.5)
  }
})

it("counts the Float32 field when tiny signed samples round to zero", () => {
  const resolution = 10
  let failure: unknown
  try {
    generateQuickIsosurface(request, {
      resolution,
      envelope: Array.from({ length: resolution ** 3 }, () => 1),
      lattice: Array.from({ length: resolution ** 3 }, (_, index) => (index % 2) * 1e-50),
      sourceVolumeCells: 1000,
      thresholdMin: 2.5e-51,
      thresholdMax: 7.5e-51,
    })
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({ code: "no-removable-material" })
})

it("requires complete finite sampling fields and the mathematical TPMS amplitude bound", () => {
  const grid = {
    resolution: 10,
    envelope: Array.from({ length: 1000 }, () => 1),
    lattice: Array.from({ length: 1000 }, () => 1),
    sourceVolumeCells: 1000,
    thresholdMin: 0.25,
    thresholdMax: 0.75,
  }
  expect(quickGridSchema.safeParse({ ...grid, envelope: grid.envelope.slice(1) }).success).toBe(
    false,
  )
  expect(quickGridSchema.safeParse({ ...grid, lattice: [...grid.lattice, 1] }).success).toBe(false)
  expect(
    quickGridSchema.safeParse({ ...grid, envelope: [Number.NaN, ...grid.envelope.slice(1)] })
      .success,
  ).toBe(false)
  expect(quickGridSchema.safeParse({ ...grid, thresholdMax: 3.01 }).success).toBe(false)
})
