import { once } from "node:events"
import { readdir } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { startEditorServer } from "../../apps/desktop/src/editor-server"
import {
  type StructuralOptimizationInput,
  structuralSolverResponseSchema,
} from "../../packages/structural-optimization/src/contract"
import {
  type QuickLightweightingInput,
  quickLightweightingResponseSchema,
} from "../../packages/structural-optimization/src/quick-contract"
import { denseBoxMesh } from "../../packages/structural-optimization/tests/dense-box-fixture"

const directory = resolve(import.meta.dirname, "../../apps/web/dist")
let host: Awaited<ReturnType<typeof startEditorServer>>
let origin: string
let structuralWorker: string
let quickWorker: string

test.beforeAll(async () => {
  const files = await readdir(resolve(directory, "assets"))
  const structural = files.filter((name) => /^worker-[\w-]{8}\.js$/.test(name))
  const quick = files.filter((name) => /^quick-worker-[\w-]{8}\.js$/.test(name))
  expect(structural).toHaveLength(1)
  expect(quick).toHaveLength(1)
  structuralWorker = `/assets/${structural[0]}`
  quickWorker = `/assets/${quick[0]}`
  const reserve = createServer()
  reserve.listen(0, "127.0.0.1")
  await once(reserve, "listening")
  const address = reserve.address()
  if (!address || typeof address === "string") throw new Error("Missing isolated HTTP port.")
  await new Promise<void>((done) => reserve.close(() => done()))
  origin = `http://127.0.0.1:${address.port}`
  host = await startEditorServer(directory, { origin })
})

test.afterAll(async () => {
  await host?.close()
})

function runWorker(
  page: Page,
  url: string,
  input: StructuralOptimizationInput | QuickLightweightingInput,
  runtimePath = "/structural-runtime/",
) {
  return page.evaluate(
    ({ url, input, runtimeBaseUrl }) =>
      new Promise<unknown>((resolve, reject) => {
        const worker = new Worker(url, { type: "module" })
        const timer = setTimeout(() => {
          worker.terminate()
          reject(new Error("The built numerical worker did not complete."))
        }, 90_000)
        worker.onerror = (event) => {
          clearTimeout(timer)
          worker.terminate()
          reject(new Error(event.message))
        }
        worker.onmessage = (event) => {
          if (event.data.type !== "complete") return
          clearTimeout(timer)
          worker.terminate()
          resolve(event.data.response)
        }
        worker.postMessage({ input, runtimeBaseUrl })
      }),
    { url, input, runtimeBaseUrl: new URL(runtimePath, page.url()).href },
  )
}

const structuralInput: StructuralOptimizationInput = {
  schemaVersion: 1,
  mesh: denseBoxMesh({ subdivisions: 1, min: [0, 0, 0], max: [10, 2, 2] }),
  material: { youngModulusMpa: 1_000, poissonRatio: 0, yieldStrengthMpa: 100, densityKgM3: 1_000 },
  supports: [{ min: [0, 0, 0], max: [0, 2, 2] }],
  loadCases: [{ name: "Axial", region: { min: [10, 0, 0], max: [10, 2, 2] }, forceN: [1, 0, 0] }],
  preserveRegions: [],
  safetyFactor: 2,
  maxDisplacementMm: 1,
  cellSizeMm: 1,
  maxIterations: 1,
  algorithm: { kind: "simp", volumeFraction: 0.8, filterRadiusMm: 1.5, penalty: 3 },
}
const quickInput: QuickLightweightingInput = {
  schemaVersion: 1,
  mesh: denseBoxMesh({ subdivisions: 1, min: [0, 0, 0], max: [10, 10, 10] }),
  mode: "preserve-exterior",
  cellType: "schwarz-p",
  removalPercent: 50,
  cellSizeMm: 10 / 32,
  skinThicknessMm: 20 / 32,
}

test("built SIMP and Schwarz P workers calculate through the desktop static host", async ({
  page,
}) => {
  await page.goto(origin)
  const structural = structuralSolverResponseSchema.parse(
    await runWorker(page, structuralWorker, structuralInput),
  )
  if (!structural.ok) throw new Error(`${structural.error.code}: ${structural.error.message}`)
  expect(structural.result.algorithm?.kind).toBe("simp")
  expect(structural.result.initialCellCount).toBe(40)
  expect(structural.result.baseline.maxVonMisesMpa).toBeCloseTo(0.25, 8)
  const quick = quickLightweightingResponseSchema.parse(
    await runWorker(page, quickWorker, quickInput),
  )
  if (!quick.ok) throw new Error(`${quick.error.code}: ${quick.error.message}`)
  expect(quick.result.cellType).toBe("schwarz-p")
  expect(quick.result.removedPercent).toBeGreaterThanOrEqual(0.5)
  expect(quick.result.mesh.vertices.slice(0, quickInput.mesh.vertices.length)).toEqual(
    quickInput.mesh.vertices,
  )
  expect(quick.result.mesh.indices.slice(0, quickInput.mesh.indices.length)).toEqual(
    quickInput.mesh.indices,
  )
})

test("both built workers identify a missing numerical module in bounded failure responses", async ({
  page,
}) => {
  await page.goto(origin)
  for (const [worker, input] of [
    [structuralWorker, structuralInput],
    [quickWorker, quickInput],
  ] as const) {
    const response = structuralSolverResponseSchema.parse(
      await runWorker(page, worker, input, "/missing/structural-runtime/"),
    )
    expect(response.ok).toBe(false)
    if (response.ok) throw new Error("Missing runtime unexpectedly completed.")
    expect(response.error.code).toBe("runtime-unavailable")
    expect(response.error.message).toContain("module loading")
    expect(response.error.message).toContain("pyodide.mjs")
    expect(response.error.message.length).toBeLessThanOrEqual(512)
  }
})
