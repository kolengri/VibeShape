import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { vi } from "../../../tests/unit/support/bun-test"
import type { StructuralOptimizationInput, StructuralOptimizationResult } from "./contract"
import { StructuralOptimizationError } from "./errors"
import {
  type GenerativeDesignInput,
  type GenerativeDesignProgress,
  generateStructuralDesigns,
  generativeDesignInputSchema,
} from "./generative-design"

const analysis: StructuralOptimizationInput = {
  schemaVersion: 1,
  mesh: {
    vertices: [-5, -1, -1, -5, -1, 1, -5, 1, -1, -5, 1, 1, 5, -1, -1, 5, -1, 1, 5, 1, -1, 5, 1, 1],
    indices: [
      1, 3, 0, 4, 1, 0, 0, 3, 2, 2, 4, 0, 1, 7, 3, 5, 1, 4, 5, 7, 1, 3, 7, 2, 6, 4, 2, 2, 7, 6, 6,
      5, 4, 7, 5, 6,
    ],
  },
  material: { youngModulusMpa: 1000, poissonRatio: 0, yieldStrengthMpa: 100, densityKgM3: 1000 },
  objective: { kind: "minimize-mass" },
  safetyFactor: 2,
  maxDisplacementMm: 1,
  cellSizeMm: 1,
  supports: [{ min: [-5, -1, -1], max: [-5, 1, 1] }],
  loadCases: [
    { name: "axial", region: { min: [5, -1, -1], max: [5, 1, 1] }, forceN: [10, 0, 0] },
    { name: "reverse", region: { min: [5, -1, -1], max: [5, 1, 1] }, forceN: [-10, 0, 0] },
  ],
  preserveRegions: [{ min: [-1, -1, -1], max: [1, 1, 1] }],
  obstacleRegions: [],
  maxIterations: 0,
}

function study(): GenerativeDesignInput {
  return {
    schemaVersion: 1,
    analysis: structuredClone(analysis),
    materials: [
      { id: "light", name: "Light", material: { ...analysis.material } },
      { id: "heavy", name: "Heavy", material: { ...analysis.material, densityKgM3: 2000 } },
      { id: "dominated", name: "Dominated", material: { ...analysis.material, densityKgM3: 3000 } },
    ],
    retainedMassFractions: [0.5, 1],
  }
}

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  input?: StructuralOptimizationInput
  runtimeBaseUrl?: string
  terminate = vi.fn()
  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(request: { input: StructuralOptimizationInput; runtimeBaseUrl: string }) {
    this.input = request.input
    this.runtimeBaseUrl = request.runtimeBaseUrl
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>)
  }
}
function worker(index = FakeWorker.instances.length - 1) {
  const current = FakeWorker.instances[index]
  if (!current) throw new Error("Expected a running scenario worker.")
  return current
}
function result(current: FakeWorker, compliance = [1, 1]): StructuralOptimizationResult {
  const input = current.input
  if (input?.objective?.kind !== "maximize-stiffness")
    throw new Error("Expected a captured stiffness-objective scenario.")
  const massKg = 40 * input.material.densityKgM3 * 1e-9
  const metrics = {
    volumeMm3: 40,
    massKg,
    maxVonMisesMpa: 2.5,
    maxDisplacementMm: 0.025,
    safetyFactor: 40,
    cases: input.loadCases.map(({ name }, index) => ({
      name,
      maxVonMisesMpa: 2.5,
      maxDisplacementMm: 0.025,
      safetyFactor: 40,
      complianceNmm: compliance[index] ?? 1,
    })),
  }
  const reached = input.objective.retainedMassFraction === 1
  return {
    schemaVersion: 1,
    status: "no-improvement",
    mesh: structuredClone(input.mesh),
    baseline: structuredClone(metrics),
    optimized: structuredClone(metrics),
    sourceVolumeMm3: 40,
    sourceVolumeLossFraction: 0,
    cellSizeMm: 1,
    initialCellCount: 40,
    finalCellCount: 40,
    iterations: 0,
    evaluations: 2,
    termination: reached ? "target-mass-reached" : "iteration-limit",
    objective: {
      ...input.objective,
      targetMassKg: massKg * input.objective.retainedMassFraction,
      targetCellCount: Math.ceil(40 * input.objective.retainedMassFraction),
      achievedRetainedMassFraction: 1,
      targetStatus: reached ? "reached" : "not-reached",
    },
    warnings: [],
  }
}
async function complete(current: FakeWorker, output = result(current)) {
  current.emit({ type: "complete", response: { ok: true, result: output } })
  await Promise.resolve()
}
const options = { runtimeBaseUrl: "http://localhost/structural-runtime/" }

describe("local bounded structural design studies", () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal("Worker", FakeWorker)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("runs sequential variants, preserves source inputs, ranks worst-case compliance, and flags same-material duplicates", async () => {
    const input = study()
    const original = structuredClone(input)
    const progress: GenerativeDesignProgress[] = []
    const pending = generateStructuralDesigns(input, {
      ...options,
      onProgress: (event) => progress.push(event),
    })
    for (let index = 0; index < 6; index++) {
      expect(FakeWorker.instances).toHaveLength(index + 1)
      const current = worker(index)
      const material = input.materials[Math.floor(index / 2)]
      if (!material) throw new Error("Expected a study material.")
      expect(current.runtimeBaseUrl).toBe(options.runtimeBaseUrl)
      expect(current.input).toEqual({
        ...input.analysis,
        material: material.material,
        objective: { kind: "maximize-stiffness", retainedMassFraction: index % 2 === 0 ? 0.5 : 1 },
      })
      current.emit({ type: "progress", stage: "solving" })
      const output = result(current, index < 2 ? [1, 5] : index < 4 ? [2, 2] : [0.5, 6])
      // Equal geometry does not depend on triangle/vertex order.
      if (index % 2 === 1) {
        const count = output.mesh.vertices.length / 3
        output.mesh.vertices = Array.from({ length: count }, (_, i) =>
          output.mesh.vertices.slice((count - i - 1) * 3, (count - i) * 3),
        ).flat()
        output.mesh.indices = output.mesh.indices.map((i) => count - i - 1)
      }
      await complete(current, output)
      expect(current.terminate).toHaveBeenCalledTimes(1)
    }
    const output = await pending
    expect(output.failures).toEqual([])
    expect(output.candidates.map(({ pareto }) => pareto)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ])
    expect(output.candidates.map(({ duplicateOf }) => duplicateOf)).toEqual([
      undefined,
      "material-1-target-1",
      undefined,
      "material-2-target-1",
      undefined,
      "material-3-target-1",
    ])
    expect(output.candidates[0]?.result.objective).toMatchObject({ targetStatus: "not-reached" })
    expect(input).toEqual(original)
    expect(
      progress.filter(({ stage }) => stage === "complete").map(({ completed }) => completed),
    ).toEqual([1, 2, 3, 4, 5, 6])
    expect(progress[0]).toEqual({
      completed: 0,
      total: 6,
      materialName: "Light",
      retainedMassFraction: 0.5,
      stage: "loading",
    })
    expect(progress.some(({ stage }) => stage === "solving")).toBe(true)
  })

  it("keeps equal metrics on the Pareto frontier across distinct materials", async () => {
    const input = study()
    input.retainedMassFractions = [1]
    input.materials = input.materials
      .slice(0, 2)
      .map((entry) => ({ ...entry, material: analysis.material }))
    const pending = generateStructuralDesigns(input, options)
    await complete(worker())
    await complete(worker())
    expect(
      (await pending).candidates.map(({ pareto, duplicateOf }) => ({ pareto, duplicateOf })),
    ).toEqual([
      { pareto: true, duplicateOf: undefined },
      { pareto: true, duplicateOf: undefined },
    ])
  })

  it("records individual solver and worker failures and continues to later candidates", async () => {
    const input = study()
    input.retainedMassFractions = [1]
    const pending = generateStructuralDesigns(input, options)
    worker().emit({
      type: "complete",
      response: {
        ok: false,
        error: { code: "infeasible-baseline", message: "Baseline exceeds limits." },
      },
    })
    const second = await vi.waitFor(() => worker(1))
    second.onerror?.()
    await complete(await vi.waitFor(() => worker(2)))
    const output = await pending
    expect(output.candidates).toHaveLength(1)
    expect(output.failures).toEqual([
      {
        id: "material-1-target-1",
        materialId: "light",
        materialName: "Light",
        retainedMassFraction: 1,
        code: "infeasible-baseline",
        message: "Baseline exceeds limits.",
      },
      {
        id: "material-2-target-1",
        materialId: "heavy",
        materialName: "Heavy",
        retainedMassFraction: 1,
        code: "runtime-unavailable",
        message: "The analysis worker failed.",
      },
    ])
  })

  it("returns an honest empty candidate set when every scenario fails", async () => {
    const input = study()
    input.materials = input.materials.slice(0, 1)
    const progress: GenerativeDesignProgress[] = []
    const pending = generateStructuralDesigns(input, {
      ...options,
      onProgress: (event) => progress.push(event),
    })
    for (let i = 0; i < 2; i++) {
      const current = await vi.waitFor(() => worker(i))
      current.onerror?.()
    }
    const output = await pending
    expect(output.candidates).toEqual([])
    expect(output.failures).toHaveLength(2)
    expect(progress.at(-1)).toMatchObject({ completed: 2, total: 2, stage: "complete" })
  })

  it("records worker construction failures for each bounded scenario", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("Worker construction failed.")
        }
      },
    )
    const output = await generateStructuralDesigns(study(), options)
    expect(output.candidates).toEqual([])
    expect(output.failures).toHaveLength(6)
    expect(output.failures.every(({ code }) => code === "runtime-unavailable")).toBe(true)
  })

  it.each(["before", "active", "between", "last"])(
    "aborts the entire study %s scenarios without publishing partial results",
    async (when) => {
      const controller = new AbortController()
      if (when === "before") controller.abort()
      const pending = generateStructuralDesigns(study(), {
        ...options,
        signal: controller.signal,
        onProgress: ({ stage, completed }) => {
          if (
            stage === "complete" &&
            completed === (when === "last" ? 6 : 1) &&
            (when === "between" || when === "last")
          )
            controller.abort()
        },
      })
      if (when === "active") controller.abort()
      if (when === "between") await complete(worker())
      if (when === "last") for (let i = 0; i < 6; i++) await complete(worker())
      await expect(pending).rejects.toMatchObject({ name: "AbortError" })
      expect(FakeWorker.instances).toHaveLength(when === "before" ? 0 : when === "last" ? 6 : 1)
      for (const current of FakeWorker.instances) expect(current.terminate).toHaveBeenCalledTimes(1)
    },
  )

  it("does not mask progress consumer failures as scenario failures", async () => {
    const error = new StructuralOptimizationError("consumer-failed", "Consumer failed.")
    const pending = generateStructuralDesigns(study(), {
      ...options,
      onProgress: ({ stage }) => {
        if (stage === "solving") throw error
      },
    })
    worker().emit({ type: "progress", stage: "solving" })
    await expect(pending).rejects.toBe(error)
    expect(FakeWorker.instances).toHaveLength(1)
    expect(worker().terminate).toHaveBeenCalledTimes(1)
  })

  it("validates the entire study and captured mesh mapping before starting a worker", async () => {
    const input = study()
    input.analysis.supports = [{ kind: "surface", triangleIndices: [12], depthMm: 1 }]
    expect(generativeDesignInputSchema.safeParse(input).success).toBe(false)
    await expect(generateStructuralDesigns(input, options)).rejects.toMatchObject({
      code: "invalid-input",
    })
    input.analysis = structuredClone(analysis)
    input.retainedMassFractions = [0.5, 0.5]
    await expect(generateStructuralDesigns(input, options)).rejects.toMatchObject({
      code: "invalid-input",
    })
    await expect(
      generateStructuralDesigns(
        { ...input, schemaVersion: 2 } as unknown as GenerativeDesignInput,
        options,
      ),
    ).rejects.toMatchObject({ code: "invalid-input" })
    expect(FakeWorker.instances).toEqual([])
  })
})
