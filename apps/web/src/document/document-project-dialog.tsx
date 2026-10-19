import { VSHAPE_MAX_ARCHIVE_BYTES, VSHAPE_MEDIA_TYPE } from "@vibeshape/formats/vshape"
import { useTranslations } from "@vibeshape/i18n"
import type { LocalProjectSummary } from "@vibeshape/persistence"
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
import { FolderOpen } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { type DropEvent, type FileRejection, useDropzone } from "react-dropzone"
import { useDialogOpen } from "../components/use-dialog-open"
import { ProjectLibrary, type ProjectLibraryState } from "../projects/project-library"
import { ProjectLibraryPageLayout } from "../projects/project-library-page-layout"
import {
  activateLocalProject,
  createNewLocalProject,
  type DocumentControllerState,
  duplicateLocalProject,
  exportActiveProjectBackup,
  getProjectActionBlock,
  importProjectBackup,
  listLocalProjects,
  showProjectLibrary,
} from "./document-controller"
import { downloadProjectBackup } from "./document-project-file"
import { formatProjectCopyName } from "./versioned-project-file"

type ProjectActivity =
  | "idle"
  | "backing-up"
  | "creating"
  | "deleting"
  | "duplicating"
  | "opening-file"
  | "switching"

type ProjectFeedback = Readonly<{
  key: string
  kind: "error" | "status"
}>

function ProjectFileCard({
  action,
  description,
  disabled,
  loading,
  onAction,
  title,
}: {
  action: string
  description: string
  disabled: boolean
  loading: boolean
  onAction: () => unknown
  title: string
}) {
  return (
    <section className="grid content-start gap-3 rounded-md border bg-card p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button type="button" disabled={disabled} isLoading={loading} onClick={onAction}>
        {action}
      </Button>
    </section>
  )
}

function ProjectFileDropzone({
  disabled,
  loading,
  onImport,
  onRejected,
}: {
  disabled: boolean
  loading: boolean
  onImport: (files: readonly File[], input?: HTMLInputElement) => void
  onRejected: (tooLarge: boolean) => void
}) {
  const t = useTranslations("app.projectFile")
  const onDrop = (acceptedFiles: File[], fileRejections: FileRejection[], event: DropEvent) => {
    if (fileRejections.length > 0) {
      onRejected(fileRejections.some(({ file }) => file.size > VSHAPE_MAX_ARCHIVE_BYTES))
      return
    }
    const input = event.target instanceof HTMLInputElement ? event.target : undefined
    onImport(acceptedFiles, input)
  }
  const { getInputProps, getRootProps, isDragActive, open } = useDropzone({
    accept: { [VSHAPE_MEDIA_TYPE]: [".vshape"] },
    disabled,
    maxFiles: 1,
    maxSize: VSHAPE_MAX_ARCHIVE_BYTES,
    multiple: false,
    noClick: true,
    onDrop,
  })

  return (
    <section
      className="grid content-start gap-3 rounded-md border bg-card p-4"
      aria-labelledby="open-project-file-title"
    >
      <div className="grid gap-1">
        <h3 id="open-project-file-title" className="text-sm font-medium">
          {t("open.title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("open.dropDescription")}</p>
      </div>
      <div
        {...getRootProps({
          className: cn(
            "grid min-h-24 place-items-center rounded-sm border border-dashed p-4 text-center text-sm transition-colors",
            isDragActive ? "border-primary bg-primary/5" : "border-border",
            disabled && "opacity-50",
          ),
          "aria-disabled": disabled,
          "aria-label": t("open.dropTitle"),
          role: "group",
        })}
      >
        <input {...getInputProps({ "aria-label": t("open.inputLabel") })} />
        <div className="grid justify-items-center gap-2">
          <p>{t("open.dropTitle")}</p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            isLoading={loading}
            onClick={open}
          >
            {t("open.action")}
          </Button>
        </div>
      </div>
    </section>
  )
}

function feedbackForImport(code: string) {
  if (code === "document-already-exists") return "errors.alreadyExists"
  if (code === "resource-limit") return "errors.tooLarge"
  if (code === "checkpoint-read-only") return "errors.checkpoint"
  if (code === "project-action-blocked") return "errors.activeWork"
  return "errors.openFailed"
}

function feedbackForFiles(files: readonly File[]) {
  if (files.length !== 1) return "open.invalidFile"
  const file = files[0]
  if (!file?.name.toLowerCase().endsWith(".vshape")) return "open.invalidFile"
  if (file.size > VSHAPE_MAX_ARCHIVE_BYTES) return "errors.tooLarge"
  return null
}

function resetProjectFileInput(input: HTMLInputElement | undefined) {
  if (input) input.value = ""
}

function ProjectFileFeedback({
  feedback,
  kind,
  compact = false,
}: {
  feedback: ProjectFeedback | null
  kind: ProjectFeedback["kind"]
  compact?: boolean
}) {
  const t = useTranslations("app.projectFile")
  if (feedback?.kind !== kind) return null
  const Element = compact ? "span" : "p"
  return (
    <Element
      className={
        kind === "error"
          ? "text-sm text-destructive"
          : compact
            ? "text-xs text-muted-foreground"
            : "text-sm text-muted-foreground"
      }
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "status" ? "polite" : undefined}
    >
      {t(feedback.key)}
    </Element>
  )
}

function ProjectGuardFeedback({ blockedReason }: { blockedReason: string | null }) {
  const t = useTranslations("app.projectFile")
  if (!blockedReason) return null
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {t(blockedReason === "save-error" ? "errors.saveError" : "errors.activeWork")}
    </p>
  )
}

function ProjectLibraryContent({
  presentation,
  feedback,
  blockedReason,
  backup,
  openFile,
  library,
}: {
  presentation: "dialog" | "page"
  feedback: ProjectFeedback | null
  blockedReason: string | null
  backup: Pick<ComponentProps<typeof ProjectFileCard>, "disabled" | "loading" | "onAction">
  openFile: ComponentProps<typeof ProjectFileDropzone>
  library: ComponentProps<typeof ProjectLibrary>
}) {
  const t = useTranslations("app.projectFile")
  return (
    <>
      <ProjectFileFeedback feedback={feedback} kind="status" />
      <ProjectGuardFeedback blockedReason={blockedReason} />
      <ProjectFileFeedback feedback={feedback} kind="error" />
      <div className={presentation === "page" ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"}>
        {presentation === "dialog" && (
          <ProjectFileCard
            {...backup}
            action={t("backup.action")}
            description={t("backup.description")}
            title={t("backup.title")}
          />
        )}
        <ProjectFileDropzone {...openFile} />
      </div>
      <ProjectLibrary {...library} />
    </>
  )
}

function ProjectLibraryFrame({
  controller,
  children,
  presentation,
  feedback,
  open,
  onOpenChange,
  showTrigger,
  onCloseAutoFocus,
  busy,
}: {
  controller: DocumentControllerState
  children: ReactNode
  presentation: "dialog" | "page"
  feedback: ProjectFeedback | null
  open: boolean
  onOpenChange: (open: boolean) => void
  showTrigger: boolean
  onCloseAutoFocus: ((event: Event) => void) | undefined
  busy: boolean
}) {
  const t = useTranslations("app.projectFile")
  if (presentation === "page") {
    return (
      <ProjectLibraryPageLayout
        controller={controller}
        title={t("title")}
        description={t("library.description")}
      >
        {children}
      </ProjectLibraryPageLayout>
    )
  }

  return (
    <>
      <ProjectFileFeedback feedback={open ? null : feedback} kind="status" compact />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <ProjectDialogTrigger shown={showTrigger} />
        <DialogContent
          className="max-h-[min(90vh,48rem)] max-w-2xl overflow-y-auto"
          closeLabel={t("closeLabel")}
          onCloseAutoFocus={onCloseAutoFocus}
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          {children}
          <div className="h-px bg-border" />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                {t("close")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function useProjectFileTarget(controller: DocumentControllerState, blockedReason: string | null) {
  const latest = useRef({ controller, blockedReason })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    latest.current = { controller, blockedReason }
  }, [controller, blockedReason])
  const target = () => {
    if (latest.current.controller.status === "library") return { kind: "library" } as const
    const snapshot = latest.current.controller.report?.snapshot
    return snapshot ? { documentId: snapshot.id, revision: snapshot.revision } : null
  }
  const stillCurrent = (expected: ReturnType<typeof target>) => {
    const current = target()
    if (!mounted.current || !expected || !current || latest.current.blockedReason) return false
    if ("kind" in expected) return "kind" in current
    if ("kind" in current || getProjectActionBlock()) return false
    return current.documentId === expected.documentId && current.revision === expected.revision
  }
  return { target, stillCurrent }
}

function projectLibraryIsAvailable(status: DocumentControllerState["status"]) {
  return status === "ready" || status === "library"
}

function useProjectLibrary(open: boolean, status: DocumentControllerState["status"]) {
  const [library, setLibrary] = useState<ProjectLibraryState>({ status: "loading", projects: [] })
  const listRequestRef = useRef(0)
  const recoveringRef = useRef(false)
  const loadProjects = useCallback(async () => {
    const request = listRequestRef.current + 1
    listRequestRef.current = request
    setLibrary((current) => ({ status: "loading", projects: current.projects }))
    const result = await listLocalProjects().catch(() => ({ ok: false as const }))
    if (listRequestRef.current !== request) return
    setLibrary(
      result.ok
        ? { status: "ready", projects: result.projects }
        : { status: "error", projects: [] },
    )
  }, [])

  const retryProjects = async () => {
    if (recoveringRef.current) return
    if (status !== "error") return loadProjects()
    recoveringRef.current = true
    const request = ++listRequestRef.current
    setLibrary({ status: "loading", projects: [] })
    const result = await showProjectLibrary().catch(() => ({ ok: false as const }))
    recoveringRef.current = false
    if (request !== listRequestRef.current) return
    if (!result.ok) {
      setLibrary({ status: "error", projects: [] })
      return
    }
    await loadProjects()
  }

  useEffect(() => {
    if (!open) return
    if (projectLibraryIsAvailable(status)) void loadProjects()
    else setLibrary({ status: status === "error" ? "error" : "loading", projects: [] })
    return () => {
      listRequestRef.current += 1
    }
  }, [open, status, loadProjects])
  return { library, loadProjects, retryProjects }
}

function ProjectDialogTrigger({ shown }: { shown: boolean }) {
  const t = useTranslations("app.projectFile")
  if (!shown) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline" aria-label={t("file")}>
            <FolderOpen aria-hidden="true" />
            <span>{t("file")}</span>
          </Button>
        </DialogTrigger>
      </TooltipTrigger>
      <TooltipContent>{t("trigger")}</TooltipContent>
    </Tooltip>
  )
}

export function DocumentProjectDialog({
  controller,
  blockedReason = null,
  showTrigger = true,
  open: controlledOpen,
  onOpenChange,
  onCloseAutoFocus,
  presentation = "dialog",
}: {
  controller: DocumentControllerState
  blockedReason?: string | null
  showTrigger?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  presentation?: "dialog" | "page"
}) {
  const t = useTranslations("app.projectFile")
  const { target, stillCurrent } = useProjectFileTarget(controller, blockedReason)
  const importInProgressRef = useRef(false)
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const [activity, setActivity] = useState<ProjectActivity>("idle")
  const [feedback, setFeedback] = useState<ProjectFeedback | null>(null)
  const { library, loadProjects, retryProjects } = useProjectLibrary(open, controller.status)
  const [switchingDocumentId, setSwitchingDocumentId] = useState<string | null>(null)
  const [duplicatingDocumentId, setDuplicatingDocumentId] = useState<string | null>(null)
  const available = projectLibraryIsAvailable(controller.status)
  const disabled = !available || blockedReason !== null || activity !== "idle"

  const importAndActivate = async (
    file: File,
    expected: NonNullable<ReturnType<typeof target>>,
  ) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!stillCurrent(expected)) {
      setFeedback({ key: "errors.activeWork", kind: "error" })
      return
    }
    const imported = await importProjectBackup(bytes, (name) => t("open.copyName", { name }))
    if (!imported.ok) {
      setFeedback({ key: feedbackForImport(imported.diagnostic.code), kind: "error" })
      return
    }
    if (!stillCurrent(expected)) {
      setFeedback({ key: "errors.activeWork", kind: "error" })
      return
    }
    setFeedback({ key: "status.switching", kind: "status" })
    const activated = await activateLocalProject(
      imported.documentId,
      "kind" in expected ? undefined : expected,
    )
    if (!activated.ok) setFeedback({ key: "errors.switchFailed", kind: "error" })
  }

  const importFiles = async (files: readonly File[], input?: HTMLInputElement) => {
    if (disabled || importInProgressRef.current) {
      resetProjectFileInput(input)
      return
    }
    const validationFeedback = feedbackForFiles(files)
    if (validationFeedback) {
      setFeedback({ key: validationFeedback, kind: "error" })
      resetProjectFileInput(input)
      return
    }
    const file = files[0]
    const expected = target()
    if (!file || !expected) return

    // State updates do not block a second event in the same render; claim the import synchronously.
    importInProgressRef.current = true
    setActivity("opening-file")
    setFeedback({ key: "status.opening", kind: "status" })
    try {
      await importAndActivate(file, expected)
    } catch {
      setFeedback({ key: "errors.openFailed", kind: "error" })
    } finally {
      resetProjectFileInput(input)
      importInProgressRef.current = false
      setActivity("idle")
    }
  }

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && activity !== "idle") return
    setOpen(nextOpen)
  }
  useEffect(() => {
    if (open) {
      setFeedback(null)
    }
  }, [open])

  const backup = async () => {
    const expected = target()
    if (!expected || "kind" in expected || !stillCurrent(expected)) return
    setActivity("backing-up")
    setFeedback({ key: "status.backingUp", kind: "status" })
    try {
      const result = await exportActiveProjectBackup()
      if (!result.ok) {
        setFeedback({
          key:
            result.diagnostic.code === "project-action-blocked"
              ? "errors.activeWork"
              : "errors.backupFailed",
          kind: "error",
        })
        return
      }
      if (!stillCurrent(expected)) {
        setFeedback({ key: "errors.activeWork", kind: "error" })
        return
      }
      downloadProjectBackup(result)
      setFeedback({ key: "status.downloaded", kind: "status" })
      setOpen(false)
    } catch {
      setFeedback({ key: "errors.backupFailed", kind: "error" })
    } finally {
      setActivity("idle")
    }
  }

  const createProject = async () => {
    setActivity("creating")
    setSwitchingDocumentId("new")
    setFeedback({ key: "status.creating", kind: "status" })
    try {
      const result = await createNewLocalProject()
      if (!result.ok) setFeedback({ key: "errors.newFailed", kind: "error" })
    } catch {
      setFeedback({ key: "errors.newFailed", kind: "error" })
    } finally {
      setSwitchingDocumentId(null)
      setActivity("idle")
    }
  }

  const openProject = async (documentId: string) => {
    setActivity("switching")
    setSwitchingDocumentId(documentId)
    setFeedback({ key: "status.switching", kind: "status" })
    try {
      const result = await activateLocalProject(documentId)
      if (!result.ok) setFeedback({ key: "errors.switchFailed", kind: "error" })
    } catch {
      setFeedback({ key: "errors.switchFailed", kind: "error" })
    } finally {
      setSwitchingDocumentId(null)
      setActivity("idle")
    }
  }

  const duplicateProject = async (project: LocalProjectSummary) => {
    setActivity("duplicating")
    setDuplicatingDocumentId(project.documentId)
    setFeedback({ key: "status.duplicating", kind: "status" })
    try {
      const copyName = formatProjectCopyName(project.name, (name) =>
        t("library.duplicate.copyName", { name }),
      )
      const result = await duplicateLocalProject(project.documentId, project.headRevision, copyName)
      if (!result.ok) {
        setFeedback({ key: "errors.duplicateFailed", kind: "error" })
        return
      }
      await loadProjects()
      setFeedback({ key: "status.duplicated", kind: "status" })
    } catch {
      setFeedback({ key: "errors.duplicateFailed", kind: "error" })
    } finally {
      setDuplicatingDocumentId(null)
      setActivity("idle")
    }
  }

  const rejectFiles = (tooLarge: boolean) => {
    if (disabled || importInProgressRef.current) return
    setFeedback({ key: tooLarge ? "errors.tooLarge" : "open.invalidFile", kind: "error" })
  }
  const changeDeletePending = (pending: boolean) => setActivity(pending ? "deleting" : "idle")

  const content = (
    <ProjectLibraryContent
      presentation={presentation}
      feedback={feedback}
      blockedReason={blockedReason}
      backup={{ disabled, loading: activity === "backing-up", onAction: backup }}
      openFile={{
        disabled: disabled || importInProgressRef.current,
        loading: activity === "opening-file",
        onImport: (files, input) => void importFiles(files, input),
        onRejected: rejectFiles,
      }}
      library={{
        activeDocumentId: controller.report?.snapshot.id,
        controller,
        disabled,
        duplicatingDocumentId,
        library,
        onCreate: createProject,
        onDeleted: loadProjects,
        onDuplicate: duplicateProject,
        onOpen: openProject,
        onPendingDeleteChange: changeDeletePending,
        onRenamed: () => void loadProjects(),
        onRetry: retryProjects,
        switchingDocumentId,
        presentation,
      }}
    />
  )
  return (
    <ProjectLibraryFrame
      controller={controller}
      presentation={presentation}
      feedback={feedback}
      open={open}
      onOpenChange={changeOpen}
      showTrigger={showTrigger}
      onCloseAutoFocus={onCloseAutoFocus}
      busy={activity !== "idle"}
    >
      {content}
    </ProjectLibraryFrame>
  )
}
