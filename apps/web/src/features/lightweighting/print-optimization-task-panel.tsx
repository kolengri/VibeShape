import { useTranslations } from "@vibeshape/i18n"
import { PrintOptimizationSetupError } from "@vibeshape/structural-optimization/print-optimization"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { ActionAvailability } from "../../components/action-availability"
import { TaskPanelLayout } from "../../components/task-panel-layout"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import { useRegisterTaskSubmission } from "../../editor-session/editor-session-provider"
import type { WorkspaceTaskPreview } from "../../shell/workspace-task-context"
import { ImportPreview } from "../import/import-preview"
import { ExactPrintOptimizationResults } from "./exact-print-optimization-results"
import type { LightweightingViewportInteraction } from "./lightweighting-dialog"
import { LightweightingSourceSelector } from "./lightweighting-source-selector"
import { PrintOptimizationControls } from "./print-optimization-controls"
import type { PrintOptimizationFields } from "./print-optimization-model"
import type { useLightweightingTask } from "./use-lightweighting-task"
import { useLightweightingViewportPreview } from "./use-lightweighting-viewport-preview"
import { usePrintOptimizationFaces } from "./use-print-optimization-faces"
import {
  type PrintOptimizationTaskOptions,
  usePrintOptimizationTask,
} from "./use-print-optimization-task"

type TaskState = ReturnType<typeof useLightweightingTask>

function printSetupReason(
  state: TaskState,
  fields: PrintOptimizationFields,
  unavailable: boolean,
  t: ReturnType<typeof useTranslations<"app.printOptimization">>,
  l: ReturnType<typeof useTranslations<"app.lightweighting">>,
) {
  if (unavailable) return l("blocked")
  if (!state.source) return l("choosePart")
  if (fields.bedFace === null) return t("chooseBed")
  if (state.inputError instanceof PrintOptimizationSetupError)
    return t(`errors.${state.inputError.code}`)
  return state.canAnalyze ? null : t("invalidSettings")
}

function PrintOptimizationPreview({
  state,
  mainViewport,
}: {
  state: TaskState
  mainViewport: boolean
}) {
  const l = useTranslations("app.lightweighting")
  const t = useTranslations("app.printOptimization")
  if (!state.ready?.exact) return null
  return (
    <>
      <ExactPrintOptimizationResults
        evidence={state.ready.exact}
        proposal={state.ready.result}
        densityKgM3={state.ready.input.material.densityKgM3}
      />
      {mainViewport ? (
        <p className="text-xs text-muted-foreground">{t("exactPreview")}</p>
      ) : (
        <ImportPreview
          inspection={state.ready.inspection}
          label={l("preview")}
          failedMessage={l("previewFailed")}
          onReady={state.setPreviewReady}
        />
      )}
      <Button type="button" size="sm" variant="outline" onClick={state.downloadReport}>
        {l("downloadReport")}
      </Button>
    </>
  )
}

function PrintOptimizationProgress({ state }: { state: TaskState }) {
  const l = useTranslations("app.lightweighting")
  if (state.activity === "idle" || state.activity === "applying") return null
  return (
    <p role="status" className="text-sm">
      {l(state.activity)}
    </p>
  )
}
function PrintOptimizationStatus({
  state,
  pickMessage,
}: {
  state: TaskState
  pickMessage: string | null
}) {
  return (
    <>
      {pickMessage && <Alert>{pickMessage}</Alert>}
      {state.message && <Alert>{state.message}</Alert>}
      <PrintOptimizationProgress state={state} />
    </>
  )
}

export function PrintOptimizationTaskPanel(
  props: PrintOptimizationTaskOptions & {
    onInteractionChange: (interaction: LightweightingViewportInteraction | null) => void
    onPreviewChange?: (preview: WorkspaceTaskPreview | null) => void
    onManual: () => void
  },
) {
  const { controller, onClose, onInteractionChange, onPreviewChange, onManual } = props
  const t = useTranslations("app.printOptimization")
  const l = useTranslations("app.lightweighting")
  const { state, fields, applying, unavailable, change, sourceState } =
    usePrintOptimizationTask(props)
  useReportActivity(state.activity !== "idle")
  useRegisterTaskSubmission(state.apply, "lightweighting:print")
  useLightweightingViewportPreview(state.ready, onPreviewChange, state.setPreviewReady)
  const busy = state.activity !== "idle"
  const face = usePrintOptimizationFaces({
    source: state.source,
    fields,
    disabled: unavailable || busy,
    onChange: change,
    onInteractionChange,
  })
  const reason = printSetupReason(state, fields, unavailable, t, l)
  return (
    <section aria-label={t("title")} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <form
        aria-label={t("title")}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          void state.analyze()
        }}
      >
        <TaskPanelLayout
          title={t("title")}
          description={t("description")}
          actions={
            <TaskPanelLifecycleActions
              ariaLabel={t("title")}
              acceptLabel={t("applyExact")}
              cancelLabel={busy && !applying ? l("cancelAnalysis") : l("close")}
              acceptDisabled={!state.canApply}
              cancelDisabled={applying}
              onAccept={state.apply}
              onCancel={busy ? state.cancel : onClose}
            />
          }
        >
          <LightweightingSourceSelector
            controller={controller}
            state={sourceState}
            disabled={unavailable || busy}
            description={t("sourceDescription")}
          />
          <PrintOptimizationControls
            fields={fields}
            material={state.fields}
            disabled={unavailable || busy || !state.source}
            picking={face.picking}
            onPick={face.pick}
            onChange={change}
            onMaterialChange={state.changeFields}
          />
          <p className="text-xs text-muted-foreground">
            {t("objective", {
              stiffness: Number(fields.stiffnessPercent),
              strength: Number(fields.strengthPercent),
            })}
          </p>
          <PrintOptimizationStatus state={state} pickMessage={face.message} />
          <ActionAvailability
            presentation="persistent"
            disabledReason={busy ? l("analysisBusy") : reason}
          >
            {({ describedBy }) => (
              <Button
                type="submit"
                aria-describedby={describedBy}
                disabled={!state.canAnalyze}
                isLoading={busy && !applying}
              >
                {t("run")}
              </Button>
            )}
          </ActionAvailability>
          <PrintOptimizationPreview state={state} mainViewport={!!onPreviewChange} />
          <Button type="button" variant="ghost" disabled={busy} onClick={onManual}>
            {t("manual")}
          </Button>
        </TaskPanelLayout>
      </form>
    </section>
  )
}
