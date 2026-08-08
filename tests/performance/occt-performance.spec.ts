import { mkdirSync, writeFileSync } from "node:fs"
import { arch, cpus, platform, release, totalmem } from "node:os"
import { expect, test } from "@playwright/test"
import type { GeometryWorkerResponse } from "../../packages/protocol/src"
import { OCCT_BUILD_INPUTS } from "../../scripts/occt-build-config"

type KernelResponse = Extract<GeometryWorkerResponse, { type: "kernelSpikeCompleted" }>

interface GeometrySpikeHarnessState {
  result: KernelResponse | null
  restart: { result: KernelResponse } | null
  error: string | null
}

interface LongTaskState {
  supported: boolean
  durationsMs: number[]
}

interface PerformanceSample {
  run: number
  worker: "primary" | "restarted"
  initializationMs: number
  scenarioMs: number
  peakWasmHeapBytes: number
  peakAllocatedBytes: number
  timings: KernelResponse["timings"]
}

const PERFORMANCE_BUDGETS = {
  workerInitializationP95Ms: 500,
  scenarioP95Ms: 500,
  mainThreadLongTaskMaxMs: 100,
  peakWasmHeapBytes: 64 * 1024 * 1024,
  peakAllocatedBytes: 4 * 1024 * 1024,
} as const

const longTaskStateKey = "__VIBESHAPE_OCCT_LONG_TASKS__"

function readPageRuns() {
  const value = Number(process.env.VIBESHAPE_OCCT_PERFORMANCE_PAGE_RUNS ?? 10)

  if (!Number.isSafeInteger(value) || value < 5 || value > 50) {
    throw new Error("VIBESHAPE_OCCT_PERFORMANCE_PAGE_RUNS must be an integer between 5 and 50.")
  }

  return value
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) {
    throw new Error("A percentile requires at least one sample.")
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1)
  const value = sorted[index]

  if (value === undefined) {
    throw new Error("The percentile sample index is out of bounds.")
  }

  return value
}

function requireResult<Result>(result: Result | null): Result {
  if (result === null) {
    throw new Error("The geometry performance harness did not publish a result.")
  }

  return result
}

function max(values: number[]) {
  if (values.length === 0) {
    throw new Error("A maximum requires at least one sample.")
  }

  return Math.max(...values)
}

function createPerformanceSample(
  run: number,
  worker: PerformanceSample["worker"],
  result: KernelResponse,
): PerformanceSample {
  const allocatedBytes = result.memory.snapshots.map((snapshot) => {
    if (!snapshot.allocator) {
      throw new Error("Controlled performance evidence requires allocator instrumentation.")
    }

    return snapshot.allocator.allocatedBytes
  })

  return {
    run,
    worker,
    initializationMs: result.engine.initializedInMs,
    scenarioMs: result.timings.totalMs,
    peakWasmHeapBytes: max(result.memory.snapshots.map((snapshot) => snapshot.heapCapacityBytes)),
    peakAllocatedBytes: max(allocatedBytes),
    timings: result.timings,
  }
}

test("records the local controlled OCCT performance budget", async ({
  browser,
  page,
}, testInfo) => {
  const pageRuns = readPageRuns()
  const samples: PerformanceSample[] = []
  const longTaskDurationsMs: number[] = []
  let longTaskSupported = true

  await page.addInitScript((stateKey) => {
    type ObserverEntry = { duration: number }
    type ObserverList = { getEntries: () => ObserverEntry[] }
    type Observer = { observe: (options: { buffered: boolean; type: string }) => void }
    type ObserverConstructor = {
      new (callback: (list: ObserverList) => void): Observer
      supportedEntryTypes?: string[]
    }

    const Observer = Reflect.get(globalThis, "PerformanceObserver") as
      | ObserverConstructor
      | undefined
    const state: LongTaskState = { supported: false, durationsMs: [] }

    if (Observer?.supportedEntryTypes?.includes("longtask")) {
      state.supported = true
      const observer = new Observer((list) => {
        state.durationsMs.push(...list.getEntries().map((entry) => entry.duration))
      })
      observer.observe({ type: "longtask", buffered: true })
      Reflect.set(globalThis, `${stateKey}_observer`, observer)
    }

    Reflect.set(globalThis, stateKey, state)
  }, longTaskStateKey)

  for (let run = 1; run <= pageRuns; run += 1) {
    await page.goto(
      "/spikes/geometry-worker.html?lifecycleIterations=1&lifecycleBatches=1&lifecycleOperation=boolean-cut&purgeAfterLifecycle=false",
    )

    const status = page.getByRole("status")
    await expect(status).not.toHaveAttribute("data-state", "running", { timeout: 120_000 })
    await expect(status).toHaveAttribute("data-state", "passed")
    await page.waitForTimeout(50)

    const spike = await page.evaluate<GeometrySpikeHarnessState>(() =>
      Reflect.get(globalThis, "__VIBESHAPE_GEOMETRY_SPIKE__"),
    )
    expect(spike.error).toBeNull()

    const primary = requireResult(spike.result)
    const restarted = requireResult(spike.restart).result
    expect(primary.shape).toMatchObject({ valid: true, solidCount: 1 })
    expect(restarted.shape).toMatchObject({ valid: true, solidCount: 1 })
    samples.push(createPerformanceSample(run, "primary", primary))
    samples.push(createPerformanceSample(run, "restarted", restarted))

    const longTasks = await page.evaluate<LongTaskState, string>((stateKey) => {
      const state = Reflect.get(globalThis, stateKey) as LongTaskState | undefined
      return state ?? { supported: false, durationsMs: [] }
    }, longTaskStateKey)
    longTaskSupported &&= longTasks.supported
    longTaskDurationsMs.push(...longTasks.durationsMs)
  }

  const summary = {
    workerInitializationP95Ms: percentile(
      samples.map((sample) => sample.initializationMs),
      0.95,
    ),
    scenarioP95Ms: percentile(
      samples.map((sample) => sample.scenarioMs),
      0.95,
    ),
    mainThreadLongTaskCount: longTaskDurationsMs.length,
    mainThreadLongTaskMaxMs: longTaskDurationsMs.length === 0 ? 0 : max(longTaskDurationsMs),
    peakWasmHeapBytes: max(samples.map((sample) => sample.peakWasmHeapBytes)),
    peakAllocatedBytes: max(samples.map((sample) => sample.peakAllocatedBytes)),
  }
  const cpuInfo = cpus()
  const evidence = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    source: {
      opencascadeRevision: OCCT_BUILD_INPUTS.sources.occt.revision,
      opencascadeJsRevision: OCCT_BUILD_INPUTS.sources.opencascadeJs.revision,
    },
    baseline: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpuModel: cpuInfo[0]?.model ?? "unknown",
      logicalCpuCount: cpuInfo.length,
      totalMemoryBytes: totalmem(),
      browser: `Chromium ${browser.version()}`,
    },
    sampleCount: samples.length,
    pageRuns,
    budgets: PERFORMANCE_BUDGETS,
    summary,
    samples,
  }
  const evidenceJson = `${JSON.stringify(evidence, null, 2)}\n`

  mkdirSync(".artifacts/occt-build", { recursive: true })
  writeFileSync(".artifacts/occt-build/geometry-worker-performance-evidence.json", evidenceJson)
  await testInfo.attach("geometry-worker-performance-evidence", {
    body: evidenceJson,
    contentType: "application/json",
  })

  expect(longTaskSupported).toBe(true)
  expect(summary.workerInitializationP95Ms).toBeLessThanOrEqual(
    PERFORMANCE_BUDGETS.workerInitializationP95Ms,
  )
  expect(summary.scenarioP95Ms).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.scenarioP95Ms)
  expect(summary.mainThreadLongTaskMaxMs).toBeLessThanOrEqual(
    PERFORMANCE_BUDGETS.mainThreadLongTaskMaxMs,
  )
  expect(summary.peakWasmHeapBytes).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.peakWasmHeapBytes)
  expect(summary.peakAllocatedBytes).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.peakAllocatedBytes)
})
