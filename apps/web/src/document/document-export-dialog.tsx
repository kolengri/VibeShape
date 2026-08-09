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
import { useState } from "react"
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

function useDocumentExportAction(closeDialog: () => void) {
  const [activity, setActivity] = useState<ExportActivity>(idleActivity)

  const runExport = async (format: GeometryExportFormat) => {
    setActivity({ pendingFormat: format, statusKey: formatCopy[format].pending, failed: false })
    const result = await exportActiveDocument(format)
    if (!result.ok) {
      setActivity({ pendingFormat: null, statusKey: "status.failed", failed: true })
      return
    }
    downloadDocumentExport(result)
    setActivity({ pendingFormat: null, statusKey: formatCopy[format].succeeded, failed: false })
    closeDialog()
  }

  return { activity, runExport }
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
}: {
  format: GeometryExportFormat
  disabled: boolean
  loading: boolean
  onExport: (format: GeometryExportFormat) => Promise<void>
}) {
  const t = useTranslations("app.export")
  const copy = formatCopy[format]
  return (
    <section className="grid content-start gap-3 rounded-md border bg-card p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{t(copy.title)}</h3>
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

export function DocumentExportDialog({ controller }: { controller: DocumentControllerState }) {
  const t = useTranslations("app.export")
  const [open, setOpen] = useState(false)
  const { activity, runExport } = useDocumentExportAction(() => setOpen(false))
  const hasGeometry = documentHasExportableGeometry(controller)
  const actionDisabled = activity.pendingFormat !== null || !hasGeometry

  return (
    <>
      <ExportStatus messageKey={activity.statusKey} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            {t("trigger")}
          </Button>
        </DialogTrigger>
        <DialogContent closeLabel={t("closeLabel")}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <ExportFormatCard
              format="3mf"
              disabled={actionDisabled}
              loading={activity.pendingFormat === "3mf"}
              onExport={runExport}
            />
            <ExportFormatCard
              format="step"
              disabled={actionDisabled}
              loading={activity.pendingFormat === "step"}
              onExport={runExport}
            />
            <ExportFormatCard
              format="stl"
              disabled={actionDisabled}
              loading={activity.pendingFormat === "stl"}
              onExport={runExport}
            />
          </div>
          <ExportNotice hasGeometry={hasGeometry} failed={activity.failed} />
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
