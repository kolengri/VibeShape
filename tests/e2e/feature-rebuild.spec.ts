import type { FeatureId } from "../../packages/domain/src"
import { expect, test } from "./fixtures"

type RebuildSummary = {
  records: readonly { featureId: FeatureId; status: string; contentHash?: string }[]
  dirtyFeatureIds: readonly FeatureId[]
  evaluatedFeatureIds: readonly FeatureId[]
  reusedFeatureIds: readonly FeatureId[]
  geometry: readonly {
    featureId: FeatureId
    contentHash: string
    volume: number
    brepHit: boolean
  }[]
}

interface FeatureRebuildHarnessState {
  state: "running" | "passed" | "failed"
  initial: RebuildSummary | null
  reused: RebuildSummary | null
  recovered: RebuildSummary | null
  changed: RebuildSummary | null
  generation: number
  requestFeatureIds: FeatureId[]
  progress: string[]
  health: { ownedShapeCount: number; activeDocuments: number } | null
  disposal: { ownedShapeCount: number } | null
  error: string | null
}

const featureIds = {
  box: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
  cylinder: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
  boolean: "0195b5ac-b220-7a2c-8c33-67a36a7f3103",
} as const

function requireSummary(summary: RebuildSummary | null) {
  expect(summary).not.toBeNull()
  if (!summary) throw new Error("The feature rebuild did not publish a summary.")
  return summary
}

function geometryById(summary: RebuildSummary, featureId: string) {
  const geometry = summary.geometry.find((record) => record.featureId === featureId)
  expect(geometry).toBeDefined()
  if (!geometry) throw new Error(`Feature ${featureId} did not publish geometry.`)
  return geometry
}

test("coordinates dependency-aware rebuild, recovery, and clean-result reuse", async ({ page }) => {
  await page.goto("/spikes/feature-rebuild.html")

  const status = page.getByRole("status")
  await expect(status).not.toHaveAttribute("data-state", "running", { timeout: 120_000 })
  await expect(status).toHaveAttribute("data-state", "passed")

  const state = await page.evaluate<FeatureRebuildHarnessState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_FEATURE_REBUILD__"),
  )
  expect(state.error).toBeNull()
  const initial = requireSummary(state.initial)
  const reused = requireSummary(state.reused)
  const recovered = requireSummary(state.recovered)
  const changed = requireSummary(state.changed)

  expect(initial.evaluatedFeatureIds).toEqual([
    featureIds.cylinder,
    featureIds.box,
    featureIds.boolean,
  ])
  expect(initial.geometry.map(({ featureId }) => featureId)).toEqual([
    featureIds.boolean,
    featureIds.cylinder,
    featureIds.box,
  ])
  expect(initial.geometry.every(({ brepHit }) => !brepHit)).toBe(true)
  expect(geometryById(initial, featureIds.boolean).volume).toBeCloseTo(
    20 * 30 * 25.4 - Math.PI * 5 ** 2 * 25.4,
    5,
  )

  expect(reused.evaluatedFeatureIds).toEqual([])
  expect(reused.reusedFeatureIds).toEqual([featureIds.cylinder, featureIds.box, featureIds.boolean])
  expect(reused.geometry).toEqual(initial.geometry)

  expect(recovered.evaluatedFeatureIds).toEqual([
    featureIds.cylinder,
    featureIds.box,
    featureIds.boolean,
  ])
  expect(recovered.reusedFeatureIds).toEqual([])
  expect(recovered.geometry).toEqual(initial.geometry)
  expect(state.generation).toBe(2)

  expect(changed.evaluatedFeatureIds).toEqual([featureIds.cylinder, featureIds.boolean])
  expect(changed.reusedFeatureIds).toEqual([featureIds.box])
  expect(geometryById(changed, featureIds.box)).toEqual(geometryById(initial, featureIds.box))
  expect(geometryById(changed, featureIds.cylinder).contentHash).not.toBe(
    geometryById(initial, featureIds.cylinder).contentHash,
  )
  expect(geometryById(changed, featureIds.boolean).contentHash).not.toBe(
    geometryById(initial, featureIds.boolean).contentHash,
  )
  expect(geometryById(changed, featureIds.boolean).volume).toBeCloseTo(
    20 * 30 * 25.4 - Math.PI * 5 ** 2 * 10,
    5,
  )

  expect(state.requestFeatureIds).toEqual([
    featureIds.cylinder,
    featureIds.box,
    featureIds.boolean,
    featureIds.cylinder,
    featureIds.box,
    featureIds.boolean,
    featureIds.cylinder,
    featureIds.boolean,
  ])
  expect(state.progress).toHaveLength(8 * 4)
  expect(state.health).toMatchObject({
    initialized: true,
    ownedShapeCount: 3,
    activeDocuments: 1,
    wasmHeapBytes: expect.any(Number),
  })
  expect(state.disposal).toMatchObject({ ownedShapeCount: 0 })
})
