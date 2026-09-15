import { expect, test } from "./fixtures"

type EdgeTreatmentState = {
  state: "running" | "passed" | "failed"
  edgeTreatments: {
    rejected: string[]
    sourceVolume: number
    retainedShapeCounts: number[]
    fillet: { shape: { valid: boolean; volume: number; solidCount: number } }
    chamfer: { shape: { valid: boolean; volume: number; solidCount: number } }
  } | null
  error: string | null
  disposal: { ownedShapeCount: number } | null
}

test.setTimeout(120_000)

test("evaluates all-edge fillet and chamfer on one solid in the geometry worker", async ({
  page,
}) => {
  await page.goto("/spikes/geometry-worker.html?lifecycleIterations=1&edgeTreatments=true")
  const status = page.getByRole("status")
  await expect(status).toHaveAttribute("data-state", "passed", { timeout: 120_000 })

  const state = await page.evaluate<EdgeTreatmentState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_GEOMETRY_SPIKE__"),
  )
  expect(state.error).toBeNull()
  expect(state.edgeTreatments).not.toBeNull()
  if (!state.edgeTreatments) throw new Error("Edge treatment evidence was not published.")
  for (const result of [state.edgeTreatments.fillet, state.edgeTreatments.chamfer]) {
    expect(result.shape.valid).toBe(true)
    expect(result.shape.solidCount).toBe(1)
    expect(result.shape.volume).toBeGreaterThan(0)
  }
  expect(state.edgeTreatments.rejected).toEqual(["fillet", "chamfer"])
  expect(state.edgeTreatments.sourceVolume).toBeCloseTo(8000, 6)
  expect(state.edgeTreatments.retainedShapeCounts).toEqual(Array(8).fill(3))
  expect(state.disposal?.ownedShapeCount).toBe(0)
  expect(state.edgeTreatments.fillet.shape.volume).toBeLessThan(8_000)
  expect(state.edgeTreatments.chamfer.shape.volume).toBeLessThan(8_000)
})
