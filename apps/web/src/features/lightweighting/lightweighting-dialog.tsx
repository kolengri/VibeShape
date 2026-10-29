import { useTranslations } from "@vibeshape/i18n"
import { useBlockingActivity, useReportActivity } from "@vibeshape/ui/components/activity"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import type { ViewerAnalysisOverlay, ViewerSelection } from "@vibeshape/viewer/three-viewport"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ActionAvailability } from "../../components/action-availability"
import { TaskPanelLayout } from "../../components/task-panel-layout"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import { TaskPanelLifecycleButton } from "../../components/task-panel-lifecycle-button"
import type { DocumentControllerState } from "../../document/document-controller"
import { useRegisterTaskSubmission } from "../../editor-session/editor-session-provider"
import type { WorkspaceTaskPreview } from "../../shell/workspace-task-context"
import { ImportPreview } from "../import/import-preview"
import { GenerativeDesignControls, GenerativeDesignResults } from "./generative-design-controls"
import { GenerativeSetupAction } from "./generative-setup-action"
import { LightweightingParameters, type LightweightingPickTarget } from "./lightweighting-fields"
import {
  type LightweightingFields,
  type LightweightingSource,
  type LightweightingSurfaceFields,
  sameLightweightingSource,
} from "./lightweighting-model"
import { LightweightingResults } from "./lightweighting-results"
import { LightweightingSourceSelector } from "./lightweighting-source-selector"
import {
  faceForce,
  faceTriangleIndices,
  lightweightingOverlays,
} from "./lightweighting-surface-selection"
import { useGenerativeDesignTask } from "./use-generative-design-task"
import type { useLightweightingTask } from "./use-lightweighting-task"
import { useLightweightingViewportPreview } from "./use-lightweighting-viewport-preview"

type TaskState = ReturnType<typeof useLightweightingTask>

export type LightweightingViewportInteraction = Readonly<{
  source: LightweightingSource
  onFacePick: (selection: ViewerSelection | null) => boolean
  overlays: readonly ViewerAnalysisOverlay[]
  picking: boolean
}>

function TaskStatus({ state }: { state: TaskState }) {
  const t = useTranslations("app.lightweighting")
  useReportActivity(state.activity !== "idle")
  const stages = {
    loading: "loading",
    solving: "solving",
    inspecting: "inspecting",
    reconstructing: "reconstructing",
    verifying: "verifying",
  } as const
  const stage =
    state.activity === "idle" || state.activity === "applying" ? null : stages[state.activity]
  return (
    <>
      {stage && (
        <p role="status" className="text-sm">
          {t(stage)}
        </p>
      )}
      {state.message && <Alert>{state.message}</Alert>}
    </>
  )
}

function ResultPreview({ state, mainViewport }: { state: TaskState; mainViewport: boolean }) {
  const t = useTranslations("app.lightweighting")
  if (!state.ready) return null
  return (
    <>
      <LightweightingResults result={state.ready.result} />
      {state.ready.inspection &&
        (mainViewport ? (
          <p className="text-xs text-muted-foreground">{t("mainPreview")}</p>
        ) : (
          <ImportPreview
            inspection={state.ready.inspection}
            label={t("preview")}
            failedMessage={t("previewFailed")}
            onReady={state.setPreviewReady}
          />
        ))}
      <Button type="button" variant="outline" size="sm" onClick={state.downloadReport}>
        {t("downloadReport")}
      </Button>
    </>
  )
}

function samePickTarget(first: LightweightingPickTarget | null, second: LightweightingPickTarget) {
  return (
    first?.kind === second.kind &&
    (first.kind !== "load" || (second.kind === "load" && first.caseId === second.caseId))
  )
}

function sourceOwnsFace(source: LightweightingSource, selection: ViewerSelection) {
  return (
    selection.featureId === source.featureId &&
    (selection.outputRole ?? "result") === source.outputRole &&
    faceTriangleIndices(source, [selection.faceId]).length > 0
  )
}
function toggleFace(faces: number[], face: number) {
  return faces.includes(face) ? faces.filter((item) => item !== face) : [...faces, face]
}
function withPickedFace(
  fields: LightweightingFields,
  surface: LightweightingSurfaceFields,
  target: LightweightingPickTarget,
  face: number,
): LightweightingFields {
  switch (target.kind) {
    case "support":
      return {
        ...fields,
        surfaceSelection: { ...surface, supportFaces: toggleFace(surface.supportFaces, face) },
      }
    case "preserve":
      return {
        ...fields,
        surfaceSelection: { ...surface, preserveFaces: toggleFace(surface.preserveFaces, face) },
      }
    case "load":
      return {
        ...fields,
        surfaceSelection: {
          ...surface,
          loadFaces: {
            ...surface.loadFaces,
            [target.caseId]: toggleFace(surface.loadFaces[target.caseId] ?? [], face),
          },
        },
      }
  }
}

function useFaceInteraction(
  state: TaskState,
  disabled: boolean,
  onInteractionChange: (interaction: LightweightingViewportInteraction | null) => void,
) {
  const t = useTranslations("app.lightweighting")
  const blocking = useBlockingActivity() !== null
  const [picking, setPicking] = useState<LightweightingPickTarget | null>(null)
  const [pickMessage, setPickMessage] = useState<string | null>(null)
  const surface = state.fields.surfaceSelection
  const current =
    !!state.source && !!surface?.source && sameLightweightingSource(state.source, surface.source)
  const interactive = current && !disabled && state.activity === "idle"
  const latest = useRef({ state, picking, interactive, wrongBody: t("wrongBody") })
  useLayoutEffect(() => {
    latest.current = { state, picking, interactive, wrongBody: t("wrongBody") }
  })

  useEffect(() => {
    if (!state.source || !surface?.source || current) return
    setPicking(null)
    setPickMessage(t("facesReset"))
    state.changeFields({
      ...state.fields,
      surfaceSelection: {
        ...surface,
        source: state.source,
        supportFaces: [],
        loadFaces: {},
        preserveFaces: [],
      },
    })
  }, [current, state, surface, t])

  useEffect(() => {
    if (!picking || blocking) return
    const cancelPicking = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setPicking(null)
    }
    window.addEventListener("keydown", cancelPicking, true)
    return () => window.removeEventListener("keydown", cancelPicking, true)
  }, [blocking, picking])

  const onFacePick = useCallback((selection: ViewerSelection | null) => {
    const { state: task, picking: target, interactive: enabled, wrongBody } = latest.current
    const captured = task.fields.surfaceSelection
    const source = captured?.source
    if (!enabled || !target || !selection || !captured || !source) return false
    if (!sourceOwnsFace(source, selection)) {
      setPickMessage(wrongBody)
      return true
    }
    setPickMessage(null)
    task.changeFields(withPickedFace(task.fields, captured, target, selection.faceId))
    setPicking(null)
    return true
  }, [])

  const interaction = useMemo<LightweightingViewportInteraction | null>(() => {
    if (!current || !surface?.source) return null
    return {
      source: surface.source,
      onFacePick,
      overlays: lightweightingOverlays(surface.source, state.fields),
      picking: interactive && picking !== null,
    }
  }, [current, interactive, picking, surface, state.fields, onFacePick])
  useEffect(() => {
    onInteractionChange(interaction)
    return () => onInteractionChange(null)
  }, [interaction, onInteractionChange])
  return {
    picking,
    pickMessage,
    interactive,
    onPick: (target: LightweightingPickTarget) => {
      if (!interactive) return
      setPickMessage(null)
      setPicking((previous) => (samePickTarget(previous, target) ? null : target))
    },
    stopPicking: () => setPicking(null),
  }
}

type LightweightingCopy = ReturnType<typeof useTranslations<"app.lightweighting">>
function loadSetupReason(fields: LightweightingFields, t: LightweightingCopy) {
  const surface = fields.surfaceSelection
  const missingLoad = fields.loadCases.findIndex(
    (load) =>
      !surface?.loadFaces[load.id]?.length ||
      !load.surfaceForce ||
      !(Number(load.surfaceForce.magnitudeN) > 0),
  )
  if (missingLoad >= 0) return t("loadRequired", { index: missingLoad + 1 })
  if (!surface?.source) return null
  const source = surface.source
  const missingNormal = fields.loadCases.findIndex(
    (load) =>
      load.surfaceForce?.direction === "normal" &&
      Math.hypot(...faceForce(source, surface.loadFaces[load.id] ?? [], load.surfaceForce)) === 0,
  )
  return missingNormal >= 0 ? t("normalDirectionUnavailable", { index: missingNormal + 1 }) : null
}
function analysisSetupReason(
  state: TaskState,
  t: LightweightingCopy,
  materialRequired = t("materialRequired"),
) {
  if (!state.source) return t("choosePart")
  const fields = state.fields
  if (
    [fields.youngModulusMpa, fields.poissonRatio, fields.yieldStrengthMpa, fields.densityKgM3].some(
      (value) => value.trim() === "",
    )
  )
    return materialRequired
  if (!fields.surfaceSelection?.supportFaces.length) return t("supportRequired")
  const loadReason = loadSetupReason(fields, t)
  if (loadReason) return loadReason
  return state.canAnalyze ? null : t("invalidInputs")
}
function applyResultReason(state: TaskState, t: LightweightingCopy) {
  if (!state.ready) return t("resultRequired")
  if (state.ready.result.status !== "improved") return t("improvementRequired")
  return state.previewReady ? null : t("previewPending")
}
function activityReason(state: TaskState, t: LightweightingCopy) {
  if (state.activity === "idle") return null
  return t(state.activity === "applying" ? "applyBusy" : "analysisBusy")
}
function actionReasons(
  state: TaskState,
  blockedReason: string | null,
  t: LightweightingCopy,
  materialRequired?: string,
) {
  const common = blockedReason ?? activityReason(state, t)
  return {
    analyze: common ?? analysisSetupReason(state, t, materialRequired),
    apply: common ?? applyResultReason(state, t),
  }
}
function documentBlockedReason(
  controller: DocumentControllerState,
  blocked: boolean,
  t: LightweightingCopy,
) {
  if (blocked) return t("blocked")
  if (controller.status !== "ready") return t("notReady")
  if (controller.saveStatus === "saving") return t("saveBusy")
  return controller.report?.mode === "read-write" ? null : t("readOnly")
}

export function LightweightingTaskPanel({
  controller,
  initialPartId = "",
  blocked,
  onClose,
  onInteractionChange,
  onApplyingChange,
  onApplied,
  onPreviewChange,
  generative = false,
}: {
  generative?: boolean
  onApplyingChange?: (applying: boolean) => void
  onApplied?: () => void
  onPreviewChange?: (preview: WorkspaceTaskPreview | null) => void
  controller: DocumentControllerState
  initialPartId?: string
  blocked: boolean
  onClose: () => void
  onInteractionChange: (interaction: LightweightingViewportInteraction | null) => void
}) {
  const t = useTranslations("app.lightweighting")
  const g = useTranslations("app.generativeDesign")
  const reasonId = useId()
  const panelCopy = generative
    ? { title: g("title"), description: g("description"), analyze: g("generate") }
    : { title: t("title"), description: t("description"), analyze: t("analyze") }
  const { state, disabled, blockedReason } = useLightweightingPanelState(
    {
      controller,
      initialPartId,
      blocked,
      onClose,
      onApplied,
      onApplyingChange,
      generative,
    },
    t,
  )
  const face = useFaceInteraction(state, disabled, onInteractionChange)
  useLightweightingViewportPreview(state.ready, onPreviewChange, state.setPreviewReady)
  const inputsDisabled = disabled || state.activity === "applying"
  const reasons = actionReasons(
    state,
    blockedReason,
    t,
    generative ? g("materialRequired") : undefined,
  )
  const analyze = () => {
    face.stopPicking()
    void state.analyze()
  }
  const analyzeActions = (
    <AnalysisActions
      state={state}
      disabledReason={reasons.analyze}
      label={panelCopy.analyze}
      onAnalyze={analyze}
    />
  )
  return (
    <section
      aria-label={panelCopy.title}
      className="@container flex min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <TaskPanelLayout
        title={panelCopy.title}
        description={panelCopy.description}
        actions={
          <LightweightingTaskActions
            state={state}
            generative={generative}
            title={panelCopy.title}
            label={panelCopy.analyze}
            reasons={reasons}
            reasonId={reasonId}
            onAnalyze={analyze}
            onClose={onClose}
          />
        }
      >
        <TaskPanelContent
          applyReason={
            <ApplyAvailabilityReason
              state={state}
              generative={generative}
              reason={reasons.apply}
              id={`${reasonId}-apply`}
            />
          }
          setup={
            <GenerativeSetupDetails
              state={state}
              disabled={disabled}
              onPick={face.onPick}
              reasons={reasons}
              reasonId={reasonId}
            />
          }
          state={state}
          generative={generative}
          inputsDisabled={inputsDisabled}
          controller={controller}
          face={face}
          analyzeActions={analyzeActions}
          mainViewport={onPreviewChange !== undefined}
        />
      </TaskPanelLayout>
    </section>
  )
}

function LightweightingTaskActions({
  state,
  generative,
  title,
  label,
  reasons,
  reasonId,
  onAnalyze,
  onClose,
}: {
  state: ReturnType<typeof useGenerativeDesignTask>
  generative: boolean
  title: string
  label: string
  reasons: { analyze: string | null; apply: string | null }
  reasonId: string
  onAnalyze: () => void
  onClose: () => void
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-end justify-end gap-2">
      {generative && (
        <AnalysisButtons
          state={state}
          label={label}
          onAnalyze={onAnalyze}
          describedBy={!state.canAnalyze && reasons.analyze ? `${reasonId}-analyze` : undefined}
        />
      )}
      <LightweightingLifecycleActions
        state={state}
        generative={generative}
        title={title}
        applyReason={reasons.apply}
        applyReasonId={`${reasonId}-apply`}
        onClose={onClose}
      />
    </div>
  )
}

function LightweightingLifecycleActions({
  state,
  generative,
  title,
  applyReason,
  applyReasonId,
  onClose,
}: {
  state: ReturnType<typeof useGenerativeDesignTask>
  generative: boolean
  title: string
  applyReason: string | null
  applyReasonId: string
  onClose: () => void
}) {
  const t = useTranslations("app.lightweighting")
  return (
    <TaskPanelLifecycleActions
      ariaLabel={title}
      cancelLabel={t("close")}
      {...(!generative || state.ready ? { acceptLabel: t("apply") } : {})}
      acceptDisabled={!state.canApply}
      acceptLoading={state.activity === "applying"}
      cancelDisabled={state.activity === "applying"}
      onAccept={state.apply}
      onCancel={onClose}
      renderAccept={() => (
        <TaskPanelLifecycleButton
          kind="accept"
          presentation="text"
          label={t("apply")}
          disabled={!state.canApply}
          isLoading={state.activity === "applying"}
          onClick={state.apply}
          aria-describedby={!state.canApply && applyReason ? applyReasonId : undefined}
        />
      )}
    />
  )
}

function TaskPanelContent({
  applyReason,
  setup,
  state,
  generative,
  inputsDisabled,
  controller,
  face,
  analyzeActions,
  mainViewport,
}: {
  applyReason: ReactNode
  setup: ReactNode
  state: ReturnType<typeof useGenerativeDesignTask>
  generative: boolean
  inputsDisabled: boolean
  controller: DocumentControllerState
  face: ReturnType<typeof useFaceInteraction>
  analyzeActions: ReactNode
  mainViewport: boolean
}) {
  const t = useTranslations("app.lightweighting")
  const pending = state.activity !== "idle" && state.activity !== "applying"
  return (
    <div
      data-generative-form={generative || undefined}
      className={generative ? "grid min-w-0 grid-cols-1 content-start gap-2" : "contents"}
    >
      <fieldset
        disabled={inputsDisabled}
        className="grid min-w-0 grid-cols-1 gap-2"
        aria-busy={pending}
      >
        <legend className="sr-only">{t("settings")}</legend>
        <LightweightingSourceSelector
          controller={controller}
          state={state}
          disabled={inputsDisabled}
        />
        <LightweightingParameters
          compact={generative}
          showObjective={!generative}
          fields={state.fields}
          onChange={state.changeFields}
          picking={face.picking}
          onPick={face.onPick}
          pickingDisabled={!face.interactive}
        />
        {generative && <GenerativeDesignControls state={state} />}
      </fieldset>
      {applyReason}
      {generative && setup}
      {face.pickMessage && (
        <p role="status" className="text-xs text-muted-foreground">
          {face.pickMessage}
        </p>
      )}
      {!generative && analyzeActions}
      <TaskStatus state={state} />
      <GenerativeProgress state={state} />
      <GenerativeDesignResults state={state} />
      <ResultPreview state={state} mainViewport={mainViewport} />
    </div>
  )
}

function ApplyAvailabilityReason({
  state,
  generative,
  reason,
  id,
}: {
  state: ReturnType<typeof useGenerativeDesignTask>
  generative: boolean
  reason: string | null
  id: string
}) {
  if (generative && !state.ready) return null
  if (state.canApply || !reason) return null
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {reason}
    </p>
  )
}

function GenerativeSetupDetails({
  state,
  disabled,
  reasons,
  reasonId,
  onPick,
}: {
  state: ReturnType<typeof useGenerativeDesignTask>
  disabled: boolean
  reasons: { analyze: string | null; apply: string | null }
  reasonId: string
  onPick: (target: LightweightingPickTarget) => void
}) {
  const g = useTranslations("app.generativeDesign")
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2">
      {!state.canAnalyze && reasons.analyze && (
        <p id={`${reasonId}-analyze`} className="text-xs text-muted-foreground">
          {reasons.analyze}
        </p>
      )}
      <GenerativeSetupAction state={state} disabled={disabled} onPick={onPick} />
      {state.canAnalyze && <p className="text-xs text-muted-foreground">{g("setupReady")}</p>}
    </div>
  )
}

function AnalysisButtons({
  state,
  label,
  onAnalyze,
  describedBy,
}: {
  state: TaskState
  label: string
  onAnalyze: () => void
  describedBy: string | undefined
}) {
  const t = useTranslations("app.lightweighting")
  const pending = state.activity !== "idle" && state.activity !== "applying"
  return (
    <>
      <Button
        type="button"
        size="sm"
        aria-describedby={describedBy}
        isLoading={pending}
        disabled={!state.canAnalyze}
        className="min-w-20 max-w-full"
        onClick={onAnalyze}
      >
        <span className="min-w-0 truncate">{label}</span>
      </Button>
      {pending && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="max-w-full"
          onClick={state.cancel}
        >
          <span className="min-w-0 truncate">{t("cancelAnalysis")}</span>
        </Button>
      )}
    </>
  )
}

function AnalysisActions({
  state,
  disabledReason,
  label,
  onAnalyze,
}: {
  state: TaskState
  disabledReason: string | null
  label: string
  onAnalyze: () => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <ActionAvailability disabledReason={disabledReason} presentation="persistent">
        {({ describedBy }) => (
          <AnalysisButtons
            state={state}
            label={label}
            onAnalyze={onAnalyze}
            describedBy={describedBy}
          />
        )}
      </ActionAvailability>
    </div>
  )
}

function GenerativeProgress({ state }: { state: ReturnType<typeof useGenerativeDesignTask> }) {
  const t = useTranslations("app.generativeDesign")
  useReportActivity(state.activity !== "idle")
  if (!state.progress || state.activity === "idle" || state.activity === "applying") return null
  return (
    <p role="status" className="text-xs">
      {t("progress", state.progress)}
    </p>
  )
}

function useLightweightingPanelState(
  {
    controller,
    initialPartId,
    blocked,
    onClose,
    onApplied,
    onApplyingChange,
    generative,
  }: {
    controller: DocumentControllerState
    initialPartId: string
    blocked: boolean
    onClose: () => void
    onApplied: (() => void) | undefined
    onApplyingChange: ((applying: boolean) => void) | undefined
    generative: boolean
  },
  t: ReturnType<typeof useTranslations<"app.lightweighting">>,
) {
  const g = useTranslations("app.generativeDesign")
  const [applying, setApplying] = useState(false)
  const blockedReason = documentBlockedReason(controller, blocked, t)
  const notifyApplying = useCallback(
    (next: boolean) => {
      setApplying(next)
      onApplyingChange?.(next)
    },
    [onApplyingChange],
  )
  const disabled = blockedReason !== null
  const state = useGenerativeDesignTask(
    {
      controller,
      initialPartId,
      disabled: disabled && !applying,
      graphical: true,
      onApplied: onApplied ?? onClose,
      onApplyingChange: notifyApplying,
      copy: {
        initialCaseName: t("defaultCaseName", { index: 1 }),
        failed: t("failed"),
        stale: t("stale"),
        saveFailed: t("saveFailed"),
        solverFailed: (code) => t("solverFailed", { code }),
        featureLabel: (part) =>
          generative ? g("featureLabel", { part }) : t("featureLabel", { part }),
      },
    },
    generative,
    g("currentMaterial"),
  )
  useRegisterTaskSubmission(
    state.apply,
    generative ? "lightweighting:generative" : "lightweighting:structural",
  )
  return { state, disabled, blockedReason }
}
