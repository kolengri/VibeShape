import { expect, test } from "./fixtures"

type HoleShape = {
  valid: boolean
  solidCount: number
  volume: number
  bounds: { min: number[]; max: number[] }
}

type HoleState = {
  state: "running" | "passed" | "failed"
  holes: {
    blindForward: { shape: HoleShape }
    blindReverse: { shape: HoleShape }
    throughAll: { shape: HoleShape }
    throughReverse: { shape: HoleShape }
    multiCenter: { shape: HoleShape }
    smallBlind: { shape: HoleShape }
    rotatedFrame: { shape: HoleShape }
    rejected: string[]
    sourceVolume: number
    sourceVolumeAfter: number
  } | null
  error: string | null
  disposal: { ownedShapeCount: number } | null
}

test.setTimeout(120_000)

test("evaluates sketch point holes through the real geometry worker", async ({ page }) => {
  await page.goto("/spikes/geometry-worker.html?holes=true&lifecycleBatches=1")
  await expect(page.getByRole("status")).toHaveAttribute("data-state", /passed|failed/, {
    timeout: 120_000,
  })
  const state = await page.evaluate<HoleState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_GEOMETRY_SPIKE__"),
  )
  expect(state.error, JSON.stringify(state)).toBeNull()
  expect(state.state).toBe("passed")
  expect(state.holes).not.toBeNull()
  if (!state.holes) throw new Error("Hole fixture evidence was not published.")
  for (const result of [
    state.holes.blindForward,
    state.holes.blindReverse,
    state.holes.throughAll,
    state.holes.throughReverse,
    state.holes.multiCenter,
    state.holes.smallBlind,
    state.holes.rotatedFrame,
  ]) {
    expect(result.shape.valid).toBe(true)
    expect(result.shape.solidCount).toBe(1)
    expect(result.shape.volume).toBeGreaterThan(0)
    expect(result.shape.volume).toBeLessThan(state.holes.sourceVolume)
    for (const [index, value] of [-10, -10, 0].entries()) {
      expect(result.shape.bounds.min[index]).toBeCloseTo(value, 5)
    }
    for (const [index, value] of [10, 10, 20].entries()) {
      expect(result.shape.bounds.max[index]).toBeCloseTo(value, 5)
    }
  }
  expect(state.holes.blindForward.shape.volume).toBeCloseTo(8_000 - Math.PI, 2)
  expect(state.holes.blindReverse.shape.volume).toBeCloseTo(8_000 - Math.PI, 2)
  expect(state.holes.throughAll.shape.volume).toBeCloseTo(8_000 - Math.PI * 10, 1)
  expect(state.holes.throughReverse.shape.volume).toBeCloseTo(8_000 - Math.PI * 10, 1)
  expect(state.holes.multiCenter.shape.volume).toBeCloseTo(8_000 - Math.PI * 20, 1)
  expect(state.holes.smallBlind.shape.volume).toBeCloseTo(8_000 - Math.PI * 0.000025, 5)
  expect(state.holes.rejected).toEqual([
    "no-op:invalid-feature-geometry",
    "split:invalid-feature-geometry",
    "empty:invalid-feature-geometry",
  ])
  expect(state.holes.sourceVolume).toBeCloseTo(8_000, 6)
  expect(state.holes.sourceVolumeAfter).toBeCloseTo(8_000, 6)
  expect(state.disposal?.ownedShapeCount).toBe(0)
})
