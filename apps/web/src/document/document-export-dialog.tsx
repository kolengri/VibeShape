import { resolveAuthoredParts } from "@vibeshape/application/authored-parts"
import { useTranslations } from "@vibeshape/i18n"
import type { GeometryExportFormat } from "@vibeshape/protocol"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { Download } from "@vibeshape/ui/components/icons"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { useState } from "react"
import { PrintPreparationPanel } from "../printing/print-preparation-panel"
import { SlicerHandoffPanel } from "../printing/slicer-handoff-panel"
import type { DocumentControllerState } from "./document-controller"
import { exportActiveDocument } from "./document-controller"
import { downloadDocumentExport } from "./document-export"

const formatCopy = {
  "3mf": {
    title: "threeMf.title",
    description: "threeMf.description",
    action: "threeMf.action",
    pending: "status.exportingThreeMf",
    succeeded: "status.exportedThreeMf",
  },
  step: {
    title: "step.title",
    description: "step.description",
    action: "step.action",
    pending: "status.exportingStep",
    succeeded: "status.exportedStep",
  },
  stl: {
    title: "stl.title",
    description: "stl.description",
    action: "stl.action",
    pending: "status.exportingStl",
    succeeded: "status.exportedStl",
  },
} as const

type ExportActivity = Readonly<{
  pendingFormat: GeometryExportFormat | null
  statusKey: string | null
  failed: boolean
}>

const idleActivity: ExportActivity = { pendingFormat: null, statusKey: null, failed: false }

function useDocumentExportAction(closeDialog: () => void, partId?: string) {
  const [activity, setActivity] = useState<ExportActivity>(idleActivity)

  const runExport = async (format: GeometryExportFormat) => {
    setActivity({ pendingFormat: format, statusKey: formatCopy[format].pending, failed: false })
    try {
      const result = await exportActiveDocument(format, partId)
      if (!result.ok) {
        setActivity({ pendingFormat: null, statusKey: "status.failed", failed: true })
        return
      }
      downloadDocumentExport(result)
      setActivity({ pendingFormat: null, statusKey: formatCopy[format].succeeded, failed: false })
      closeDialog()
    } catch {
      setActivity({ pendingFormat: null, statusKey: "status.failed", failed: true })
    }
  }

  return { activity, runExport, resetActivity: () => setActivity(idleActivity) }
}

function documentHasExportableGeometry(controller: DocumentControllerState) {
  const rebuild = controller.report?.rebuild
  return (
    rebuild?.ok === true &&
    rebuild.response.geometry.some(({ geometry }) => geometry.shape.solidCount > 0)
  )
}

function ExportStatus({ messageKey }: { messageKey: string | null }) {
  const t = useTranslations("app.export")
  if (!messageKey) return null
  return (
    <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
      {t(messageKey)}
    </span>
  )
}

function ExportFormatCard({
  format,
  disabled,
  loading,
  onExport,
  preferred,
}: {
  format: GeometryExportFormat
  preferred: boolean
  disabled: boolean
  loading: boolean
  onExport: (format: GeometryExportFormat) => Promise<void>
}) {
  const t = useTranslations("app.export")
  const settingsT = useTranslations("app.settings")
  const copy = formatCopy[format]
  return (
    <section className="grid content-start gap-3 rounded-md border bg-card p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{t(copy.title)}</h3>
        {preferred ? <span className="text-xs text-primary">{settingsT("preferred")}</span> : null}
        <p className="text-xs text-muted-foreground">{t(copy.description)}</p>
      </div>
      <Button
        type="button"
        disabled={disabled}
        isLoading={loading}
        onClick={() => onExport(format)}
      >
        {t(copy.action)}
      </Button>
    </section>
  )
}

function ExportNotice({ hasGeometry, failed }: { hasGeometry: boolean; failed: boolean }) {
  const t = useTranslations("app.export")
  if (!hasGeometry) return <p className="text-sm text-muted-foreground">{t("noBodies")}</p>
  if (!failed) return null
  return (
    <p className="text-sm text-destructive" role="alert">
      {t("error")}
    </p>
  )
}

function ExportPartSelection({
  controller,
  value,
  onChange,
  disabled,
}: {
  controller: DocumentControllerState
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const t = useTranslations("app.export")
  const authority = controller.authoredSnapshot
  if (!authority || authority.schemaVersion === 1 || !controller.report) return null
  const parts =
    resolveAuthoredParts(authority, controller.report)?.filter(({ body }) => body !== null) ?? []
  if (parts.length === 0) return null
  return (
    <div className="grid gap-2">
      <SelectField
        label={t("parts.label")}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectOption value="all">{t("parts.all")}</SelectOption>
        {parts.map(({ part }) => (
          <SelectOption key={part.id} value={part.id}>
            {part.name}
          </SelectOption>
        ))}
      </SelectField>
      <p className="text-xs text-muted-foreground">{t("parts.description")}</p>
    </div>
  )
}

function ExportPreparation({
  controller,
  available,
  shown,
  onShowChange,
  disabled,
  panelDisabled,
  onBusyChange,
}: {
  controller: DocumentControllerState
  available: boolean
  shown: boolean
  onShowChange: (shown: boolean) => void
  disabled: boolean
  panelDisabled: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const t = useTranslations("app.export")
  if (!available) return null
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-expanded={shown}
        onClick={() => onShowChange(!shown)}
      >
        {t(shown ? "originalExport" : "preparePrint")}
      </Button>
      {shown ? (
        <PrintPreparationPanel
          key={`${controller.report?.snapshot.id}:${controller.report?.snapshot.revision}`}
          disabled={panelDisabled}
          onBusyChange={onBusyChange}
        />
      ) : null}
    </>
  )
}

export function DocumentExportDialog({
  controller,
  preferredFormat = "3mf",
}: {
  controller: DocumentControllerState
  preferredFormat?: GeometryExportFormat
}) {
  const t = useTranslations("app.export")
  const [open, setOpen] = useState(false)
  const [slicerPending, setSlicerPending] = useState(false)
  const [slicerStatus, setSlicerStatus] = useState<string | null>(null)
  const [printPending, setPrintPending] = useState(false)
  const [showPreparation, setShowPreparation] = useState(false)
  const [exportPart, setExportPart] = useState("all")
  const selectedPartId = exportPart === "all" ? undefined : exportPart
  const { activity, runExport, resetActivity } = useDocumentExportAction(
    () => setOpen(false),
    selectedPartId,
  )
  const hasGeometry = documentHasExportableGeometry(controller)
  const preparationDisabled = activity.pendingFormat !== null || slicerPending || !hasGeometry
  const actionDisabled = preparationDisabled || printPending
  const changeDialogOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setSlicerStatus(null)
      resetActivity()
      setShowPreparation(false)
      setExportPart("all")
    }
    setOpen(nextOpen)
  }

  return (
    <>
      {slicerStatus ? (
        <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {slicerStatus}
        </span>
      ) : (
        <ExportStatus messageKey={activity.statusKey} />
      )}
      <Dialog open={open} onOpenChange={changeDialogOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("trigger")}
                disabled={controller.status !== "ready" || controller.report === null}
              >
                <Download aria-hidden="true" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("trigger")}</TooltipContent>
        </Tooltip>
        <DialogContent
          closeLabel={t("closeLabel")}
          className="max-h-[calc(100%-2rem)] max-w-3xl overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
            {controller.authoredSnapshot?.schemaVersion === 3 &&
              controller.authoredSnapshot.surfaceTextures.some(({ enabled }) => enabled) && (
                <p className="text-xs text-muted-foreground">{t("textureExportHint")}</p>
              )}
          </DialogHeader>
          {!showPreparation ? (
            <>
              <ExportPartSelection
                controller={controller}
                value={exportPart}
                onChange={setExportPart}
                disabled={actionDisabled}
              />
              <SlicerHandoffPanel
                disabled={actionDisabled}
                onBusyChange={setSlicerPending}
                onOpened={(message) => {
                  setSlicerStatus(message)
                  setOpen(false)
                }}
                prepareThreeMf={() => exportActiveDocument("3mf", selectedPartId)}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  preferredFormat,
                  ...(["3mf", "step", "stl"] as const).filter(
                    (format) => format !== preferredFormat,
                  ),
                ].map((format) => (
                  <ExportFormatCard
                    key={format}
                    format={format}
                    preferred={format === preferredFormat}
                    disabled={actionDisabled}
                    loading={activity.pendingFormat === format}
                    onExport={runExport}
                  />
                ))}
              </div>
            </>
          ) : null}
          <ExportNotice hasGeometry={hasGeometry} failed={activity.failed} />
          <ExportPreparation
            controller={controller}
            available={exportPart === "all"}
            shown={showPreparation}
            onShowChange={setShowPreparation}
            disabled={actionDisabled}
            panelDisabled={preparationDisabled}
            onBusyChange={setPrintPending}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("close")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
