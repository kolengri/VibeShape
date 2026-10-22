import { resolveAuthoredParts } from "@vibeshape/application/authored-parts"
import { useTranslations } from "@vibeshape/i18n"
import type { GeometryExportFormat, MeshExportQuality } from "@vibeshape/protocol"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { Download, PrintIcon } from "@vibeshape/ui/components/icons"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import { useId, useRef, useState } from "react"
import { useDialogOpen } from "../components/use-dialog-open"
import { PrintPreparationPanel } from "../printing/print-preparation-panel"
import { SlicerHandoffOptions } from "../printing/slicer-handoff-panel"
import { useSlicerHandoff } from "../printing/use-slicer-handoff"
import {
  useReportApplicationError,
  useReportApplicationSuccess,
} from "../shell/application-notices"
import { useViewerPreferences } from "../shell/viewer-preferences"
import type { DocumentControllerState } from "./document-controller"
import { exportActiveDocument } from "./document-controller"
import { downloadDocumentExport } from "./document-export"
import { DocumentExportOptions, type ExportDestination } from "./document-export-options"
import { MeshExportQualityField, meshExportQuality } from "./mesh-export-quality-field"

const formatCopy = {
  "3mf": {
    pending: "status.exportingThreeMf",
    succeeded: "status.exportedThreeMf",
  },
  step: {
    pending: "status.exportingStep",
    succeeded: "status.exportedStep",
  },
  stl: {
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
  closeDialog: (format: GeometryExportFormat) => void,
  partId: string | undefined,
  includesMesh = false,
  quality?: MeshExportQuality,
) {
  const [activity, setActivity] = useState<ExportActivity>(idleActivity)
  const locked = useRef(false)

  const runExport = async (format: GeometryExportFormat) => {
    if (locked.current) return
    if (format === "step" && includesMesh) {
      setActivity({
        pendingFormat: null,
        statusKey: "status.failed",
        failed: true,
        errorKey: "meshStepError",
      })
      return
    }
    locked.current = true
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
      closeDialog(format)
    } catch {
      setActivity({ pendingFormat: null, statusKey: "status.failed", failed: true })
    } finally {
      locked.current = false
    }
  }
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
  const appOwnsError = useReportApplicationError(
    hasGeometry && failed && !errorKey ? t("error") : null,
  )
  if (!hasGeometry) return <p className="text-sm text-muted-foreground">{t("noBodies")}</p>
  if (!failed || (appOwnsError && !errorKey)) return null
  return <Alert>{t(errorKey ?? "error")}</Alert>
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
        description={t("parts.description")}
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
  actionContainer,
}: {
  actionContainer: HTMLElement | null
  controller: DocumentControllerState
  available: boolean
  shown: boolean
  onShowChange: (shown: boolean) => void
  disabled: boolean
  panelDisabled: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const t = useTranslations("app.export")
  const panelId = useId()
  if (!available) return null
  return (
    <div className={cn("grid gap-3", !shown && "border-t pt-3")}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto min-h-8 justify-self-start whitespace-normal text-left"
        disabled={disabled}
        aria-expanded={shown}
        aria-controls={shown ? panelId : undefined}
        onClick={() => onShowChange(!shown)}
      >
        {shown ? <Download aria-hidden="true" /> : <PrintIcon aria-hidden="true" />}
        {t(shown ? "originalExport" : "preparePrint")}
      </Button>
      {shown ? (
        <div id={panelId}>
          <PrintPreparationPanel
            actionContainer={actionContainer}
            key={`${controller.report?.snapshot.id}:${controller.report?.snapshot.revision}`}
            disabled={panelDisabled}
            onBusyChange={onBusyChange}
          />
        </div>
      ) : null}
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

type ExportContentProps = {
  initialPartId?: string | undefined
  meshOnly?: boolean | undefined
  controller: DocumentControllerState
  preferredFormat: GeometryExportFormat
  onClose: () => void
  onSlicerOpened: (message: string) => void
  onExported: (message: string) => void
  onCloseAutoFocus?: ((event: Event) => void) | undefined
}

function useExportSession({
  controller,
  initialPartId,
  meshOnly,
  preferredFormat,
  onClose,
  onExported,
  onSlicerOpened,
}: ExportContentProps) {
  const t = useTranslations("app.export")
  const [showPreparation, setShowPreparation] = useState(false)
  const [exportPart, setExportPart] = useState(() => initialPartId ?? "all")
  const meshQualityChoice = useViewerPreferences((state) => state.exportMeshQuality)
  const setMeshQualityChoice = useViewerPreferences((state) => state.actions.setExportMeshQuality)
  const [slicerPending, setSlicerPending] = useState(false)
  const [printPending, setPrintPending] = useState(false)
  const selectedPartId = exportPart === "all" ? undefined : exportPart
  const quality = meshExportQuality(meshQualityChoice)
  const { activity, runExport } = useDocumentExportAction(
    (format) => {
      onExported(t(formatCopy[format].succeeded))
      onClose()
    },
    selectedPartId,
    exportSelectionIncludesMesh(controller, selectedPartId),
    quality,
  )
  const handoff = useSlicerHandoff({
    onBusyChange: setSlicerPending,
    onOpened: onSlicerOpened,
    prepareMesh: (format) =>
      quality
        ? exportActiveDocument(format, selectedPartId, quality)
        : exportActiveDocument(format, selectedPartId),
  })
  const hasGeometry = documentHasExportableGeometry(controller)
  const exporting = activity.pendingFormat !== null || slicerPending
  const preparationDisabled = exporting || !hasGeometry
  const pending = exporting || printPending
  const actionDisabled = preparationDisabled || printPending
  const destination = useExportDestination(preferredFormat, handoff, meshOnly)

  return {
    ...destination,
    meshOnly,
    showPreparation,
    setShowPreparation,
    exportPart,
    setExportPart,
    meshQualityChoice,
    setMeshQualityChoice,
    activity,
    runExport,
    handoff,
    hasGeometry,
    pending,
    actionDisabled,
    preparationDisabled,
    setPrintPending,
  }
}
function useExportDestination(
  preferredFormat: GeometryExportFormat,
  handoff: ReturnType<typeof useSlicerHandoff>,
  meshOnly = false,
) {
  const rememberedDestination = useViewerPreferences((state) => state.exportDestination)
  const lastExportFormat = useViewerPreferences((state) => state.lastExportFormat)
  const actions = useViewerPreferences((state) => state.actions)
  const [destination, changeDestination] = useState<ExportDestination>(() =>
    handoff.native ? rememberedDestination : "file",
  )
  const rememberedFormat = lastExportFormat ?? preferredFormat
  const fileFormat = meshOnly && rememberedFormat === "step" ? "stl" : rememberedFormat
  const setDestination = (value: ExportDestination) => {
    changeDestination(value)
    if (handoff.native) actions.setExportDestination(value)
  }
  const nativeDestination = destination === "slicer"
  const format = nativeDestination ? handoff.preference.format : fileFormat
  const changeFormat = (value: GeometryExportFormat) => {
    if (nativeDestination) {
      if (value === "step") return
      handoff.choosePreference(handoff.selected?.id ?? null, value)
    }
    actions.setPreferredExportFormat(value)
  }
  return { destination, setDestination, format, changeFormat, nativeDestination }
}
type ExportSession = ReturnType<typeof useExportSession>

function ExportDialogHeader({ controller }: { controller: DocumentControllerState }) {
  const t = useTranslations("app.export")
  const authority = controller.authoredSnapshot
  const hasTextures =
    authority &&
    "surfaceTextures" in authority &&
    authority.surfaceTextures.some(({ enabled }) => enabled)
  return (
    <DialogHeader>
      <DialogTitle>{t("title")}</DialogTitle>
      <DialogDescription>{t("description")}</DialogDescription>
      {hasTextures ? (
        <p className="text-xs text-muted-foreground">{t("textureExportHint")}</p>
      ) : null}
    </DialogHeader>
  )
}

function ExportOriginalModelFields({
  controller,
  session,
}: {
  controller: DocumentControllerState
  session: ExportSession
}) {
  const { handoff, actionDisabled, activity } = session
  return (
    <div className="grid content-start gap-3">
      {/* These selectors report operation failures separately, so empty error slots need no space. */}
      <div className="grid gap-2 [&_[data-slot=field-error]:not([role=alert])]:hidden">
        <DocumentExportOptions
          meshOnly={session.meshOnly}
          destination={session.destination}
          onDestinationChange={session.setDestination}
          format={session.format}
          onFormatChange={session.changeFormat}
          disabled={actionDisabled}
          native={handoff.native !== undefined}
        />
      </div>
      <div className="grid items-start gap-2 [&>*:only-child]:col-span-full">
        <ExportPartSelection
          controller={controller}
          value={session.exportPart}
          onChange={session.setExportPart}
          disabled={actionDisabled}
        />
        {session.format !== "step" ? (
          <MeshExportQualityField
            value={session.meshQualityChoice}
            onChange={session.setMeshQualityChoice}
            disabled={actionDisabled}
          />
        ) : null}
      </div>
      {session.nativeDestination && handoff.native ? (
        <div className="border-t pt-3">
          <SlicerHandoffOptions handoff={handoff} disabled={actionDisabled} />
        </div>
      ) : null}
      <ExportStatus messageKey={activity.failed ? null : activity.statusKey} />
      <ExportNotice
        hasGeometry={session.hasGeometry}
        failed={activity.failed}
        errorKey={activity.errorKey}
      />
    </div>
  )
}

function ExportDialogActions({
  session,
  onClose,
  actionRef,
}: {
  session: ExportSession
  onClose: () => void
  actionRef: (element: HTMLDivElement | null) => void
}) {
  const t = useTranslations("app.export")
  const { handoff, nativeDestination, format, activity } = session
  const slicerUnavailable = nativeDestination && (!handoff.native || !handoff.canSend)
  return (
    <DialogFooter ref={actionRef}>
      <Button type="button" variant="outline" disabled={session.pending} onClick={onClose}>
        {t("close")}
      </Button>
      {!session.showPreparation ? (
        <Button
          type="button"
          disabled={session.actionDisabled || slicerUnavailable}
          isLoading={activity.pendingFormat !== null || handoff.pending}
          onClick={() => (nativeDestination ? handoff.send() : session.runExport(format))}
        >
          {nativeDestination
            ? t("destination.slicer")
            : t("saveFile", { format: format.toUpperCase() })}
        </Button>
      ) : null}
    </DialogFooter>
  )
}

function ExportDialogContent(props: ExportContentProps) {
  const t = useTranslations("app.export")
  const session = useExportSession(props)
  const [actionContainer, setActionContainer] = useState<HTMLDivElement | null>(null)
  return (
    <DialogContent
      onCloseAutoFocus={props.onCloseAutoFocus}
      closeLabel={t("closeLabel")}
      showCloseButton={false}
      className={session.showPreparation ? "max-w-3xl" : "max-w-xl"}
      onEscapeKeyDown={(event) => {
        if (session.pending) event.preventDefault()
      }}
      onInteractOutside={(event) => {
        if (session.pending) event.preventDefault()
      }}
    >
      <ExportDialogHeader controller={props.controller} />
      <DialogBody data-slot="export-dialog-body" className="content-start gap-3">
        {!session.showPreparation ? (
          <ExportOriginalModelFields controller={props.controller} session={session} />
        ) : null}
        <ExportPreparation
          controller={props.controller}
          available={session.exportPart === "all"}
          shown={session.showPreparation}
          onShowChange={session.setShowPreparation}
          disabled={session.actionDisabled}
          panelDisabled={session.preparationDisabled}
          actionContainer={actionContainer}
          onBusyChange={session.setPrintPending}
        />
      </DialogBody>
      <ExportDialogActions
        session={session}
        onClose={props.onClose}
        actionRef={setActionContainer}
      />
    </DialogContent>
  )
}

export function DocumentExportDialog({
  controller,
  initialPartId,
  meshOnly,
  preferredFormat,
  showTrigger = true,
  open: controlledOpen,
  onOpenChange,
  onCloseAutoFocus,
}: {
  controller: DocumentControllerState
  initialPartId?: string | undefined
  meshOnly?: boolean | undefined
  preferredFormat?: GeometryExportFormat
  showTrigger?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: ((event: Event) => void) | undefined
}) {
  const storedPreferredFormat = useViewerPreferences((state) => state.preferredExportFormat)
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const [success, setSuccess] = useState<{ message: string; attempt: number } | null>(null)
  const appOwnsSuccess = useReportApplicationSuccess(
    success?.message ?? null,
    success?.attempt ?? 0,
  )
  const reportSuccess = (message: string) =>
    setSuccess((current) => ({ message, attempt: (current?.attempt ?? 0) + 1 }))
  return (
    <>
      {success && !appOwnsSuccess ? (
        <p
          className="fixed inset-x-4 bottom-4 z-50 rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
          role="status"
          aria-live="polite"
        >
          {success.message}
        </p>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <ExportDialogTrigger shown={showTrigger} controller={controller} />
        {open ? (
          <ExportDialogContent
            key={controller.authoredSnapshot?.id ?? controller.report?.snapshot.id}
            controller={controller}
            initialPartId={initialPartId}
            meshOnly={meshOnly}
            preferredFormat={preferredFormat ?? storedPreferredFormat}
            onClose={() => setOpen(false)}
            onSlicerOpened={(message) => {
              reportSuccess(message)
              setOpen(false)
            }}
            onExported={reportSuccess}
            onCloseAutoFocus={onCloseAutoFocus}
          />
        ) : null}
      </Dialog>
    </>
  )
}
