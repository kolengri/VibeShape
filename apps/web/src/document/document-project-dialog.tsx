import { VSHAPE_MAX_ARCHIVE_BYTES, VSHAPE_MEDIA_TYPE } from "@vibeshape/formats/vshape"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
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
import { useCallback, useEffect, useRef, useState } from "react"
import { type DropEvent, type FileRejection, useDropzone } from "react-dropzone"
import { useDialogOpen } from "../components/use-dialog-open"
import {
  activateLocalProject,
  createNewLocalProject,
  type DocumentControllerState,
  deleteLocalProject,
  duplicateLocalProject,
  exportActiveProjectBackup,
  getProjectActionBlock,
  importProjectBackup,
  listLocalProjects,
} from "./document-controller"
import { downloadProjectBackup } from "./document-project-file"
import { DocumentRenameDialog } from "./document-rename-dialog"
import { ProjectDeleteAction } from "./project-delete-action"
import { formatProjectCopyName } from "./versioned-project-file"

type ProjectActivity =
  | "idle"
  | "backing-up"
  | "creating"
  | "deleting"
  | "duplicating"
  | "opening-file"
  | "switching"

type ProjectLibraryState =
  | { status: "loading"; projects: readonly LocalProjectSummary[] }
  | { status: "error"; projects: readonly LocalProjectSummary[] }
  | { status: "ready"; projects: readonly LocalProjectSummary[] }

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

function thumbnailDataUrl(thumbnail: NonNullable<LocalProjectSummary["thumbnail"]>) {
  try {
    if (thumbnail.mediaType === "image/png") {
      let binary = ""
      for (let index = 0; index < thumbnail.bytes.length; index += 8_192) {
        binary += String.fromCharCode(...thumbnail.bytes.subarray(index, index + 8_192))
      }
      return `data:image/png;base64,${btoa(binary)}`
    }
    const svg = new TextDecoder("utf-8", { fatal: true }).decode(thumbnail.bytes)
    return `data:${thumbnail.mediaType};charset=utf-8,${encodeURIComponent(svg)}`
  } catch {
    return null
  }
}

function ProjectPreview({ project }: { project: LocalProjectSummary }) {
  const t = useTranslations("app.projectFile.library.preview")
  const source = project.thumbnail ? thumbnailDataUrl(project.thumbnail) : null

  return (
    <div className="row-span-2 grid h-24 w-36 shrink-0 place-items-center overflow-hidden rounded-sm border bg-viewport-background">
      {source ? (
        <img
          className="size-full object-contain"
          src={source}
          alt={t("alt", { name: project.name })}
        />
      ) : (
        <span
          className="px-4 text-center text-xs text-muted-foreground"
          role="img"
          aria-label={t("unavailableLabel", { name: project.name })}
        >
          {t("unavailable")}
        </span>
      )}
    </div>
  )
}

function LocalProjectList({
  activeDocumentId,
  controller,
  disabled,
  duplicatingDocumentId,
  onCreate,
  onDelete,
  onDeleted,
  onDuplicate,
  onOpen,
  onPendingDeleteChange,
  onRenamed,
  projects,
  switchingDocumentId,
}: {
  activeDocumentId: string | undefined
  controller: DocumentControllerState
  disabled: boolean
  duplicatingDocumentId: string | null
  onCreate: () => unknown
  onDelete: (
    documentId: string,
    expectedHeadRevision: number,
  ) => ReturnType<typeof deleteLocalProject>
  onDeleted: () => Promise<void>
  onDuplicate: (project: LocalProjectSummary) => unknown
  onOpen: (documentId: string) => unknown
  onPendingDeleteChange: (pending: boolean) => void
  onRenamed: () => void
  projects: readonly LocalProjectSummary[]
  switchingDocumentId: string | null
}) {
  const t = useTranslations("app.projectFile.library")
  const formatter = useFormatter()

  return (
    <section className="grid gap-3" aria-labelledby="local-projects-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 id="local-projects-title" className="text-sm font-medium">
            {t("title")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          isLoading={switchingDocumentId === "new"}
          onClick={onCreate}
        >
          {t("newProject")}
        </Button>
      </div>
      {projects.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="grid max-h-64 gap-2 overflow-y-auto pr-1" aria-label={t("listLabel")}>
          {projects.map((project) => {
            const isCurrent = project.documentId === activeDocumentId
            return (
              <li
                key={project.documentId}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md border bg-card p-3"
                aria-current={isCurrent ? "page" : undefined}
              >
                <ProjectPreview project={project} />
                <div className="min-w-0 grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-sm font-medium">{project.name}</h4>
                    {isCurrent ? (
                      <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                        {t("current")}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("revision", { revision: project.headRevision })}
                    {" · "}
                    {t("updated")}{" "}
                    <time dateTime={project.updatedAt}>
                      {formatter.dateTime(new Date(project.updatedAt), "shortTime")}
                    </time>
                  </p>
                  {isCurrent ? (
                    <p className="text-xs text-muted-foreground">{t("delete.currentBlocked")}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isCurrent ? (
                    <DocumentRenameDialog
                      controller={controller}
                      disabled={disabled}
                      onRenamed={onRenamed}
                    />
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled || isCurrent}
                    isLoading={switchingDocumentId === project.documentId}
                    aria-label={t("openLabel", {
                      name: project.name,
                      revision: project.headRevision,
                    })}
                    onClick={() => onOpen(project.documentId)}
                  >
                    {t("open")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    isLoading={duplicatingDocumentId === project.documentId}
                    aria-label={t("duplicate.actionLabel", {
                      name: project.name,
                      revision: project.headRevision,
                    })}
                    onClick={() => onDuplicate(project)}
                  >
                    {t("duplicate.action")}
                  </Button>
                  <ProjectDeleteAction
                    disabled={disabled}
                    isCurrent={isCurrent}
                    onDelete={onDelete}
                    onDeleted={onDeleted}
                    onPendingChange={onPendingDeleteChange}
                    project={project}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function ProjectLibrary({
  activeDocumentId,
  controller,
  disabled,
  duplicatingDocumentId,
  library,
  onCreate,
  onDeleted,
  onDuplicate,
  onOpen,
  onPendingDeleteChange,
  onRenamed,
  onRetry,
  switchingDocumentId,
}: {
  activeDocumentId: string | undefined
  controller: DocumentControllerState
  disabled: boolean
  duplicatingDocumentId: string | null
  library: ProjectLibraryState
  onCreate: () => unknown
  onDeleted: () => Promise<void>
  onDuplicate: (project: LocalProjectSummary) => unknown
  onOpen: (documentId: string) => unknown
  onPendingDeleteChange: (pending: boolean) => void
  onRenamed: () => void
  onRetry: () => unknown
  switchingDocumentId: string | null
}) {
  const t = useTranslations("app.projectFile.library")

  if (library.status === "loading") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t("loading")}
      </p>
    )
  }

  if (library.status === "error") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 p-3">
        <p className="text-sm text-destructive" role="alert">
          {t("loadFailed")}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    )
  }

  return (
    <LocalProjectList
      activeDocumentId={activeDocumentId}
      controller={controller}
      disabled={disabled}
      duplicatingDocumentId={duplicatingDocumentId}
      onCreate={onCreate}
      onDelete={deleteLocalProject}
      onDeleted={onDeleted}
      onDuplicate={onDuplicate}
      onOpen={onOpen}
      onPendingDeleteChange={onPendingDeleteChange}
      onRenamed={onRenamed}
      projects={library.projects}
      switchingDocumentId={switchingDocumentId}
    />
  )
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

function useProjectFileTarget(controller: DocumentControllerState, blockedReason: string | null) {
  const latest = useRef({ controller, blockedReason })
  useEffect(() => {
    latest.current = { controller, blockedReason }
  }, [controller, blockedReason])
  const target = () => {
    const snapshot = latest.current.controller.report?.snapshot
    return snapshot ? { documentId: snapshot.id, revision: snapshot.revision } : null
  }
  const stillCurrent = (expected: ReturnType<typeof target>) => {
    const current = target()
    return (
      expected &&
      current &&
      !latest.current.blockedReason &&
      !getProjectActionBlock() &&
      current.documentId === expected.documentId &&
      current.revision === expected.revision
    )
  }
  return { target, stillCurrent }
}

function useProjectLibrary(open: boolean) {
  const [library, setLibrary] = useState<ProjectLibraryState>({ status: "loading", projects: [] })
  const listRequestRef = useRef(0)
  const loadProjects = useCallback(async () => {
    const request = listRequestRef.current + 1
    listRequestRef.current = request
    setLibrary((current) => ({ status: "loading", projects: current.projects }))
    const result = await listLocalProjects()
    if (listRequestRef.current !== request) return
    setLibrary(
      result.ok
        ? { status: "ready", projects: result.projects }
        : { status: "error", projects: [] },
    )
  }, [])

  useEffect(() => {
    if (open) void loadProjects()
  }, [open, loadProjects])
  return { library, loadProjects }
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
}: {
  controller: DocumentControllerState
  blockedReason?: string | null
  showTrigger?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const t = useTranslations("app.projectFile")
  const { target, stillCurrent } = useProjectFileTarget(controller, blockedReason)
  const importInProgressRef = useRef(false)
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const [activity, setActivity] = useState<ProjectActivity>("idle")
  const [feedback, setFeedback] = useState<ProjectFeedback | null>(null)
  const { library, loadProjects } = useProjectLibrary(open)
  const [switchingDocumentId, setSwitchingDocumentId] = useState<string | null>(null)
  const [duplicatingDocumentId, setDuplicatingDocumentId] = useState<string | null>(null)
  const disabled = controller.status !== "ready" || blockedReason !== null || activity !== "idle"

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
    const activated = await activateLocalProject(imported.documentId, expected)
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
    if (!expected || !stillCurrent(expected)) return
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

  return (
    <>
      <ProjectFileFeedback feedback={open ? null : feedback} kind="status" compact />
      <Dialog open={open} onOpenChange={changeOpen}>
        <ProjectDialogTrigger shown={showTrigger} />
        <DialogContent
          className="max-h-[min(90vh,48rem)] max-w-2xl overflow-y-auto"
          closeLabel={t("closeLabel")}
          onCloseAutoFocus={onCloseAutoFocus}
          showCloseButton={activity === "idle"}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <ProjectFileFeedback feedback={feedback} kind="status" />
          <ProjectGuardFeedback blockedReason={blockedReason} />
          <ProjectFileFeedback feedback={feedback} kind="error" />
          <div className="grid gap-3 sm:grid-cols-2">
            <ProjectFileCard
              action={t("backup.action")}
              description={t("backup.description")}
              disabled={disabled}
              loading={activity === "backing-up"}
              onAction={backup}
              title={t("backup.title")}
            />
            <ProjectFileDropzone
              disabled={disabled || importInProgressRef.current}
              loading={activity === "opening-file"}
              onImport={(files, input) => void importFiles(files, input)}
              onRejected={(tooLarge) => {
                if (disabled || importInProgressRef.current) return
                setFeedback({
                  key: tooLarge ? "errors.tooLarge" : "open.invalidFile",
                  kind: "error",
                })
              }}
            />
          </div>
          <ProjectLibrary
            activeDocumentId={controller.report?.snapshot.id}
            controller={controller}
            disabled={disabled}
            duplicatingDocumentId={duplicatingDocumentId}
            library={library}
            onCreate={createProject}
            onDeleted={loadProjects}
            onDuplicate={duplicateProject}
            onOpen={openProject}
            onPendingDeleteChange={(pending) => setActivity(pending ? "deleting" : "idle")}
            onRenamed={() => void loadProjects()}
            onRetry={loadProjects}
            switchingDocumentId={switchingDocumentId}
          />
          <div className="h-px bg-border" />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={activity !== "idle"}>
                {t("close")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
