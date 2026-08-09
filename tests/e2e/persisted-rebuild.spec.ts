import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

type HarnessState = {
  state: "running" | "passed" | "closed" | "failed"
  phase: "created" | "opened" | null
  recoveryStatus: "created" | "clean" | "recovered" | "recovered-with-loss" | null
  mode: "read-write" | "read-only" | null
  revision: number
  variables: readonly { name: string; expression: string }[]
  rebuild: {
    evaluatedFeatureIds: readonly string[]
    reusedFeatureIds: readonly string[]
    geometry: readonly { featureId: string; contentHash: string; volume: number }[]
  } | null
  closeResult: "clean" | "failed" | null
  error: string | null
}

const featureIds = {
  box: "0195b5ac-b250-7f2c-9c33-67a36a7f3101",
  cylinder: "0195b5ac-b250-7f2c-9c33-67a36a7f3102",
  boolean: "0195b5ac-b250-7f2c-9c33-67a36a7f3103",
} as const

async function waitForHarness(page: Page) {
  const status = page.getByRole("status")
  await expect(status).not.toHaveAttribute("data-state", "running", { timeout: 120_000 })
  await expect(status).toHaveAttribute("data-state", "passed")
  const state = await page.evaluate<HarnessState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_PERSISTED_REBUILD__"),
  )
  expect(state.error).toBeNull()
  expect(state.revision).toBe(5)
  expect(state.mode).toBe("read-write")
  expect(state.variables).toEqual([{ name: "width", expression: "20 mm" }])
  expect(state.rebuild?.geometry.map(({ featureId }) => featureId)).toEqual([
    featureIds.box,
    featureIds.cylinder,
    featureIds.boolean,
  ])
  const result = state.rebuild?.geometry.find(({ featureId }) => featureId === featureIds.boolean)
  expect(result?.volume).toBeCloseTo(20 * 30 * 25.4 - Math.PI * 5 ** 2 * 25.4, 5)
  return state
}

test("recovers and rebuilds a persisted configurable model after reload and clean reopen", async ({
  page,
}) => {
  await page.goto("/spikes/persisted-rebuild.html")
  const created = await waitForHarness(page)
  expect(created).toMatchObject({ phase: "created", recoveryStatus: "created" })

  await page.reload()
  const recovered = await waitForHarness(page)
  expect(recovered).toMatchObject({ phase: "opened", recoveryStatus: "recovered" })
  expect(recovered.rebuild?.evaluatedFeatureIds).toEqual([
    featureIds.box,
    featureIds.cylinder,
    featureIds.boolean,
  ])

  await page.evaluate(() =>
    Reflect.get(globalThis, "__VIBESHAPE_PERSISTED_REBUILD_CONTROL__").close(),
  )
  await expect(page.getByRole("status")).toHaveAttribute("data-state", "closed")
  const closed = await page.evaluate<HarnessState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_PERSISTED_REBUILD__"),
  )
  expect(closed.closeResult).toBe("clean")

  await page.reload()
  const reopened = await waitForHarness(page)
  expect(reopened).toMatchObject({ phase: "opened", recoveryStatus: "clean" })
})
