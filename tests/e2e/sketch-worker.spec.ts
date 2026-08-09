import { expect, test } from "@playwright/test"

test.setTimeout(120_000)

type SketchWorkerReport = {
  constrained: {
    status: string
    degreesOfFreedom: number
    length: number
    maximumResidual: number
  }
  continuation: {
    first: { x: number; y: number }
    second: { x: number; y: number }
    status: string
  }
  large: {
    pointCount: number
    status: string
    degreesOfFreedom: number
    solveMs: number
    heapCapacityBytes: number
  }
  solverBuild: {
    sourceRevision: string
    wasmSha256: string
  }
}

test("production sketch worker solves, continues a drag branch, and stays within scale budgets", async ({
  page,
}) => {
  await page.goto("/spikes/sketch-worker.html")
  const output = page.locator("#result")
  await expect(output).toHaveAttribute("data-status", "complete", { timeout: 120_000 })
  const report = JSON.parse(await output.innerText()) as SketchWorkerReport

  expect(report.constrained).toMatchObject({
    status: "fully-constrained",
    degreesOfFreedom: 0,
  })
  expect(report.constrained.length).toBeCloseTo(30, 6)
  expect(report.constrained.maximumResidual).toBeLessThanOrEqual(1e-7)
  expect(report.continuation.status).toBe("under-constrained")
  expect(report.continuation.first.x).toBeCloseTo(12, 4)
  expect(report.continuation.first.y).toBeCloseTo(8, 4)
  expect(report.continuation.second.x).toBeCloseTo(18, 4)
  expect(report.continuation.second.y).toBeCloseTo(14, 4)
  expect(report.large).toMatchObject({
    pointCount: 1_000,
    status: "under-constrained",
    degreesOfFreedom: 2_000,
  })
  expect(report.large.solveMs).toBeLessThan(2_000)
  expect(report.large.heapCapacityBytes).toBeLessThanOrEqual(64 * 1024 * 1024)
  expect(report.solverBuild).toEqual({
    schemaVersion: 0,
    solver: "SolveSpace",
    solverVersion: "3.2",
    sourceRevision: "27b6a080c8b669421bd4d444650c3b8eddec5687",
    abiVersion: 1,
    moduleSha256: "60c8714fbd5d94a50bdfcde7bd1658cfb2a180ad44be124997905ece7be545c7",
    wasmSha256: "c9e3e35084b3812e9eae7bdff8fd3290394918c88ba38504e58a9a9d4a2bd978",
  })
})
