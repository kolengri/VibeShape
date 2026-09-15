import { expect, test } from "./fixtures"

type SelectedEdgeState = {
  state: "running" | "passed" | "failed"
  selectedEdgeTreatments: {
    fillet: { shape: { valid: boolean; solidCount: number; volume: number } }
    chamfer: { shape: { valid: boolean; solidCount: number; volume: number } }
    twoEdgeFillet: { shape: { valid: boolean; solidCount: number; volume: number } }
    sourceVolume: number
    sourceVolumeAfter: number
    rejected: string[]
  } | null
  error: string | null
  disposal: { ownedShapeCount: number } | null
}

test.setTimeout(120_000)

test("evaluates selected-edge fillet and chamfer through the real geometry worker", async ({
  page,
}) => {
  await page.goto("/spikes/geometry-worker.html?selectedEdgeTreatments=true&lifecycleBatches=1")
  await expect(page.getByRole("status")).not.toHaveAttribute("data-state", "running", {
    timeout: 120_000,
  })
  const state = await page.evaluate<SelectedEdgeState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_GEOMETRY_SPIKE__"),
  )
  expect(state.error).toBeNull()
  expect(state.state).toBe("passed")
  expect(state.selectedEdgeTreatments).not.toBeNull()
  if (!state.selectedEdgeTreatments) throw new Error("Selected-edge evidence was not published.")
  const { fillet, chamfer, twoEdgeFillet, sourceVolume } = state.selectedEdgeTreatments
  for (const result of [fillet, chamfer, twoEdgeFillet]) {
    expect(result.shape.valid).toBe(true)
    expect(result.shape.solidCount).toBe(1)
    expect(result.shape.volume).toBeGreaterThan(0)
    expect(result.shape.volume).toBeLessThan(sourceVolume)
  }
  expect(state.selectedEdgeTreatments.sourceVolumeAfter).toBeCloseTo(8000, 6)
  expect(sourceVolume).toBeCloseTo(8000, 6)
  expect(twoEdgeFillet.shape.volume).toBeCloseTo(sourceVolume - 40 * (1 - Math.PI / 4), 4)
  expect(chamfer.shape.volume).toBeCloseTo(sourceVolume - (20 * 1 ** 2) / 2, 4)
  expect(fillet.shape.volume).toBeCloseTo(sourceVolume - 20 * 1 ** 2 * (1 - Math.PI / 4), 4)
  expect(state.selectedEdgeTreatments.rejected).toEqual(["missing", "duplicate"])
  expect(state.disposal?.ownedShapeCount).toBe(0)
})
