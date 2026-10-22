import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useMemo, useRef } from "react"
import { ActionAvailability } from "../../components/action-availability"
import { TaskPanelHeader } from "../../components/task-panel-header"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import type { DocumentControllerState } from "../../document/document-controller"
import { useRegisterTaskSubmission } from "../../editor-session/editor-session-provider"
import type { WorkspaceTaskPreview } from "../../shell/workspace-task-context"
import { ImportPreview } from "../import/import-preview"
import { LightweightingSourceSelector } from "./lightweighting-source-selector"
import { QuickLightweightingResults } from "./quick-lightweighting-results"
import { useLightweightingViewportPreview } from "./use-lightweighting-viewport-preview"
import { useQuickLightweightingTask } from "./use-quick-lightweighting-task"

function RangeControl({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  onEditingChange,
  description,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  onChange: (value: number) => void
  onEditingChange: (control: string, editing: boolean) => void
  description: string
}) {
  const gestures = useRef(new Set<string>())
  const changeGesture = (gesture: string, active: boolean) => {
    if (active) gestures.current.add(gesture)
    else gestures.current.delete(gesture)
    onEditingChange(id, gestures.current.size > 0)
  }
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-description`}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          changeGesture("pointer", true)
        }}
        onPointerUp={() => changeGesture("pointer", false)}
        onPointerCancel={() => changeGesture("pointer", false)}
        onLostPointerCapture={() => changeGesture("pointer", false)}
        onKeyDown={(event) => {
          if (rangeKeys.has(event.key)) changeGesture(event.key, true)
        }}
        onKeyUp={(event) => {
          if (rangeKeys.has(event.key)) changeGesture(event.key, false)
        }}
        onBlur={() => {
          gestures.current.clear()
          onEditingChange(id, false)
        }}
        className="h-6 w-full cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
      />
      <p id={`${id}-description`} className="text-xs text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

const rangeKeys = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
])

export function QuickLightweightingTaskPanel({
  controller,
  blocked,
  initialPartId,
  onClose,
  onApplyingChange,
  onApplied,
  onPreviewChange,
}: {
  controller: DocumentControllerState
  blocked: boolean
  initialPartId: string
  onClose: () => void
  onApplied?: () => void
  onApplyingChange?: (applying: boolean) => void
  onPreviewChange?: (preview: WorkspaceTaskPreview | null) => void
}) {
  const t = useTranslations("app.quickLightweighting")
  const disabled =
    blocked ||
    controller.status !== "ready" ||
    controller.saveStatus === "saving" ||
    controller.report?.mode !== "read-write"
  const copy = useMemo(
    () => ({
      failed: t("failed"),
      saveFailed: t("saveFailed"),
      stale: t("stale"),
      label: (name: string) => t("featureLabel", { name }),
      error: (code: string) =>
        t(
          code === "resource-limit"
            ? "resourceLimit"
            : code === "disconnected-mesh"
              ? "disconnected"
              : code === "no-removable-material"
                ? "noRemovable"
                : "failed",
        ),
    }),
    [t],
  )
  const state = useQuickLightweightingTask({
    controller,
    initialPartId,
    disabled,
    copy,
    onApplied: onApplied ?? onClose,
    onApplyingChange,
  })
  useRegisterTaskSubmission(state.apply, "lightweighting:quick")
  const applying = state.activity === "applying"
  useReportActivity(state.activity !== "idle")
  useLightweightingViewportPreview(state.ready, onPreviewChange, state.setPreviewReady)
  return (
    <section
      aria-label={t("title")}
      className="grid h-full min-h-0 content-start gap-2 overflow-y-auto p-3"
    >
      <TaskPanelHeader
        title={t("title")}
        description={t("description")}
        actions={<QuickLifecycleActions state={state} disabled={disabled} onClose={onClose} />}
      />
      <LightweightingSourceSelector
        controller={controller}
        state={state}
        disabled={disabled || applying}
      />
      <QuickControls state={state} disabled={disabled || applying} />
      <QuickPreview state={state} mainViewport={onPreviewChange !== undefined} />
      <QuickActions state={state} disabled={disabled} />
    </section>
  )
}

type QuickState = ReturnType<typeof useQuickLightweightingTask>
function QuickModeControls({ state, disabled }: { state: QuickState; disabled: boolean }) {
  const t = useTranslations("app.quickLightweighting")
  const change = (next: Partial<typeof state.settings>) =>
    state.changeSettings({ ...state.settings, ...next })
  return (
    <fieldset className="grid gap-2">
      <legend className="text-xs font-medium">{t("mode")}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={state.settings.mode === "preserve-exterior" ? "secondary" : "outline"}
          aria-pressed={state.settings.mode === "preserve-exterior"}
          disabled={disabled}
          onClick={() => change({ mode: "preserve-exterior" })}
        >
          {t("preserveExterior")}
        </Button>
        <Button
          type="button"
          variant={state.settings.mode === "open-organic" ? "secondary" : "outline"}
          aria-pressed={state.settings.mode === "open-organic"}
          disabled={disabled}
          onClick={() => change({ mode: "open-organic" })}
        >
          {t("openOrganic")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(state.settings.mode === "preserve-exterior" ? "preserveDescription" : "openDescription")}
      </p>
    </fieldset>
  )
}

function QuickControls({ state, disabled }: { state: QuickState; disabled: boolean }) {
  const t = useTranslations("app.quickLightweighting")
  const change = (next: Partial<typeof state.settings>) =>
    state.changeSettings({ ...state.settings, ...next })
  return (
    <div className="grid gap-5">
      <QuickModeControls state={state} disabled={disabled} />
      <SelectField
        id="quick-cell-type"
        label={t("cellType")}
        value={state.settings.cellType}
        disabled={disabled}
        onValueChange={(cellType) => {
          if (cellType === "gyroid" || cellType === "schwarz-p" || cellType === "schwarz-d")
            change({
              cellType,
              ...(cellType === "schwarz-d" ? { periodFraction: 12 / state.settings.detail } : {}),
            })
        }}
      >
        <SelectOption value="gyroid">{t("cellGyroid")}</SelectOption>
        <SelectOption value="schwarz-p">{t("cellSchwarzP")}</SelectOption>
        <SelectOption value="schwarz-d">{t("cellSchwarzD")}</SelectOption>
      </SelectField>
      {state.settings.cellType === "schwarz-d" && (
        <p className="text-xs text-muted-foreground">{t("schwarzDSampling")}</p>
      )}
      <RangeControl
        id="quick-cell-size"
        label={t("cellSize", { value: state.input?.latticeCellSizeMm ?? 0 })}
        value={state.settings.periodFraction}
        min={6 / state.settings.detail}
        max={12 / state.settings.detail}
        step={1 / state.settings.detail}
        disabled={disabled}
        onChange={(periodFraction) => change({ periodFraction })}
        onEditingChange={state.changeEditing}
        description={t("cellSizeDescription")}
      />
      <RangeControl
        id="quick-removal"
        label={t("removal", { value: state.settings.removalPercent })}
        value={state.settings.removalPercent}
        min={5}
        max={80}
        step={5}
        disabled={disabled}
        onChange={(removalPercent) => change({ removalPercent })}
        onEditingChange={state.changeEditing}
        description={t("removalDescription")}
      />
      <RangeControl
        id="quick-detail"
        label={t("detail")}
        value={state.settings.detail}
        min={24}
        max={40}
        step={8}
        disabled={disabled}
        onChange={(detail) => change({ detail })}
        onEditingChange={state.changeEditing}
        description={
          state.input ? t("cellScale", { value: state.input.cellSizeMm }) : t("detailDescription")
        }
      />
      {state.settings.mode === "preserve-exterior" && (
        <RangeControl
          id="quick-skin"
          label={t("skin", { value: state.input?.skinThicknessMm ?? 0 })}
          value={state.settings.skinCells}
          min={2}
          max={6}
          step={0.5}
          disabled={disabled}
          onChange={(skinCells) => change({ skinCells })}
          onEditingChange={state.changeEditing}
          description={t("skinDescription")}
        />
      )}
    </div>
  )
}
function QuickPreview({ state, mainViewport }: { state: QuickState; mainViewport: boolean }) {
  const t = useTranslations("app.quickLightweighting")
  return (
    <>
      {state.activity !== "idle" && (
        <p role="status" className="text-sm">
          {state.activity === "generating" && state.progress
            ? t(state.progress.phase === "sampling" ? "samplingProgress" : "validationProgress", {
                completed: state.progress.completed,
                total: state.progress.total,
              })
            : t(state.activity)}
        </p>
      )}
      {state.message && <Alert>{state.message}</Alert>}
      {state.ready && (
        <>
          <QuickLightweightingResults result={state.ready.result} />
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
        </>
      )}
    </>
  )
}
function quickActionReasons(
  state: QuickState,
  disabled: boolean,
  t: ReturnType<typeof useTranslations<"app.quickLightweighting">>,
) {
  const generate = disabled
    ? t("blocked")
    : !state.source
      ? t("chooseSource")
      : state.editing
        ? t("editing")
        : state.activity !== "idle"
          ? t("busy")
          : null
  const apply =
    generate ?? (!state.ready ? t("needPreview") : !state.previewReady ? t("inspecting") : null)
  return { generate, apply }
}
function QuickActions({ state, disabled }: { state: QuickState; disabled: boolean }) {
  const t = useTranslations("app.quickLightweighting")
  const { generate: generateReason } = quickActionReasons(state, disabled, t)
  return (
    <div className="grid gap-2">
      <ActionAvailability presentation="persistent" disabledReason={generateReason}>
        {({ describedBy }) => (
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(generateReason)}
            aria-describedby={describedBy}
            onClick={() => {
              void state.generate()
            }}
          >
            {t("regenerate")}
          </Button>
        )}
      </ActionAvailability>
    </div>
  )
}

function QuickLifecycleActions({
  state,
  disabled,
  onClose,
}: {
  state: QuickState
  disabled: boolean
  onClose: () => void
}) {
  const t = useTranslations("app.quickLightweighting")
  const applying = state.activity === "applying"
  const { apply: applyReason } = quickActionReasons(state, disabled, t)
  return (
    <TaskPanelLifecycleActions
      ariaLabel={t("actions")}
      acceptLabel={t("apply")}
      cancelLabel={
        state.activity === "loading" || state.activity === "generating"
          ? t("cancelGeneration")
          : t("cancel")
      }
      acceptDisabled={!state.canApply}
      {...(applyReason ? { acceptDisabledReason: applyReason } : {})}
      cancelDisabled={applying}
      onAccept={state.apply}
      onCancel={onClose}
    />
  )
}
