import type { MeshImportInspection, SourceImportInspection } from "@vibeshape/protocol"
import {
  optimizeStructuralModel,
  StructuralOptimizationError,
} from "@vibeshape/structural-optimization/client"
import {
  type StructuralOptimizationInput,
  type StructuralOptimizationResult,
  structuralOptimizationInputSchema,
} from "@vibeshape/structural-optimization/contract"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  commitAuthoredTransaction,
  type DocumentControllerState,
} from "../../document/document-controller"
import { portableDocumentStem } from "../../document/document-export"
import { createImportTransaction, type PreparedImportSource } from "../import/import-model"
import {
  initialLightweightingFields,
  type LightweightingFields,
  type LightweightingSource,
  lightweightingInput,
  lightweightingSource,
  sameLightweightingSource,
} from "./lightweighting-model"
import type { ExactPrintOptimizationEvidence } from "./prepare-exact-print-snapshot"
import { prepareLightweightingSnapshot } from "./prepare-lightweighting-snapshot"

type ReadyResult = {
  source: LightweightingSource
  input: StructuralOptimizationInput
  result: StructuralOptimizationResult
  prepared?: PreparedImportSource
  inspection?: MeshImportInspection | SourceImportInspection
  exact?: ExactPrintOptimizationEvidence
  analysisContext?: LightweightingInputPreparation["analysisContext"]
}
type TaskCopy = {
  initialCaseName: string
  failed: string
  stale: string
  saveFailed: string
  solverFailed: (code: string) => string
  featureLabel: (part: string) => string
}
type Activity =
  | "idle"
  | "loading"
  | "solving"
  | "inspecting"
  | "reconstructing"
  | "verifying"
  | "applying"
export type LightweightingAnalysisRunner = (
  input: StructuralOptimizationInput,
  options: {
    signal: AbortSignal
    current: () => boolean
    onProgress: (stage: "loading" | "solving") => void
  },
) => Promise<{ input: StructuralOptimizationInput; result: StructuralOptimizationResult }>
export type LightweightingInputPreparation = {
  input: StructuralOptimizationInput
  prepareSnapshot?: (
    result: StructuralOptimizationResult,
    options: {
      signal: AbortSignal
      current: () => boolean
      onProgress: (stage: "reconstructing" | "verifying" | "inspecting") => void
    },
  ) => Promise<{
    prepared: PreparedImportSource
    inspection: MeshImportInspection | SourceImportInspection
    exact?: ExactPrintOptimizationEvidence
  } | null>
  analysisContext?: {
    scenarioBasis: "normalized-longest-span-end-clamped"
    sourceToPrintFrame: {
      originMm: [number, number, number]
      rotation: [number, number, number, number]
    }
    bedTriangleIndices: number[]
    materialModel: "isotropic-without-layer-adhesion"
  }
}
export type LightweightingInputBuilder = (
  source: LightweightingSource,
  fields: LightweightingFields,
) => LightweightingInputPreparation | null
function analysisIsCurrent(
  mounted: boolean,
  generation: number,
  id: number,
  signal: AbortSignal,
  latest: { source: LightweightingSource | null; disabled: boolean },
  captured: LightweightingSource,
) {
  return (
    mounted &&
    generation === id &&
    !signal.aborted &&
    !latest.disabled &&
    sameLightweightingSource(latest.source, captured)
  )
}
function analysisError(error: unknown, copy: TaskCopy) {
  return error instanceof StructuralOptimizationError ? copy.solverFailed(error.code) : copy.failed
}
async function runAnalysis(
  input: StructuralOptimizationInput,
  source: LightweightingSource,
  signal: AbortSignal,
  current: () => boolean,
  setStage: (stage: Activity) => void,
  runner?: LightweightingAnalysisRunner,
  preparation?: LightweightingInputPreparation,
): Promise<ReadyResult | null> {
  const options = {
    signal,
    runtimeBaseUrl: new URL(`${import.meta.env.BASE_URL}structural-runtime/`, window.location.href)
      .href,
    onProgress: (stage: "loading" | "solving") => {
      if (current()) setStage(stage)
    },
  }
  const computed = runner
    ? await runner(input, { ...options, current })
    : { input, result: await optimizeStructuralModel(input, options) }
  const result = computed.result
  if (!current()) return null
  const analysis = {
    source,
    input: computed.input,
    result,
    ...(preparation?.analysisContext ? { analysisContext: preparation.analysisContext } : {}),
  }
  if (result.status === "no-improvement") return analysis
  setStage("inspecting")
  const inspected = await inspectAnalysisSnapshot({
    result,
    source,
    signal,
    current,
    setStage,
    preparation,
  })
  return inspected
    ? {
        ...analysis,
        ...inspected,
      }
    : null
}
async function inspectAnalysisSnapshot({
  result,
  source,
  signal,
  current,
  setStage,
  preparation,
}: {
  result: StructuralOptimizationResult
  source: LightweightingSource
  signal: AbortSignal
  current: () => boolean
  setStage: (stage: Activity) => void
  preparation: LightweightingInputPreparation | undefined
}) {
  if (!preparation?.prepareSnapshot)
    return prepareLightweightingSnapshot(result.mesh, result.cellSizeMm, source, current)
  return preparation.prepareSnapshot(result, {
    signal,
    current,
    onProgress: (stage) => {
      if (current()) setStage(stage)
    },
  })
}
type CurrentSource = { source: LightweightingSource | null; disabled: boolean }
function sourceIdentity(source: LightweightingSource | null) {
  if (!source) return null
  return `${source.context.documentId}:${source.context.revision}:${source.partId}:${source.featureId}:${source.outputRole}:${source.contentHash}`
}
function analysisCandidate(
  source: LightweightingSource | null,
  fields: LightweightingFields,
  builder?: LightweightingInputBuilder,
) {
  if (!source) return null
  if (builder) return preparedCandidate(source, fields, builder)
  const surface = fields.surfaceSelection
  if (
    surface &&
    (!surface.source ||
      !sameLightweightingSource(source, surface.source) ||
      fields.loadCases.some(
        (load) => !load.surfaceForce || Number(load.surfaceForce.magnitudeN) <= 0,
      ))
  )
    return null
  const parsed = structuralOptimizationInputSchema.safeParse(lightweightingInput(source, fields))
  return parsed.success ? { source, input: parsed.data } : null
}
function preparedCandidate(
  source: LightweightingSource,
  fields: LightweightingFields,
  builder: LightweightingInputBuilder,
) {
  const prepared = builder(source, fields)
  if (!prepared) return null
  const parsed = structuralOptimizationInputSchema.safeParse(prepared.input)
  return parsed.success ? { source, ...prepared, input: parsed.data } : null
}
function currentResult(source: LightweightingSource | null, ready: ReadyResult | null) {
  if (!ready) return null
  return sameLightweightingSource(source, ready.source) ? ready : null
}
function analysisEligible(
  disabled: boolean,
  activity: Activity,
  candidate: ReturnType<typeof analysisCandidate>,
) {
  return !disabled && activity === "idle" && candidate !== null
}
function applyEligible(
  disabled: boolean,
  activity: Activity,
  ready: ReadyResult | null,
  previewReady: boolean,
) {
  return (
    !disabled &&
    activity === "idle" &&
    ready !== null &&
    ready.prepared !== undefined &&
    ready.inspection !== undefined &&
    (ready.exact
      ? ready.exact.volumeMm3 < ready.exact.sourceVolumeMm3
      : ready.result.status === "improved") &&
    previewReady
  )
}
function actionCanBegin(analysis: AbortController | null, applying: boolean, eligible: boolean) {
  return analysis === null && !applying && eligible
}
function sourceIsWritable(latest: CurrentSource, captured: LightweightingSource) {
  return !latest.disabled && sameLightweightingSource(latest.source, captured)
}
function finishAnalysis(
  id: number,
  lifecycle: {
    generation: { current: number }
    mounted: { current: boolean }
    controller: { current: AbortController | null }
    setStage: (stage: Activity) => void
  },
) {
  if (id !== lifecycle.generation.current) return
  lifecycle.controller.current = null
  if (lifecycle.mounted.current) lifecycle.setStage("idle")
}
async function commitResult(ready: ReadyResult, label: string) {
  if (!ready.prepared || !ready.inspection)
    throw new Error("The analysis has no inspected import candidate.")
  const transaction = createImportTransaction(
    ready.source.context,
    ready.prepared,
    ready.inspection,
    label,
    undefined,
    undefined,
    ready.source.partId,
  )
  return commitAuthoredTransaction(ready.source.context.revision, transaction)
}
function publishCommitResult(
  result: Awaited<ReturnType<typeof commitResult>>,
  callbacks: {
    mounted: { current: boolean }
    onApplied: () => void
    setMessage: (message: string) => void
  },
) {
  if (!callbacks.mounted.current) return
  if (result.ok) callbacks.onApplied()
  else callbacks.setMessage(result.diagnostic.message)
}
function downloadResultReport(ready: ReadyResult | null) {
  if (!ready) return
  const { source: captured, input, result } = ready
  const { mesh: _mesh, voxelGrid: _grid, ...metrics } = result
  const { mesh: _sourceMesh, ...settings } = input
  const report = {
    schemaVersion: ready.exact ? 2 : 1,
    analysis: "preliminary-isotropic-linear-elastic-voxel-fem",
    source: {
      documentId: captured.context.documentId,
      revision: captured.context.revision,
      partId: captured.partId,
      partName: captured.partName,
      featureId: captured.featureId,
      outputRole: captured.outputRole,
      contentHash: captured.contentHash,
    },
    settings,
    ...(ready.analysisContext ? { analysisContext: ready.analysisContext } : {}),
    ...(ready.exact ? { optimizationProposal: metrics, result: ready.exact } : { result: metrics }),
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${portableDocumentStem(captured.partName)}-lightweighting-report.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
function changeInputs(applying: boolean, cancel: () => void, update: () => void) {
  if (applying) return
  cancel()
  update()
}
function useTaskLifecycle({
  source,
  disabled,
  setReady,
  setPreviewReady,
  setMessage,
  setActivity,
}: {
  source: LightweightingSource | null
  disabled: boolean
  setReady: (ready: ReadyResult | null) => void
  setPreviewReady: (ready: boolean) => void
  setMessage: (message: string | null) => void
  setActivity: (activity: Activity) => void
}) {
  const latest = useRef({ source, disabled })
  const mounted = useRef(true)
  const generation = useRef(0)
  const analysis = useRef<AbortController | null>(null)
  const applying = useRef(false)
  useLayoutEffect(() => {
    latest.current = { source, disabled }
  })
  const cancel = useCallback(() => {
    generation.current += 1
    analysis.current?.abort()
    analysis.current = null
    setReady(null)
    setPreviewReady(false)
    setMessage(null)
    if (!applying.current) setActivity("idle")
  }, [setReady, setPreviewReady, setMessage, setActivity])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
      analysis.current?.abort()
    }
  }, [])
  const identity = sourceIdentity(source)
  useEffect(() => {
    cancel()
  }, [identity, cancel])
  return { latest, mounted, generation, analysis, applying, cancel }
}
export function useLightweightingTask({
  controller,
  initialPartId = "",
  disabled,
  copy,
  onApplied,
  onApplyingChange,
  graphical = false,
  analysisRunner,
  inputBuilder,
}: {
  inputBuilder?: LightweightingInputBuilder
  analysisRunner?: LightweightingAnalysisRunner
  graphical?: boolean
  controller: DocumentControllerState
  initialPartId?: string
  disabled: boolean
  copy: TaskCopy
  onApplied: () => void
  onApplyingChange: (applying: boolean) => void
}) {
  const [partId, setPartId] = useState(() =>
    lightweightingSource(controller, initialPartId) ? initialPartId : "",
  )
  const [fields, setFields] = useState(() =>
    initialLightweightingFields(
      lightweightingSource(controller, partId),
      copy.initialCaseName,
      graphical,
    ),
  )
  const [ready, setReady] = useState<ReadyResult | null>(null)
  const [previewReady, setPreviewReady] = useState(false)
  const [activity, setActivity] = useState<Activity>("idle")
  const [message, setMessage] = useState<string | null>(null)
  const source = lightweightingSource(controller, partId)
  const { latest, mounted, generation, analysis, applying, cancel } = useTaskLifecycle({
    source,
    disabled,
    setReady,
    setPreviewReady,
    setMessage,
    setActivity,
  })
  const changeFields = (next: LightweightingFields) => {
    changeInputs(applying.current, cancel, () => setFields(next))
  }
  const choosePart = (id: string) => {
    changeInputs(applying.current, cancel, () => {
      setPartId(id)
      setFields(
        initialLightweightingFields(
          lightweightingSource(controller, id),
          copy.initialCaseName,
          graphical,
        ),
      )
    })
  }
  const currentReady = currentResult(source, ready)
  const stale = ready !== null && currentReady === null
  let candidate: ReturnType<typeof analysisCandidate> = null
  let inputError: unknown = null
  try {
    candidate = analysisCandidate(source, fields, inputBuilder)
  } catch (error) {
    inputError = error
  }
  const canAnalyze = analysisEligible(disabled, activity, candidate)
  const performAnalysis = async (runner?: LightweightingAnalysisRunner) => {
    if (!candidate || !actionCanBegin(analysis.current, applying.current, canAnalyze)) return
    const { source: captured, input } = candidate
    const abort = new AbortController()
    analysis.current = abort
    const id = ++generation.current
    const current = () =>
      analysisIsCurrent(
        mounted.current,
        generation.current,
        id,
        abort.signal,
        latest.current,
        captured,
      )
    setReady(null)
    setPreviewReady(false)
    setMessage(null)
    setActivity("loading")
    try {
      const completed = await runAnalysis(
        input,
        captured,
        abort.signal,
        current,
        setActivity,
        runner,
        candidate,
      )
      if (completed && current()) setReady(completed)
    } catch (error) {
      if (current()) setMessage(analysisError(error, copy))
    } finally {
      finishAnalysis(id, { generation, mounted, controller: analysis, setStage: setActivity })
    }
  }
  const canApply = applyEligible(disabled, activity, currentReady, previewReady)
  const apply = async () => {
    if (!currentReady || !actionCanBegin(analysis.current, applying.current, canApply)) return false
    if (!sourceIsWritable(latest.current, currentReady.source)) {
      setMessage(copy.stale)
      return false
    }
    applying.current = true
    setActivity("applying")
    setMessage(null)
    onApplyingChange(true)
    try {
      const result = await commitResult(
        currentReady,
        copy.featureLabel(currentReady.source.partName),
      )
      publishCommitResult(result, { mounted, onApplied, setMessage })
      return result.ok && mounted.current
    } catch {
      if (mounted.current) setMessage(copy.saveFailed)
      return false
    } finally {
      applying.current = false
      onApplyingChange(false)
      if (mounted.current) setActivity("idle")
    }
  }
  return {
    partId,
    fields,
    ready: currentReady,
    source,
    activity,
    message: stale ? copy.stale : message,
    canAnalyze,
    canApply,
    invalid: source !== null && candidate === null,
    inputError,
    previewReady,
    setPreviewReady,
    choosePart,
    changeFields,
    analyze: () => performAnalysis(analysisRunner),
    previewResult: (input: StructuralOptimizationInput, result: StructuralOptimizationResult) =>
      performAnalysis(async () => ({ input, result })),
    apply,
    cancel,
    downloadReport: () => downloadResultReport(currentReady),
  }
}
