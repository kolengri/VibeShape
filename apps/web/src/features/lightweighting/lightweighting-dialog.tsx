import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { ImportPreview } from "../import/import-preview"
import { LightweightingParameters } from "./lightweighting-fields"
import { availableLightweightingParts } from "./lightweighting-model"
import { LightweightingResults } from "./lightweighting-results"
import { useLightweightingTask } from "./use-lightweighting-task"

type TaskState = ReturnType<typeof useLightweightingTask>
function SourceSelector({
  controller,
  state,
  disabled,
}: {
  controller: DocumentControllerState
  state: TaskState
  disabled: boolean
}) {
  const t = useTranslations("app.lightweighting")
  const parts = availableLightweightingParts(controller)
  return (
    <>
      <SelectField
        id="lightweighting-part"
        label={t("part")}
        required
        value={state.partId || "unselected"}
        disabled={disabled}
        onValueChange={state.choosePart}
      >
        <SelectOption value="unselected" disabled>
          {t("choosePart")}
        </SelectOption>
        {parts.map(({ part }) => (
          <SelectOption key={part.id} value={part.id}>
            {part.name}
          </SelectOption>
        ))}
      </SelectField>
      {parts.length === 0 && (
        <p role="status" className="text-sm">
          {t("noParts")}
        </p>
      )}
      {state.partId && !state.source && (
        <p role="alert" className="text-sm text-destructive">
          {t("partUnavailable")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t("partDescription")}</p>
    </>
  )
}
function TaskStatus({ state }: { state: TaskState }) {
  const t = useTranslations("app.lightweighting")
  const stages = { loading: "loading", solving: "solving", inspecting: "inspecting" } as const
  const stage =
    state.activity === "idle" || state.activity === "applying" ? null : stages[state.activity]
  return (
    <>
      {state.invalid && <p className="text-xs text-muted-foreground">{t("invalidInputs")}</p>}
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
function ResultPreview({ state }: { state: TaskState }) {
  const t = useTranslations("app.lightweighting")
  if (!state.ready) return null
  return (
    <>
      <LightweightingResults result={state.ready.result} />
      <ImportPreview
        inspection={state.ready.inspection}
        label={t("preview")}
        failedMessage={t("previewFailed")}
        onReady={state.setPreviewReady}
      />
      <Button type="button" variant="outline" onClick={state.downloadReport}>
        {t("downloadReport")}
      </Button>
    </>
  )
}
function LightweightingTask({
  controller,
  disabled,
  onClose,
  onApplyingChange,
}: {
  controller: DocumentControllerState
  disabled: boolean
  onClose: () => void
  onApplyingChange: (applying: boolean) => void
}) {
  const t = useTranslations("app.lightweighting")
  const state = useLightweightingTask({
    controller,
    disabled,
    onApplied: onClose,
    onApplyingChange,
    copy: {
      initialCaseName: t("defaultCaseName", { index: 1 }),
      failed: t("failed"),
      stale: t("stale"),
      saveFailed: t("saveFailed"),
      solverFailed: (code) => t("solverFailed", { code }),
      featureLabel: (part) => t("featureLabel", { part }),
    },
  })
  const pending = state.activity !== "idle" && state.activity !== "applying"
  return (
    <>
      <fieldset
        disabled={disabled || state.activity === "applying"}
        className="grid gap-5"
        aria-busy={pending}
      >
        <legend className="sr-only">{t("settings")}</legend>
        <SourceSelector
          controller={controller}
          state={state}
          disabled={disabled || state.activity === "applying"}
        />
        <LightweightingParameters fields={state.fields} onChange={state.changeFields} />
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          isLoading={pending}
          disabled={!state.canAnalyze}
          onClick={() => void state.analyze()}
        >
          {t("analyze")}
        </Button>
        {pending && (
          <Button type="button" variant="outline" onClick={state.cancel}>
            {t("cancelAnalysis")}
          </Button>
        )}
      </div>
      <TaskStatus state={state} />
      <ResultPreview state={state} />
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={state.activity === "applying"}
          onClick={onClose}
        >
          {t("close")}
        </Button>
        <Button
          type="button"
          isLoading={state.activity === "applying"}
          disabled={!state.canApply}
          onClick={() => void state.apply()}
        >
          {t("apply")}
        </Button>
      </DialogFooter>
    </>
  )
}
export function LightweightingDialog({
  controller,
  blocked,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  controller: DocumentControllerState
  blocked: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const t = useTranslations("app.lightweighting")
  const [applying, setApplying] = useState(false)
  const disabled =
    blocked ||
    controller.status !== "ready" ||
    controller.saveStatus === "saving" ||
    controller.report?.mode !== "read-write"
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!applying) onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl"
        closeLabel={t("close")}
        showCloseButton={!applying}
        onCloseAutoFocus={onCloseAutoFocus}
        aria-busy={applying}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open && (
          <LightweightingTask
            key={controller.report?.snapshot.id ?? "unavailable"}
            controller={controller}
            disabled={disabled && !applying}
            onClose={() => onOpenChange(false)}
            onApplyingChange={setApplying}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
