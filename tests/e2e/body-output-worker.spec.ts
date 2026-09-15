import { expect, test } from "./fixtures"

type BodyOutputState = {
  state: string
  error: string | null
  bodyOutputs: {
    legacyVolume: number
    namedVolume: number
    differentHashes: boolean
    cacheHit: boolean
    sourceVolume: number
    sourceVolumeAfter: number
    holeV2Volume: number
    holeV2BodyRoles: string[]
    aggregateSolidCount: number
    aggregateVolume: number
    ownedCounts: number[]
    rejected: string[]
  } | null
  disposal: { ownedShapeCount: number } | null
  restart: {
    afterInitialization: { ownedShapeCount: number }
    disposal: { ownedShapeCount: number }
  } | null
}

test.setTimeout(120_000)

test("binds named single-body inputs to exact native content and ownership", async ({ page }) => {
  await page.goto("/spikes/geometry-worker.html?bodyOutputs=true&lifecycleBatches=1")
  await expect(page.getByRole("status")).toHaveAttribute("data-state", /passed|failed/, {
    timeout: 120_000,
  })
  const state = await page.evaluate<BodyOutputState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_GEOMETRY_SPIKE__"),
  )
  expect(state.error, JSON.stringify(state)).toBeNull()
  expect(state.state).toBe("passed")
  const result = state.bodyOutputs
  expect(result).not.toBeNull()
  if (!result) throw new Error("Named body fixture evidence was not published.")
  expect(result.namedVolume).toBeGreaterThan(0)
  expect(result.namedVolume).toBeLessThan(8_000)
  expect(result.namedVolume).toBeCloseTo(result.legacyVolume, 7)
  expect(result.differentHashes).toBe(true)
  expect(result.cacheHit).toBe(true)
  expect(result.sourceVolume).toBeCloseTo(8_000, 7)
  expect(result.sourceVolumeAfter).toBeCloseTo(8_000, 7)
  expect(result.holeV2Volume).toBeLessThan(result.sourceVolume)
  expect(result.holeV2Volume).toBeCloseTo(result.sourceVolume - Math.PI * 5, 5)
  expect(result.holeV2BodyRoles).toEqual(["result"])
  expect(result.aggregateSolidCount).toBe(2)
  expect(result.aggregateVolume).toBeCloseTo(160, 6)
  expect(result.ownedCounts).toEqual([4, 4, 4, 4])
  expect(result.rejected).toEqual([
    "unknown-role",
    "stale-source-before-cache-hit",
    "unnamed-multi-solid-result",
  ])
  expect(state.disposal?.ownedShapeCount).toBe(0)
  expect(state.restart?.afterInitialization.ownedShapeCount).toBe(0)
  expect(state.restart?.disposal.ownedShapeCount).toBe(0)
})
