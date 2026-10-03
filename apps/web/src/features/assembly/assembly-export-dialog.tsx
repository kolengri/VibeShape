import type { AssemblyInstance } from "@vibeshape/domain/assembly"
import { useTranslations } from "@vibeshape/i18n"
import type {
  AssemblyInspection,
  GeometryExportFormat,
  PrintPreparationSettings,
} from "@vibeshape/protocol"
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
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useCallback, useState } from "react"
import { exportActiveAssembly } from "../../document/document-controller"
import { PrintPreparationPanel } from "../../printing/print-preparation-panel"
import { useAssemblyExport } from "./use-assembly-export"

type ExportSelection = {
  instances: readonly AssemblyInstance[]
  selectedId: string | null
  inspection: AssemblyInspection | null
  disabled: boolean
}
function AssemblyExportFormats({
  disabled,
  includesMesh,
  pending,
  onExport,
}: {
  disabled: boolean
  includesMesh: boolean
  pending: GeometryExportFormat | null
  onExport: (format: GeometryExportFormat) => Promise<void>
}) {
  const t = useTranslations("app.assembly")
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {(["step", "stl", "3mf"] as const).map((format) => (
        <Button
          key={format}
          type="button"
          variant="outline"
          disabled={disabled || (format === "step" && includesMesh)}
          aria-busy={pending === format}
          onClick={() => void onExport(format)}
        >
          {t(`exportFormat.${format}`)}
        </Button>
      ))}
    </div>
  )
}
function selectedInstanceScope(scope: string) {
  return scope === "all" ? {} : { instanceIds: [scope] }
}
function useAssemblyExportSelection({ selectedId, inspection, disabled }: ExportSelection) {
  const [scope, setScope] = useState(selectedId ?? "all")
  const [showPreparation, setShowPreparation] = useState(false)
  const [printPending, setPrintPending] = useState(false)
  const action = useAssemblyExport()
  const selected =
    inspection?.occurrences.filter(({ instanceId }) => scope === "all" || instanceId === scope) ??
    []
  const includesMesh = selected.some(({ representation }) => representation === "triangle-mesh")
  const busy = disabled || action.pending !== null || printPending || selected.length === 0
  const prepare = useCallback(
    (settings: PrintPreparationSettings, signal: AbortSignal) =>
      exportActiveAssembly(
        { format: "3mf", ...selectedInstanceScope(scope), printPreparation: settings },
        signal,
      ),
    [scope],
  )
  const exportFormat = (format: GeometryExportFormat) =>
    action.run({ format, ...selectedInstanceScope(scope) })
  return {
    scope,
    setScope,
    showPreparation,
    setShowPreparation,
    setPrintPending,
    action,
    includesMesh,
    busy,
    sourceCount: selected.length,
    prepare,
    exportFormat,
    preparationDisabled: disabled || action.pending !== null || selected.length > 8,
  }
}
type ExportView = ReturnType<typeof useAssemblyExportSelection>
function AssemblyExportScope({
  view,
  instances,
}: {
  view: ExportView
  instances: ExportSelection["instances"]
}) {
  const t = useTranslations("app.assembly")
  return (
    <SelectField
      label={t("exportScope")}
      value={view.scope}
      onValueChange={view.setScope}
      disabled={view.busy}
    >
      <SelectOption value="all">{t("exportAll")}</SelectOption>
      {instances.map(({ id, name }) => (
        <SelectOption key={id} value={id}>
          {name}
        </SelectOption>
      ))}
    </SelectField>
  )
}
function AssemblyExportStatus({ view }: { view: ExportView }) {
  const t = useTranslations("app.assembly")
  return (
    <>
      {view.includesMesh && <p className="text-xs text-muted-foreground">{t("exportMeshStep")}</p>}
      {view.action.failed && (
        <p role="alert" className="text-sm text-destructive">
          {t("exportFailed")}
        </p>
      )}
      {view.action.downloaded && (
        <p role="status" className="text-sm">
          {t("exportDownloaded", { format: view.action.downloaded.toUpperCase() })}
        </p>
      )}
    </>
  )
}
function AssemblyPrintPreparation({ view }: { view: ExportView }) {
  const t = useTranslations("app.assembly")
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={view.busy || (!view.showPreparation && view.sourceCount > 8)}
        aria-expanded={view.showPreparation}
        onClick={() => view.setShowPreparation(!view.showPreparation)}
      >
        {t(view.showPreparation ? "originalExport" : "preparePrint")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("printSourceLimit")}</p>
      {view.showPreparation && (
        <PrintPreparationPanel
          key={view.scope}
          disabled={view.preparationDisabled}
          onBusyChange={view.setPrintPending}
          prepare={view.prepare}
          limitations={t("printLimitations")}
        />
      )}
    </>
  )
}
function AssemblyExportContent(props: ExportSelection) {
  const t = useTranslations("app.assembly")
  const view = useAssemblyExportSelection(props)
  return (
    <>
      <AssemblyExportScope view={view} instances={props.instances} />
      <p className="text-xs text-muted-foreground">{t("exportGeometryExplanation")}</p>
      {!view.showPreparation && (
        <AssemblyExportFormats
          disabled={view.busy}
          includesMesh={view.includesMesh}
          pending={view.action.pending}
          onExport={view.exportFormat}
        />
      )}
      <AssemblyExportStatus view={view} />
      <AssemblyPrintPreparation view={view} />
    </>
  )
}
export function AssemblyExportDialog(props: ExportSelection) {
  const t = useTranslations("app.assembly")
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={props.disabled || props.instances.length === 0 || !props.inspection}
        >
          {t("exportAssembly")}
        </Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={t("cancel")}
        className="max-h-[calc(100%-2rem)] max-w-3xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("exportAssembly")}</DialogTitle>
          <DialogDescription>{t("exportDescription")}</DialogDescription>
        </DialogHeader>
        <AssemblyExportContent {...props} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("closeExport")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
