import type { AssemblyInstanceRecord as AssemblyInstance } from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import type {
  AssemblyExportSettings,
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
import { Download } from "@vibeshape/ui/components/icons"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { ToolbarButton } from "@vibeshape/ui/components/toolbar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { useCallback, useState } from "react"
import { exportActiveAssembly } from "../../document/document-controller"
import { DocumentExportFormatField } from "../../document/document-export-options"
import { MeshExportQualityField, meshExportQuality } from "../../document/mesh-export-quality-field"
import { PrintPreparationPanel } from "../../printing/print-preparation-panel"
import { useReportApplicationError } from "../../shell/application-notices"
import { useViewerPreferences } from "../../shell/viewer-preferences"
import { useAssemblyExport } from "./use-assembly-export"

type ExportSelection = {
  instances: readonly AssemblyInstance[]
  selectedId: string | null
  inspection: AssemblyInspection | null
  disabled: boolean
}
function selectedInstanceScope(scope: string) {
  return scope === "all" ? {} : { instanceIds: [scope] }
}
function useAssemblyExportSelection({ selectedId, inspection, disabled }: ExportSelection) {
  const format = useViewerPreferences(
    (state) => state.lastExportFormat ?? state.preferredExportFormat,
  )
  const setFormat = useViewerPreferences((state) => state.actions.setPreferredExportFormat)
  const [scope, setScope] = useState(selectedId ?? "all")
  const [showPreparation, setShowPreparation] = useState(false)
  const [printPending, setPrintPending] = useState(false)
  const meshQualityChoice = useViewerPreferences((state) => state.exportMeshQuality)
  const setMeshQualityChoice = useViewerPreferences((state) => state.actions.setExportMeshQuality)
  const action = useAssemblyExport()
  const selected =
    inspection?.occurrences.filter(({ instanceId }) => scope === "all" || instanceId === scope) ??
    []
  const includesMesh = selected.some(({ representation }) => representation === "triangle-mesh")
  const busy = disabled || action.pending !== null || printPending || selected.length === 0
  const prepare = useCallback(
    (
      settings: PrintPreparationSettings,
      signal: AbortSignal,
      quality?: AssemblyExportSettings["meshQuality"],
    ) =>
      exportActiveAssembly(
        {
          format: "3mf",
          ...selectedInstanceScope(scope),
          printPreparation: settings,
          ...(quality ? { meshQuality: quality } : {}),
        },
        signal,
      ),
    [scope],
  )
  const exportFormat = (format: GeometryExportFormat) =>
    action.run({
      format,
      ...selectedInstanceScope(scope),
      ...(format !== "step" && meshQualityChoice !== "default"
        ? { meshQuality: meshExportQuality(meshQualityChoice) }
        : {}),
    })
  return {
    format,
    setFormat,
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
    meshQualityChoice,
    setMeshQualityChoice,
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
  const appOwnsError = useReportApplicationError(view.action.failed ? t("exportFailed") : null)
  return (
    <>
      {view.includesMesh && <p className="text-xs text-muted-foreground">{t("exportMeshStep")}</p>}
      {view.action.failed && !appOwnsError && (
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
function AssemblyExportOptions({
  view,
  instances,
}: {
  view: ExportView
  instances: ExportSelection["instances"]
}) {
  const t = useTranslations("app.assembly")
  return (
    <>
      <AssemblyExportScope view={view} instances={instances} />
      <p className="text-xs text-muted-foreground">{t("exportGeometryExplanation")}</p>
      <DocumentExportFormatField
        format={view.format}
        onFormatChange={view.setFormat}
        disabled={view.busy}
      />
      {view.format !== "step" ? (
        <MeshExportQualityField
          value={view.meshQualityChoice}
          onChange={view.setMeshQualityChoice}
          disabled={view.busy}
        />
      ) : null}
    </>
  )
}
function AssemblyExportContent(props: ExportSelection) {
  const t = useTranslations("app.assembly")
  const common = useTranslations("app.export")
  const view = useAssemblyExportSelection(props)
  return (
    <DialogContent
      closeLabel={t("cancel")}
      showCloseButton={false}
      className={view.showPreparation ? "max-w-3xl" : "max-w-xl"}
    >
      <DialogHeader>
        <DialogTitle>{t("exportAssembly")}</DialogTitle>
        <DialogDescription>{t("exportDescription")}</DialogDescription>
      </DialogHeader>
      {view.showPreparation ? (
        <AssemblyExportScope view={view} instances={props.instances} />
      ) : (
        <AssemblyExportOptions view={view} instances={props.instances} />
      )}
      <AssemblyExportStatus view={view} />
      <AssemblyPrintPreparation view={view} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("closeExport")}
          </Button>
        </DialogClose>
        {!view.showPreparation ? (
          <Button
            type="button"
            disabled={view.busy || (view.format === "step" && view.includesMesh)}
            isLoading={view.action.pending !== null}
            onClick={() => view.exportFormat(view.format)}
          >
            {common("saveFile", { format: view.format.toUpperCase() })}
          </Button>
        ) : null}
      </DialogFooter>
    </DialogContent>
  )
}
export function AssemblyExportDialog(props: ExportSelection & { compact?: boolean }) {
  const t = useTranslations("app.assembly")
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <ToolbarButton asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("exportAssembly")}
                  disabled={props.disabled || props.instances.length === 0 || !props.inspection}
                >
                  <Download aria-hidden="true" />
                </Button>
              </ToolbarButton>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("exportAssembly")}</TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={props.disabled || props.instances.length === 0 || !props.inspection}
          >
            {t("exportAssembly")}
          </Button>
        </DialogTrigger>
      )}
      {open ? <AssemblyExportContent {...props} /> : null}
    </Dialog>
  )
}
