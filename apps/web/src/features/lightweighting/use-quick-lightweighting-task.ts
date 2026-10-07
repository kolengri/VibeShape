import type { QuickLightweightingSettings } from "@vibeshape/domain/quick-lightweighting"
import {
  encodeQuickLightweightingStl,
  generateQuickLightweighting,
  QuickLightweightingError,
} from "@vibeshape/structural-optimization/quick-client"
import type {
  QuickLightweightingProgress,
  QuickLightweightingResult,
} from "@vibeshape/structural-optimization/quick-contract"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  commitAuthoredTransaction,
  type DocumentControllerState,
} from "../../document/document-controller"
import { createImportTransaction } from "../import/import-model"
import {
  type LightweightingSource,
  lightweightingSource,
  sameLightweightingSource,
} from "./lightweighting-model"
import { prepareLightweightingSnapshot } from "./prepare-lightweighting-snapshot"

type PreparedSnapshot = NonNullable<Awaited<ReturnType<typeof prepareLightweightingSnapshot>>>
type Ready = PreparedSnapshot & { source: LightweightingSource; result: QuickLightweightingResult }
type Settings = {
  mode: QuickLightweightingSettings["mode"]
  removalPercent: number
  detail: number
  skinCells: number
  cellType: "gyroid" | "schwarz-p" | "schwarz-d"
  periodFraction: number
}
type Activity = "idle" | "loading" | "generating" | "inspecting" | "applying"
type Copy = {
  failed: string
  saveFailed: string
  stale: string
  label: (name: string) => string
  error: (code: string) => string
}

function samplingSize(source: LightweightingSource, detail: number) {
  // Kernel bounds include tolerance padding; sample the captured mesh extent itself.
  const positions = source.body.mesh.positions
  const spans = [0, 1, 2].map((axis) => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let index = axis; index < positions.length; index += 3) {
      const value = positions[index] ?? 0
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    return max - min
  })
  return Math.max(0.01, Math.max(...spans) / detail)
}

function quickFailure(error: unknown, copy: Copy) {
  return error instanceof QuickLightweightingError ? copy.error(error.code) : copy.failed
}

function quickGenerationInput(source: LightweightingSource | null, settings: Settings) {
  if (!source) return null
  const cellSizeMm = samplingSize(source, settings.detail)
  return {
    schemaVersion: 1 as const,
    mesh: {
      vertices: Array.from(source.body.mesh.positions),
      indices: Array.from(source.body.mesh.indices),
    },
    mode: settings.mode,
    removalPercent: settings.removalPercent,
    cellType: settings.cellType,
    latticeCellSizeMm: cellSizeMm * settings.detail * settings.periodFraction,
    cellSizeMm,
    skinThicknessMm: cellSizeMm * settings.skinCells,
  }
}

async function prepareQuickPreview(
  input: import("@vibeshape/structural-optimization/quick-contract").QuickLightweightingInput,
  source: LightweightingSource,
  signal: AbortSignal,
  current: () => boolean,
  setActivity: (stage: Activity) => void,
  setProgress: (progress: QuickLightweightingProgress | null) => void,
): Promise<Ready | null> {
  const result = await generateQuickLightweighting(input, {
    signal,
    runtimeBaseUrl: new URL(`${import.meta.env.BASE_URL}structural-runtime/`, window.location.href)
      .href,
    onProgress: (stage, progress) => {
      if (current()) {
        setActivity(stage)
        setProgress(progress ?? null)
      }
    },
  })
  if (!current()) return null
  setActivity("inspecting")
  setProgress(null)
  const prepared = await prepareLightweightingSnapshot(
    result.mesh,
    result.cellSizeMm,
    source,
    current,
    "organic",
    encodeQuickLightweightingStl,
  )
  return prepared && current() ? { ...prepared, source, result } : null
}

async function commitQuickPreview(ready: Ready, label: string) {
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

function sourceWritable(
  latest: { source: LightweightingSource | null; disabled: boolean },
  source: LightweightingSource,
) {
  return !latest.disabled && sameLightweightingSource(latest.source, source)
}

function canStartOperation(
  disabled: boolean,
  applying: boolean,
  operation: AbortController | null,
) {
  return !disabled && !applying && operation === null
}

function finishGeneration(
  id: number,
  lifecycle: {
    generation: { current: number }
    operation: { current: AbortController | null }
    mounted: { current: boolean }
    setActivity: (stage: Activity) => void
    setProgress: (progress: QuickLightweightingProgress | null) => void
  },
) {
  if (lifecycle.generation.current !== id) return
  lifecycle.operation.current = null
  if (lifecycle.mounted.current) {
    lifecycle.setActivity("idle")
    lifecycle.setProgress(null)
  }
}

function useQuickLifecycle(
  source: LightweightingSource | null,
  disabled: boolean,
  clear: () => void,
) {
  const mounted = useRef(false)
  const generation = useRef(0)
  const operation = useRef<AbortController | null>(null)
  const applying = useRef(false)
  const latest = useRef({ source, disabled })
  useLayoutEffect(() => {
    latest.current = { source, disabled }
  }, [source, disabled])
  const cancel = useCallback(() => {
    generation.current += 1
    operation.current?.abort()
    operation.current = null
    clear()
  }, [clear])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
      operation.current?.abort()
    }
  }, [])
  return { mounted, generation, operation, applying, latest, cancel }
}

function publishQuickCommit(
  result: Awaited<ReturnType<typeof commitQuickPreview>>,
  onApplied: () => void,
  setMessage: (message: string) => void,
) {
  if (result.ok) onApplied()
  else setMessage(result.diagnostic.message)
}

function readyToApply(
  ready: Ready | null,
  enabled: boolean,
  locked: boolean,
  latest: { source: LightweightingSource | null; disabled: boolean },
) {
  if (!ready || !enabled || locked) return null
  return sourceWritable(latest, ready.source) ? ready : null
}

async function applyQuickPreview(
  ready: Ready | null,
  enabled: boolean,
  lifecycle: Pick<ReturnType<typeof useQuickLifecycle>, "applying" | "latest" | "mounted">,
  publication: {
    copy: Copy
    onApplied: () => void
    onApplyingChange?: ((applying: boolean) => void) | undefined
    setActivity: (stage: Activity) => void
    setMessage: (message: string | null) => void
  },
) {
  const { applying, latest, mounted } = lifecycle
  const { copy, onApplied, onApplyingChange, setActivity, setMessage } = publication
  const captured = readyToApply(ready, enabled, applying.current, latest.current)
  if (!captured) return false
  applying.current = true
  onApplyingChange?.(true)
  setActivity("applying")
  setMessage(null)
  try {
    const result = await commitQuickPreview(captured, copy.label(captured.source.partName))
    if (!mounted.current) return false
    publishQuickCommit(result, onApplied, setMessage)
    return result.ok
  } catch {
    if (mounted.current) setMessage(copy.saveFailed)
    return false
  } finally {
    applying.current = false
    onApplyingChange?.(false)
    if (mounted.current) setActivity("idle")
  }
}

function useQuickPreviewState() {
  const [ready, setReady] = useState<Ready | null>(null)
  const [previewReady, setPreviewReady] = useState(false)
  const [activity, setActivity] = useState<Activity>("idle")
  const [progress, setProgress] = useState<QuickLightweightingProgress | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const clear = useCallback(() => {
    setReady(null)
    setPreviewReady(false)
    setActivity("idle")
    setProgress(null)
  }, [])
  return {
    ready,
    setReady,
    previewReady,
    setPreviewReady,
    activity,
    setActivity,
    progress,
    setProgress,
    message,
    setMessage,
    clear,
  }
}

export function useQuickLightweightingTask({
  controller,
  initialPartId,
  disabled,
  copy,
  onApplied,
  onApplyingChange,
}: {
  controller: DocumentControllerState
  initialPartId: string
  disabled: boolean
  copy: Copy
  onApplied: () => void
  onApplyingChange?: ((applying: boolean) => void) | undefined
}) {
  const [partId, setPartId] = useState(initialPartId)
  const [editing, setEditing] = useState(false)
  const editingControls = useRef(new Set<string>())
  const [settings, setSettings] = useState<Settings>({
    mode: "open-organic",
    removalPercent: 50,
    detail: 32,
    skinCells: 2.5,
    cellType: "gyroid",
    periodFraction: 6 / 32,
  })
  const {
    ready,
    setReady,
    previewReady,
    setPreviewReady,
    activity,
    setActivity,
    progress,
    setProgress,
    message,
    setMessage,
    clear,
  } = useQuickPreviewState()
  const source = useMemo(
    () => lightweightingSource(controller, partId),
    [controller.authoredSnapshot, controller.report, partId],
  )
  const { mounted, generation, operation, applying, latest, cancel } = useQuickLifecycle(
    source,
    disabled,
    clear,
  )
  const input = useMemo(() => quickGenerationInput(source, settings), [source, settings])
  const generate = useCallback(async () => {
    if (!source || !input || editingControls.current.size > 0) return
    if (!canStartOperation(disabled, applying.current, operation.current)) return
    const captured = source
    const abort = new AbortController()
    operation.current = abort
    const id = ++generation.current
    const current = () =>
      mounted.current &&
      generation.current === id &&
      !abort.signal.aborted &&
      sourceWritable(latest.current, captured)
    setReady(null)
    setPreviewReady(false)
    setMessage(null)
    setActivity("loading")
    setProgress(null)
    try {
      const completed = await prepareQuickPreview(
        input,
        captured,
        abort.signal,
        current,
        setActivity,
        setProgress,
      )
      if (completed) setReady(completed)
    } catch (error) {
      if (current()) setMessage(quickFailure(error, copy))
    } finally {
      finishGeneration(id, { generation, operation, mounted, setActivity, setProgress })
    }
  }, [copy, disabled, input, source])
  useEffect(() => {
    cancel()
    if (disabled || !source || editing) return
    const timer = window.setTimeout(() => {
      void generate()
    }, 650)
    return () => {
      window.clearTimeout(timer)
      generation.current += 1
      operation.current?.abort()
      operation.current = null
    }
  }, [cancel, disabled, editing, generate, source])
  const changeEditing = (control: string, active: boolean) => {
    if (active) {
      if (!editingControls.current.has(control)) cancel()
      editingControls.current.add(control)
    } else editingControls.current.delete(control)
    setEditing(editingControls.current.size > 0)
  }
  const changeSettings = (next: Settings) => {
    if (!applying.current) {
      cancel()
      setSettings({
        ...next,
        periodFraction: Math.max(6 / next.detail, Math.min(12 / next.detail, next.periodFraction)),
      })
    }
  }
  const choosePart = (id: string) => {
    if (!applying.current) {
      cancel()
      setPartId(id)
    }
  }
  const currentReady = ready && sameLightweightingSource(source, ready.source) ? ready : null
  const canApply = !disabled && activity === "idle" && currentReady !== null && previewReady
  const apply = () =>
    applyQuickPreview(
      currentReady,
      canApply,
      { applying, latest, mounted },
      { copy, onApplied, onApplyingChange, setActivity, setMessage },
    )
  return {
    partId,
    source,
    settings,
    editing,
    changeEditing,
    input,
    ready: currentReady,
    previewReady,
    setPreviewReady,
    activity,
    progress,
    message,
    changeSettings,
    choosePart,
    generate,
    apply,
    canApply,
    cancel,
  }
}
