import { generativeDesignSettingsSchema } from "@vibeshape/domain/generative-design"
import { z } from "zod"
import { optimizeStructuralModel } from "./client"
import {
  type StructuralOptimizationInput,
  type StructuralOptimizationResult,
  structuralOptimizationInputSchema,
} from "./contract"
import { StructuralOptimizationError } from "./errors"

export const generativeDesignInputSchema = generativeDesignSettingsSchema.extend({
  schemaVersion: z.literal(1),
  analysis: structuralOptimizationInputSchema,
})
export type GenerativeDesignInput = z.infer<typeof generativeDesignInputSchema>
export type GenerativeDesignCandidate = {
  id: string
  materialId: string
  materialName: string
  retainedMassFraction: number
  input: StructuralOptimizationInput
  result: StructuralOptimizationResult
  pareto: boolean
  duplicateOf?: string
}
export type GenerativeDesignFailure = Pick<
  GenerativeDesignCandidate,
  "id" | "materialId" | "materialName" | "retainedMassFraction"
> & { code: string; message: string }
export type GenerativeDesignResult = {
  schemaVersion: 1
  candidates: GenerativeDesignCandidate[]
  failures: GenerativeDesignFailure[]
}
export type GenerativeDesignProgress = {
  completed: number
  total: number
  materialName: string
  retainedMassFraction: number
  stage: "loading" | "solving" | "complete"
}
export type GenerativeDesignOptions = {
  signal?: AbortSignal
  runtimeBaseUrl?: string
  onProgress?: (progress: GenerativeDesignProgress) => void
}

function geometryKey(mesh: StructuralOptimizationResult["mesh"]) {
  // Canonical triangles ignore vertex numbering, triangle order, and winding.
  const points: string[] = []
  for (let i = 0; i < mesh.vertices.length; i += 3)
    points.push(mesh.vertices.slice(i, i + 3).join(","))
  const triangles: string[] = []
  for (let i = 0; i < mesh.indices.length; i += 3)
    triangles.push(
      mesh.indices
        .slice(i, i + 3)
        .map((index) => points[index])
        .sort()
        .join(";"),
    )
  return triangles.sort().join("|")
}

function annotateCandidates(candidates: GenerativeDesignCandidate[]) {
  const metrics = candidates.map(({ result }) => ({
    mass: result.optimized.massKg,
    compliance: Math.max(...result.optimized.cases.map(({ complianceNmm }) => complianceNmm)),
  }))
  const geometryByMaterial = new Map<string, Map<string, string>>()
  for (const [index, candidate] of candidates.entries()) {
    const current = metrics[index]
    if (!current) continue
    candidate.pareto = !metrics.some(
      (other) =>
        other.mass <= current.mass &&
        other.compliance <= current.compliance &&
        (other.mass < current.mass || other.compliance < current.compliance),
    )
    const geometries = geometryByMaterial.get(candidate.materialId) ?? new Map<string, string>()
    geometryByMaterial.set(candidate.materialId, geometries)
    const key = geometryKey(candidate.result.mesh)
    const previous = geometries.get(key)
    if (previous) candidate.duplicateOf = previous
    else geometries.set(key, candidate.id)
  }
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Study canceled.", "AbortError")
}

type StudyScenario = {
  descriptor: Pick<
    GenerativeDesignCandidate,
    "id" | "materialId" | "materialName" | "retainedMassFraction"
  >
  input: StructuralOptimizationInput
}

function studyScenarios(study: GenerativeDesignInput): StudyScenario[] {
  return study.materials.flatMap((material, materialIndex) =>
    study.retainedMassFractions.map((retainedMassFraction, fractionIndex) => ({
      descriptor: {
        id: `material-${materialIndex + 1}-target-${fractionIndex + 1}`,
        materialId: material.id,
        materialName: material.name,
        retainedMassFraction,
      },
      input: {
        ...study.analysis,
        material: material.material,
        objective: { kind: "maximize-stiffness", retainedMassFraction },
      },
    })),
  )
}

async function runScenario(
  scenario: StudyScenario,
  options: GenerativeDesignOptions,
  progress: (stage: GenerativeDesignProgress["stage"]) => void,
): Promise<
  | { ok: true; candidate: GenerativeDesignCandidate }
  | { ok: false; failure: GenerativeDesignFailure }
> {
  checkAbort(options.signal)
  progress("loading")
  checkAbort(options.signal)
  let progressFailed = false
  try {
    const result = await optimizeStructuralModel(scenario.input, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.runtimeBaseUrl !== undefined ? { runtimeBaseUrl: options.runtimeBaseUrl } : {}),
      onProgress: (stage) => {
        try {
          progress(stage)
        } catch (error) {
          progressFailed = true
          throw error
        }
      },
    })
    checkAbort(options.signal)
    return {
      ok: true,
      candidate: { ...scenario.descriptor, input: scenario.input, result, pareto: false },
    }
  } catch (error) {
    checkAbort(options.signal)
    // Consumer exceptions and unexpected implementation errors reject the study.
    if (progressFailed || !(error instanceof StructuralOptimizationError)) throw error
    return {
      ok: false,
      failure: { ...scenario.descriptor, code: error.code, message: error.message },
    }
  }
}

/** Disposable local study. Source revision ownership remains with the caller. */
export async function generateStructuralDesigns(
  input: GenerativeDesignInput,
  options: GenerativeDesignOptions = {},
): Promise<GenerativeDesignResult> {
  const parsed = generativeDesignInputSchema.safeParse(input)
  if (!parsed.success)
    throw new StructuralOptimizationError(
      "invalid-input",
      "Generative design study inputs are invalid.",
    )
  const output: GenerativeDesignResult = { schemaVersion: 1, candidates: [], failures: [] }
  const scenarios = studyScenarios(parsed.data)
  let completed = 0
  for (const scenario of scenarios) {
    const progress = (stage: GenerativeDesignProgress["stage"]) => {
      options.onProgress?.({
        completed,
        total: scenarios.length,
        materialName: scenario.descriptor.materialName,
        retainedMassFraction: scenario.descriptor.retainedMassFraction,
        stage,
      })
    }
    const outcome = await runScenario(scenario, options, progress)
    if (outcome.ok) output.candidates.push(outcome.candidate)
    else output.failures.push(outcome.failure)
    completed += 1
    progress("complete")
    checkAbort(options.signal)
  }
  annotateCandidates(output.candidates)
  return output
}
