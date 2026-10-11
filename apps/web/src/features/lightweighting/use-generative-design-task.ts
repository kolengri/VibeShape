import { structuralMaterialCatalog } from "@vibeshape/domain/lightweighting-materials"
import {
  type GenerativeDesignResult,
  generateStructuralDesigns,
} from "@vibeshape/structural-optimization/generative-design"
import { useEffect, useState } from "react"
import { type GenerativeDesignFields, generativeDesignInput } from "./generative-design-model"
import {
  type LightweightingSource,
  lightweightingInput,
  sameLightweightingSource,
} from "./lightweighting-model"
import { type LightweightingAnalysisRunner, useLightweightingTask } from "./use-lightweighting-task"

export function useGenerativeDesignTask(
  options: Parameters<typeof useLightweightingTask>[0],
  enabled: boolean,
  currentMaterialName: string,
) {
  const [fields, setFields] = useState<GenerativeDesignFields>({
    retainedMassPercents: "35, 50, 70",
    additionalMaterialIds: [],
    obstacles: [],
    fdm: {
      buildDirection: "+z",
      supportMode: "allowed",
      minFeatureSizeMm: "1.2",
      layerHeightMm: "0.2",
      maxOverhangAngleDeg: "45",
    },
  })
  const [study, setStudy] = useState<{
    source: LightweightingSource
    result: GenerativeDesignResult
  } | null>(null)
  const [progress, setProgress] = useState<{
    completed: number
    total: number
    materialName: string
  } | null>(null)
  const run: LightweightingAnalysisRunner = async (analysis, context) => {
    const input = generativeDesignInput(analysis, fields, currentMaterialName)
    const captured = task.source
    if (!input || !captured) throw new Error("Generative design settings are invalid.")
    const result = await generateStructuralDesigns(input, {
      signal: context.signal,
      runtimeBaseUrl: new URL(
        `${import.meta.env.BASE_URL}structural-runtime/`,
        window.location.href,
      ).href,
      onProgress: (next) => {
        if (!context.current()) return
        setProgress(next)
        if (next.stage !== "complete") context.onProgress(next.stage)
      },
    })
    if (!context.current()) throw new DOMException("Study canceled.", "AbortError")
    setStudy({ source: captured, result })
    const candidate =
      result.candidates.find((item) => item.pareto && item.result.status === "improved") ??
      result.candidates.find((item) => item.result.status === "improved") ??
      result.candidates[0]
    if (!candidate) throw new Error("No feasible design candidates were found.")
    return { input: candidate.input, result: candidate.result }
  }
  const task = useLightweightingTask({ ...options, ...(enabled ? { analysisRunner: run } : {}) })
  const identity = task.source
    ? `${task.source.context.documentId}:${task.source.context.revision}:${task.source.contentHash}:${task.source.partId}`
    : null
  useEffect(() => {
    setStudy(null)
    setProgress(null)
  }, [identity])
  const clear = () => {
    setStudy(null)
    setProgress(null)
  }
  const changeStudyFields = (next: GenerativeDesignFields) => {
    if (task.activity === "applying") return
    task.cancel()
    clear()
    setFields(next)
  }
  const input = task.source
    ? generativeDesignInput(
        lightweightingInput(task.source, task.fields),
        fields,
        currentMaterialName,
      )
    : null
  const currentStudy =
    study && sameLightweightingSource(task.source, study.source) ? study.result : null
  return {
    ...task,
    canAnalyze: task.canAnalyze && (!enabled || input !== null),
    changeFields: (next: typeof task.fields) => {
      clear()
      task.changeFields(next)
    },
    choosePart: (id: string) => {
      clear()
      task.choosePart(id)
    },
    cancel: () => {
      clear()
      task.cancel()
    },
    analyze: () => {
      clear()
      return task.analyze()
    },
    study: currentStudy,
    studyFields: fields,
    changeStudyFields,
    progress,
    scenarioCount: input ? input.materials.length * input.retainedMassFractions.length : 0,
    selectCandidate: (id: string) => {
      const candidate = currentStudy?.candidates.find((item) => item.id === id)
      if (candidate) return task.previewResult(candidate.input, candidate.result)
    },
    materialOptions: structuralMaterialCatalog.presets,
  }
}
