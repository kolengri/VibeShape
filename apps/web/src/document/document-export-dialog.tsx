import { resolveAuthoredParts } from "@vibeshape/application/authored-parts"
import { useTranslations } from "@vibeshape/i18n"
import type { GeometryExportFormat, MeshExportQuality } from "@vibeshape/protocol"
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
import { useCallback, useEffect, useState } from "react"
import { useDialogOpen } from "../components/use-dialog-open"
import { PrintPreparationPanel } from "../printing/print-preparation-panel"
import { SlicerHandoffPanel } from "../printing/slicer-handoff-panel"
import type { DocumentControllerState } from "./document-controller"
import { exportActiveDocument } from "./document-controller"
import { downloadDocumentExport } from "./document-export"
import {
  type MeshExportQualityChoice,
  MeshExportQualityField,
  meshExportQuality,
} from "./mesh-export-quality-field"

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
  errorKey?: "meshStepError"
}>

const idleActivity: ExportActivity = { pendingFormat: null, statusKey: null, failed: false }

function useDocumentExportAction(
  closeDialog: () => void,
  partId: string | undefined,
  open: boolean,
  includesMesh = false,
  quality?: MeshExportQuality,
) {
  const [activity, setActivity] = useState<ExportActivity>(idleActivity)

  const runExport = async (format: GeometryExportFormat) => {
    if (format === "step" && includesMesh) {
      setActivity({
        pendingFormat: null,
        statusKey: "status.failed",
        failed: true,
        errorKey: "meshStepError",
      })
      return
    }
    setActivity({ pendingFormat: format, statusKey: formatCopy[format].pending, failed: false })
    try {
      const result =
        quality && format !== "step"
          ? await exportActiveDocument(format, partId, quality)
          : await exportActiveDocument(format, partId)
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

  const resetActivity = useCallback(() => setActivity(idleActivity), [])
  useEffect(() => {
    if (open) resetActivity()
  }, [open, resetActivity])
  return { activity, runExport }
}

function documentHasExportableGeometry(controller: DocumentControllerState) {
  const rebuild = controller.report?.rebuild
  return (
    rebuild?.ok === true &&
    rebuild.response.geometry.some(
      ({ geometry }) =>
        geometry.shape.solidCount > 0 || geometry.representation === "triangle-mesh",
    )
  )
}

function exportSelectionIncludesMesh(controller: DocumentControllerState, partId?: string) {
  const authority = controller.authoredSnapshot
  const report = controller.report
  if (partId && authority && authority.schemaVersion !== 1 && report) {
    return (
      resolveAuthoredParts(authority, report)?.find(({ part }) => part.id === partId)?.body
        ?.representation === "triangle-mesh"
    )
  }
  return (
    report?.rebuild?.ok === true &&
    report.rebuild.response.geometry.some(
      ({ geometry }) => geometry.representation === "triangle-mesh",
    )
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

function ExportNotice({
  hasGeometry,
  failed,
  errorKey,
}: {
  hasGeometry: boolean
  failed: boolean
  errorKey?: "meshStepError" | undefined
}) {
  const t = useTranslations("app.export")
  if (!hasGeometry) return <p className="text-sm text-muted-foreground">{t("noBodies")}</p>
  if (!failed) return null
  return (
    <p className="text-sm text-destructive" role="alert">
      {t(errorKey ?? "error")}
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

function useExportDialogPresentation(open: boolean) {
  const [slicerStatus, setSlicerStatus] = useState<string | null>(null)
  const [showPreparation, setShowPreparation] = useState(false)
  const [exportPart, setExportPart] = useState("all")
  const [meshQualityChoice, setMeshQualityChoice] = useState<MeshExportQualityChoice>("default")
  useEffect(() => {
    if (!open) return
    setSlicerStatus(null)
    setShowPreparation(false)
    setExportPart("all")
    setMeshQualityChoice("default")
  }, [open])
  return {
    slicerStatus,
    setSlicerStatus,
    showPreparation,
    setShowPreparation,
    exportPart,
    setExportPart,
    meshQualityChoice,
    setMeshQualityChoice,
  }
}

function ExportFormatCards({
  preferredFormat,
  disabled,
  pendingFormat,
  onExport,
}: {
  preferredFormat: GeometryExportFormat
  disabled: boolean
  pendingFormat: GeometryExportFormat | null
  onExport: (format: GeometryExportFormat) => Promise<void>
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        preferredFormat,
        ...(["3mf", "step", "stl"] as const).filter((format) => format !== preferredFormat),
      ].map((format) => (
        <ExportFormatCard
          key={format}
          format={format}
          preferred={format === preferredFormat}
          disabled={disabled}
          loading={pendingFormat === format}
          onExport={onExport}
        />
      ))}
    </div>
  )
}

function ExportDialogTrigger({
  shown,
  controller,
}: {
  shown: boolean
  controller: DocumentControllerState
}) {
  const t = useTranslations("app.export")
  if (!shown) return null
  return (
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
  )
}

export function DocumentExportDialog({
  controller,
  preferredFormat = "3mf",
  showTrigger = true,
  open: controlledOpen,
  onOpenChange,
  onCloseAutoFocus,
}: {
  controller: DocumentControllerState
  preferredFormat?: GeometryExportFormat
  showTrigger?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const t = useTranslations("app.export")
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const [slicerPending, setSlicerPending] = useState(false)
  const [printPending, setPrintPending] = useState(false)
  const {
    slicerStatus,
    setSlicerStatus,
    showPreparation,
    setShowPreparation,
    exportPart,
    setExportPart,
    meshQualityChoice,
    setMeshQualityChoice,
  } = useExportDialogPresentation(open)
  const selectedPartId = exportPart === "all" ? undefined : exportPart
  const { activity, runExport } = useDocumentExportAction(
    () => setOpen(false),
    selectedPartId,
    open,
    exportSelectionIncludesMesh(controller, selectedPartId),
    meshExportQuality(meshQualityChoice),
  )
  const hasGeometry = documentHasExportableGeometry(controller)
  const preparationDisabled = activity.pendingFormat !== null || slicerPending || !hasGeometry
  const actionDisabled = preparationDisabled || printPending

  return (
    <>
      {slicerStatus ? (
        <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {slicerStatus}
        </span>
      ) : (
        <ExportStatus messageKey={activity.statusKey} />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <ExportDialogTrigger shown={showTrigger} controller={controller} />
        <DialogContent
          onCloseAutoFocus={onCloseAutoFocus}
          closeLabel={t("closeLabel")}
          className="max-h-[calc(100%-2rem)] max-w-3xl overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
            {(controller.authoredSnapshot?.schemaVersion === 3 ||
              controller.authoredSnapshot?.schemaVersion === 4 ||
              controller.authoredSnapshot?.schemaVersion === 5) &&
              controller.authoredSnapshot.surfaceTextures.some(({ enabled }) => enabled) && (
                <p className="text-xs text-muted-foreground">{t("textureExportHint")}</p>
              )}
          </DialogHeader>
          {!showPreparation ? (
            <>
              <MeshExportQualityField
                value={meshQualityChoice}
                onChange={setMeshQualityChoice}
                disabled={actionDisabled}
              />
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
                prepareMesh={(format) =>
                  meshQualityChoice === "default"
                    ? exportActiveDocument(format, selectedPartId)
                    : exportActiveDocument(
                        format,
                        selectedPartId,
                        meshExportQuality(meshQualityChoice),
                      )
                }
              />
              <ExportFormatCards
                preferredFormat={preferredFormat}
                disabled={actionDisabled}
                pendingFormat={activity.pendingFormat}
                onExport={runExport}
              />
            </>
          ) : null}
          <ExportNotice
            hasGeometry={hasGeometry}
            failed={activity.failed}
            errorKey={activity.errorKey}
          />
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
