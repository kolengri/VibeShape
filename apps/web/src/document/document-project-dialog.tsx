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
import { type ChangeEvent, useRef, useState } from "react"
import {
  activateLocalProject,
  createNewLocalProject,
  type DocumentControllerState,
  deleteLocalProject,
  exportActiveProjectBackup,
  importProjectBackup,
  listLocalProjects,
} from "./document-controller"
import { downloadProjectBackup } from "./document-project-file"
import { ProjectDeleteAction } from "./project-delete-action"

type ProjectActivity =
  | "idle"
  | "backing-up"
  | "creating"
  | "deleting"
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

function feedbackForImport(code: string) {
  if (code === "document-already-exists") return "errors.alreadyExists"
  if (code === "resource-limit") return "errors.tooLarge"
  return "errors.openFailed"
}

function LocalProjectList({
  activeDocumentId,
  disabled,
  onCreate,
  onDelete,
  onDeleted,
  onOpen,
  onPendingDeleteChange,
  projects,
  switchingDocumentId,
}: {
  activeDocumentId: string | undefined
  disabled: boolean
  onCreate: () => unknown
  onDelete: (
    documentId: string,
    expectedHeadRevision: number,
  ) => ReturnType<typeof deleteLocalProject>
  onDeleted: () => void
  onOpen: (documentId: string) => unknown
  onPendingDeleteChange: (pending: boolean) => void
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
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-3"
                aria-current={isCurrent ? "page" : undefined}
              >
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
                <div className="flex flex-wrap items-center gap-2">
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

export function DocumentProjectDialog({ controller }: { controller: DocumentControllerState }) {
  const t = useTranslations("app.projectFile")
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [activity, setActivity] = useState<ProjectActivity>("idle")
  const [feedback, setFeedback] = useState<ProjectFeedback | null>(null)
  const [library, setLibrary] = useState<ProjectLibraryState>({ status: "loading", projects: [] })
  const [switchingDocumentId, setSwitchingDocumentId] = useState<string | null>(null)
  const listRequestRef = useRef(0)
  const disabled = controller.status !== "ready" || activity !== "idle"

  const loadProjects = async () => {
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
  }

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setFeedback(null)
      void loadProjects()
    }
  }

  const backup = async () => {
    setActivity("backing-up")
    setFeedback({ key: "status.backingUp", kind: "status" })
    try {
      const result = await exportActiveProjectBackup()
      if (!result.ok) {
        setFeedback({ key: "errors.backupFailed", kind: "error" })
        return
      }
      downloadProjectBackup(result)
      setFeedback({ key: "status.downloaded", kind: "status" })
      setOpen(false)
    } finally {
      setActivity("idle")
    }
  }

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setActivity("opening-file")
    setFeedback({ key: "status.opening", kind: "status" })
    try {
      if (file.size > VSHAPE_MAX_ARCHIVE_BYTES) {
        setFeedback({ key: "errors.tooLarge", kind: "error" })
        return
      }
      const imported = await importProjectBackup(new Uint8Array(await file.arrayBuffer()))
      if (!imported.ok) {
        setFeedback({ key: feedbackForImport(imported.diagnostic.code), kind: "error" })
        return
      }
      setFeedback({ key: "status.switching", kind: "status" })
      const activated = await activateLocalProject(imported.documentId)
      if (!activated.ok) setFeedback({ key: "errors.switchFailed", kind: "error" })
    } catch {
      setFeedback({ key: "errors.openFailed", kind: "error" })
    } finally {
      input.value = ""
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

  return (
    <>
      {feedback?.kind === "status" ? (
        <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {t(feedback.key)}
        </span>
      ) : null}
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            {t("trigger")}
          </Button>
        </DialogTrigger>
        <DialogContent
          className="max-h-[min(90vh,48rem)] max-w-2xl overflow-y-auto"
          closeLabel={t("closeLabel")}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          {library.status === "loading" ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("library.loading")}
            </p>
          ) : null}
          {library.status === "error" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 p-3">
              <p className="text-sm text-destructive" role="alert">
                {t("library.loadFailed")}
              </p>
              <Button type="button" size="sm" variant="outline" onClick={loadProjects}>
                {t("library.retry")}
              </Button>
            </div>
          ) : null}
          {library.status === "ready" ? (
            <LocalProjectList
              activeDocumentId={controller.report?.snapshot.id}
              disabled={disabled}
              onCreate={createProject}
              onDelete={deleteLocalProject}
              onDeleted={() => void loadProjects()}
              onOpen={openProject}
              onPendingDeleteChange={(pending) => setActivity(pending ? "deleting" : "idle")}
              projects={library.projects}
              switchingDocumentId={switchingDocumentId}
            />
          ) : null}
          <div className="h-px bg-border" />
          <div className="grid gap-3 sm:grid-cols-2">
            <ProjectFileCard
              action={t("backup.action")}
              description={t("backup.description")}
              disabled={disabled}
              loading={activity === "backing-up"}
              onAction={backup}
              title={t("backup.title")}
            />
            <ProjectFileCard
              action={t("open.action")}
              description={t("open.description")}
              disabled={disabled}
              loading={activity === "opening-file"}
              onAction={() => inputRef.current?.click()}
              title={t("open.title")}
            />
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept={`.vshape,${VSHAPE_MEDIA_TYPE}`}
              aria-label={t("open.inputLabel")}
              onChange={openFile}
            />
          </div>
          {feedback?.kind === "error" ? (
            <p className="text-sm text-destructive" role="alert">
              {t(feedback.key)}
            </p>
          ) : null}
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
