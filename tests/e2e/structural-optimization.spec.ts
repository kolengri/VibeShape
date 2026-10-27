import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type {
  StructuralOptimizationInput,
  StructuralOptimizationResult,
} from "../../packages/structural-optimization/src/contract"
import type {
  QuickLightweightingInput,
  QuickLightweightingResult,
} from "../../packages/structural-optimization/src/quick-contract"
import { denseBoxMesh } from "../../packages/structural-optimization/tests/dense-box-fixture"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

function specimen(lattice = false): StructuralOptimizationInput {
  const width = lattice ? 8 : 2
  return {
    schemaVersion: 1,
    mesh: {
      vertices: [
        0,
        0,
        0,
        0,
        0,
        width,
        0,
        width,
        0,
        0,
        width,
        width,
        10,
        0,
        0,
        10,
        0,
        width,
        10,
        width,
        0,
        10,
        width,
        width,
      ],
      indices: [
        0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1,
        5, 7, 1, 7, 3,
      ],
    },
    material: { youngModulusMpa: 1000, poissonRatio: 0, yieldStrengthMpa: 100, densityKgM3: 1000 },
    safetyFactor: 2,
    maxDisplacementMm: 1,
    cellSizeMm: 1,
    supports: [{ min: [0, 0, 0], max: [0, width, width] }],
    loadCases: [
      { name: "Axial", region: { min: [10, 0, 0], max: [10, width, width] }, forceN: [1, 0, 0] },
      {
        name: "Bending",
        region: { min: [10, 0, 0], max: [10, width, width] },
        forceN: [0, 0, 0.1],
      },
    ],
    preserveRegions: [],
    maxIterations: 8,
  }
}

for (const mode of ["Lightweighting", "Generative Design"] as const) {
  test(`exposes clickable method settings in the ${mode} task panel at compact sizes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto("/")
    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box", exact: true })
      .getByRole("button", { name: "Create box", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
    await invokeModelCommand(page, "Modify", mode)
    const panel = page.getByRole("region", { name: mode, exact: true })
    await panel.getByRole("combobox", { name: "Optimization method", exact: true }).click()
    await page.getByRole("option", { name: "Topology optimization (SIMP)", exact: true }).click()
    if (mode === "Lightweighting")
      await expect(panel.getByLabel("Target retained volume (%)", { exact: true })).toHaveValue(
        "50",
      )
    else
      await expect(
        panel.getByText("Each study scenario supplies its own retained-volume target.", {
          exact: true,
        }),
      ).toBeVisible()
    await panel.getByRole("combobox", { name: "Optimization method", exact: true }).click()
    await page.getByRole("option", { name: "Adaptive lattice (FEM)", exact: true }).click()
    await expect(
      panel.getByLabel("Minimum requested wall thickness (mm)", { exact: true }),
    ).toBeVisible()
    await expect(
      panel.getByRole("combobox", { name: "Thickness field", exact: true }),
    ).toBeVisible()
    const apply = panel.getByRole("button", { name: "Apply as new mesh Part", exact: true })
    if (mode === "Lightweighting") await expect(apply).toBeDisabled()
    else {
      await expect(apply).toHaveCount(0)
      await expect(
        panel.getByRole("button", { name: "Generate alternatives", exact: true }),
      ).toBeDisabled()
    }
    const overflow = await panel.evaluate((element) => element.scrollWidth > element.clientWidth)
    expect(overflow).toBe(false)
    for (const dark of [true, false]) {
      await page
        .locator("html")
        .evaluate((element, enabled) => element.classList.toggle("dark", enabled), dark)
      await page.screenshot({
        animations: "disabled",
        path: test.info().outputPath(dark ? "lattice-dark.png" : "lattice-light.png"),
      })
    }
    await page.setViewportSize({ width: 512, height: 384 })
    if (mode === "Generative Design") {
      const footer = panel.locator('[data-slot="task-panel-footer"]')
      await expect(
        footer.getByRole("button", { name: "Generate alternatives", exact: true }),
      ).toBeInViewport({ ratio: 1 })
      await expect(footer.getByRole("button", { name: "Close", exact: true })).toBeInViewport({
        ratio: 1,
      })
      const headerBounds = await panel.locator('[data-slot="task-panel-header"]').boundingBox()
      const footerBounds = await footer.boundingBox()
      if (!headerBounds || !footerBounds)
        throw new Error("Generative task chrome must have bounds.")
      expect(footerBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height)
      for (const button of await footer.getByRole("button").all()) {
        expect(await button.evaluate((element) => element.getBoundingClientRect().height)).toBe(32)
      }
      expect(await footer.locator("p").count()).toBe(0)
    }
    await panel
      .getByRole("combobox", { name: "Optimization method", exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      panel.getByRole("combobox", { name: "Optimization method", exact: true }),
    ).toBeInViewport()
    await expect(
      panel.getByRole("combobox", { name: "Optimization method", exact: true }),
    ).toBeVisible()
    expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
    await panel.getByRole("combobox", { name: "Optimization method", exact: true }).click()
    await page.getByRole("option", { name: "Topology optimization (SIMP)", exact: true }).click()
    await panel.getByLabel("Density filter radius (mm)", { exact: true }).fill("2")
    await expect(panel.getByLabel("Density filter radius (mm)", { exact: true })).toHaveValue("2")
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath("lattice-compact.png"),
    })
  })
}

test.describe("real structural browser worker", () => {
  test.use({ autoCreateProject: false })
  test("computes both methods, rejects stale cancellation, and restarts a terminated worker", async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await page.goto("/")
    await expect(
      page.getByRole("heading", { name: "Projects", level: 1, exact: true }),
    ).toBeVisible()
    const result = await page.evaluate(
      async ({ input, latticeInput, moduleUrl, runtimeBaseUrl }) => {
        const {
          optimizeStructuralModel,
        }: {
          optimizeStructuralModel: (
            input: StructuralOptimizationInput,
            options: { runtimeBaseUrl: string; signal?: AbortSignal },
          ) => Promise<StructuralOptimizationResult>
        } = await import(moduleUrl)
        const options = { runtimeBaseUrl: runtimeBaseUrl }
        const abort = new AbortController()
        const canceled = optimizeStructuralModel(
          {
            ...input,
            algorithm: { kind: "simp", volumeFraction: 0.8, filterRadiusMm: 1.5, penalty: 3 },
          },
          { ...options, signal: abort.signal },
        ).then(
          () => "unexpected-success",
          (error: unknown) => (error instanceof Error ? error.name : "unknown-error"),
        )
        abort.abort()
        const canceledName = await canceled
        const simp = await optimizeStructuralModel(
          {
            ...input,
            algorithm: { kind: "simp", volumeFraction: 0.8, filterRadiusMm: 1.5, penalty: 3 },
          },
          options,
        )
        const lattice = await optimizeStructuralModel(
          {
            ...latticeInput,
            algorithm: {
              kind: "adaptive-lattice",
              lattice: "gyroid",
              cellPeriodMm: 12,
              minWallThicknessMm: 2,
              maxWallThicknessMm: 3,
              skinThicknessMm: 0,
              field: "strain-energy",
              gamma: 1,
            },
          },
          options,
        )
        const summarize = (value: typeof simp) => ({
          status: value.status,
          initial: value.initialCellCount,
          final: value.finalCellCount,
          stress: value.optimized.maxVonMisesMpa,
          displacement: value.optimized.maxDisplacementMm,
          triangles: value.mesh.indices.length / 3,
          algorithm: value.algorithm,
        })
        return { canceledName, simp: summarize(simp), lattice: summarize(lattice) }
      },
      {
        input: { ...specimen(), mesh: denseBoxMesh({ min: [0, 0, 0], max: [10, 2, 2] }) },
        latticeInput: specimen(true),
        moduleUrl: `/@fs${resolve("packages/structural-optimization/src/client.ts")}`,
        runtimeBaseUrl: new URL("/structural-runtime/", page.url()).href,
      },
    )
    await test.info().attach("numerical-results", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    })
    await writeFile(
      test.info().outputPath("numerical-results.json"),
      JSON.stringify(result, null, 2),
    )
    expect(result.canceledName).toBe("AbortError")
    for (const value of [result.simp, result.lattice]) {
      expect(value.final).toBeLessThan(value.initial)
      expect(value.stress).toBeLessThanOrEqual(20)
      expect(value.displacement).toBeLessThanOrEqual(1)
      expect(value.triangles).toBeGreaterThan(0)
    }
    expect(result.simp.algorithm?.kind).toBe("simp")
    expect(result.lattice.algorithm?.kind).toBe("adaptive-lattice")
  })

  test("generates Quick geometry beyond the former source limits in a real browser worker", async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await page.goto("/")
    await expect(
      page.getByRole("heading", { name: "Projects", level: 1, exact: true }),
    ).toBeVisible()
    const mesh = denseBoxMesh({ min: [0, 0, 0], max: [10, 10, 10] })
    expect(mesh.vertices.length / 3).toBeGreaterThan(10_000)
    expect(mesh.indices.length / 3).toBeGreaterThan(20_000)
    const result = await page.evaluate(
      async ({ input, moduleUrl, runtimeBaseUrl }) => {
        const {
          generateQuickLightweighting,
        }: {
          generateQuickLightweighting: (
            input: QuickLightweightingInput,
            options: { runtimeBaseUrl: string },
          ) => Promise<QuickLightweightingResult>
        } = await import(moduleUrl)
        const result = await generateQuickLightweighting(input, { runtimeBaseUrl })
        return {
          removedPercent: result.removedPercent,
          triangles: result.mesh.indices.length / 3,
          unchangedExterior:
            input.mesh.vertices.every((value, index) => result.mesh.vertices[index] === value) &&
            input.mesh.indices.every((value, index) => result.mesh.indices[index] === value),
        }
      },
      {
        input: {
          schemaVersion: 1 as const,
          mesh,
          mode: "preserve-exterior" as const,
          removalPercent: 20,
          cellSizeMm: 1,
          skinThicknessMm: 2,
        },
        moduleUrl: `/@fs${resolve("packages/structural-optimization/src/quick-client.ts")}`,
        runtimeBaseUrl: new URL("/structural-runtime/", page.url()).href,
      },
    )
    expect(result.unchangedExterior).toBe(true)
    expect(result.triangles).toBeGreaterThan(mesh.indices.length / 3)
    expect(result.removedPercent).toBeGreaterThan(0.5)
    expect(result.removedPercent).toBeLessThan(100)
  })
})
