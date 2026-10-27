import { expect, it } from "bun:test"
import { generateQuickIsosurface } from "./quick-isosurface"

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
