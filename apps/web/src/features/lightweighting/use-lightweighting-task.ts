import type { meshImportInspectionSchema } from "@vibeshape/protocol"
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
import { prepareLightweightingSnapshot } from "./prepare-lightweighting-snapshot"

type ReadyResult = {
  source: LightweightingSource
  input: StructuralOptimizationInput
  result: StructuralOptimizationResult
  prepared: PreparedImportSource
  inspection: ReturnType<typeof meshImportInspectionSchema.parse>
}
type TaskCopy = {
  initialCaseName: string
  failed: string
  stale: string
  saveFailed: string
  solverFailed: (code: string) => string
  featureLabel: (part: string) => string
}
type Activity = "idle" | "loading" | "solving" | "inspecting" | "applying"
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
): Promise<ReadyResult | null> {
  const result = await optimizeStructuralModel(input, {
    signal,
    runtimeBaseUrl: new URL(`${import.meta.env.BASE_URL}structural-runtime/`, window.location.href)
      .href,
    onProgress: (stage) => {
      if (current()) setStage(stage)
    },
  })
  if (!current()) return null
  setStage("inspecting")
  const inspected = await prepareLightweightingSnapshot(
    result.mesh,
    result.cellSizeMm,
    source,
    current,
  )
  return inspected ? { source, input, result, ...inspected } : null
}
type CurrentSource = { source: LightweightingSource | null; disabled: boolean }
function sourceIdentity(source: LightweightingSource | null) {
  if (!source) return null
  return `${source.context.documentId}:${source.context.revision}:${source.partId}:${source.featureId}:${source.outputRole}:${source.contentHash}`
}
function analysisCandidate(source: LightweightingSource | null, fields: LightweightingFields) {
  if (!source) return null
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
    ready.result.status === "improved" &&
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
  const { mesh: _mesh, ...metrics } = result
  const { mesh: _sourceMesh, ...settings } = input
  const report = {
    schemaVersion: 1,
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
    result: metrics,
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
}: {
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
  const candidate = analysisCandidate(source, fields)
  const canAnalyze = analysisEligible(disabled, activity, candidate)
  const analyze = async () => {
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
      const completed = await runAnalysis(input, captured, abort.signal, current, setActivity)
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
    previewReady,
    setPreviewReady,
    choosePart,
    changeFields,
    analyze,
    apply,
    cancel,
    downloadReport: () => downloadResultReport(currentReady),
  }
}
