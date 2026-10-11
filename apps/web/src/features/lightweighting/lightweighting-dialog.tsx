import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import type { ViewerAnalysisOverlay, ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ActionAvailability } from "../../components/action-availability"
import type { DocumentControllerState } from "../../document/document-controller"
import { useRegisterTaskSubmission } from "../../editor-session/editor-session-provider"
import type { WorkspaceTaskPreview } from "../../shell/workspace-task-context"
import { ImportPreview } from "../import/import-preview"
import { GenerativeDesignControls, GenerativeDesignResults } from "./generative-design-controls"
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
  const stages = { loading: "loading", solving: "solving", inspecting: "inspecting" } as const
  const stage =
    state.activity === "idle" || state.activity === "applying" ? null : stages[state.activity]
  return (
    <>
      {stage && (
        <p role="status" className="text-sm">
          {t(stage)}
        </p>
      )}
      {state.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </>
  )
}

function ResultPreview({ state, mainViewport }: { state: TaskState; mainViewport: boolean }) {
  const t = useTranslations("app.lightweighting")
  if (!state.ready) return null
  return (
    <>
      <LightweightingResults result={state.ready.result} />
      {mainViewport ? (
        <p className="text-xs text-muted-foreground">{t("mainPreview")}</p>
      ) : (
        <ImportPreview
          inspection={state.ready.inspection}
          label={t("preview")}
          failedMessage={t("previewFailed")}
          onReady={state.setPreviewReady}
        />
      )}
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
    if (!picking) return
    const cancelPicking = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setPicking(null)
    }
    window.addEventListener("keydown", cancelPicking, true)
    return () => window.removeEventListener("keydown", cancelPicking, true)
  }, [picking])

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
function analysisSetupReason(state: TaskState, t: LightweightingCopy) {
  if (!state.source) return t("choosePart")
  const fields = state.fields
  if (
    [fields.youngModulusMpa, fields.poissonRatio, fields.yieldStrengthMpa, fields.densityKgM3].some(
      (value) => value.trim() === "",
    )
  )
    return t("materialRequired")
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
function actionReasons(state: TaskState, blockedReason: string | null, t: LightweightingCopy) {
  const common = blockedReason ?? activityReason(state, t)
  return {
    analyze: common ?? analysisSetupReason(state, t),
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
  const pending = state.activity !== "idle" && state.activity !== "applying"
  const inputsDisabled = disabled || state.activity === "applying"
  const reasons = actionReasons(state, blockedReason, t)
  return (
    <section
      aria-label={panelCopy.title}
      className="@container grid h-full min-h-0 min-w-0 grid-cols-1 content-start gap-4 overflow-y-auto p-3"
    >
      <header className="grid gap-2">
        <h2 className="font-semibold">{panelCopy.title}</h2>
        <p className="text-xs text-muted-foreground">{panelCopy.description}</p>
      </header>
      <fieldset
        disabled={inputsDisabled}
        className="grid min-w-0 grid-cols-1 gap-4"
        aria-busy={pending}
      >
        <legend className="sr-only">{t("settings")}</legend>
        <LightweightingSourceSelector
          controller={controller}
          state={state}
          disabled={inputsDisabled}
        />
        <LightweightingParameters
          showObjective={!generative}
          fields={state.fields}
          onChange={state.changeFields}
          picking={face.picking}
          onPick={face.onPick}
          pickingDisabled={!face.interactive}
        />
        {generative && <GenerativeDesignControls state={state} />}
      </fieldset>
      {face.pickMessage && (
        <p role="status" className="text-xs text-muted-foreground">
          {face.pickMessage}
        </p>
      )}
      <AnalysisActions
        state={state}
        disabledReason={reasons.analyze}
        label={panelCopy.analyze}
        onAnalyze={() => {
          face.stopPicking()
          void state.analyze()
        }}
      />
      <TaskStatus state={state} />
      <GenerativeProgress state={state} />
      <GenerativeDesignResults state={state} />
      <ResultPreview state={state} mainViewport={onPreviewChange !== undefined} />
      <footer className="grid grid-cols-1 gap-2 border-t pt-3">
        <ActionAvailability disabledReason={reasons.apply} presentation="persistent">
          {({ describedBy }) => (
            <Button
              type="button"
              aria-describedby={describedBy}
              isLoading={state.activity === "applying"}
              disabled={!state.canApply}
              className="h-auto max-w-full whitespace-normal"
              onClick={state.apply}
            >
              {t("apply")}
            </Button>
          )}
        </ActionAvailability>
        <Button
          type="button"
          variant="outline"
          disabled={state.activity === "applying"}
          onClick={onClose}
        >
          {t("close")}
        </Button>
      </footer>
    </section>
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
  const t = useTranslations("app.lightweighting")
  const pending = state.activity !== "idle" && state.activity !== "applying"
  return (
    <div className="grid grid-cols-1 gap-2">
      <ActionAvailability disabledReason={disabledReason} presentation="persistent">
        {({ describedBy }) => (
          <Button
            type="button"
            aria-describedby={describedBy}
            isLoading={pending}
            disabled={!state.canAnalyze}
            className="h-auto max-w-full whitespace-normal"
            onClick={onAnalyze}
          >
            {label}
          </Button>
        )}
      </ActionAvailability>
      {pending && (
        <Button type="button" variant="outline" onClick={state.cancel}>
          {t("cancelAnalysis")}
        </Button>
      )}
    </div>
  )
}

function GenerativeProgress({ state }: { state: ReturnType<typeof useGenerativeDesignTask> }) {
  const t = useTranslations("app.generativeDesign")
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
