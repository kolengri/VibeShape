import { useFormatter, useTranslations } from "@vibeshape/i18n"
import type { LocalProjectSummary } from "@vibeshape/persistence"
import { Button } from "@vibeshape/ui/components/button"
import { cn } from "@vibeshape/ui/lib/cn"
import { useId } from "react"
import { type DocumentControllerState, deleteLocalProject } from "../document/document-controller"
import { DocumentRenameDialog } from "../document/document-rename-dialog"
import { ProjectDeleteAction } from "../document/project-delete-action"

export type ProjectLibraryState =
  | { status: "loading"; projects: readonly LocalProjectSummary[] }
  | { status: "error"; projects: readonly LocalProjectSummary[] }
  | { status: "ready"; projects: readonly LocalProjectSummary[] }

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

function ProjectPreview({
  project,
  presentation,
}: {
  project: LocalProjectSummary
  presentation: "dialog" | "page"
}) {
  const t = useTranslations("app.projectFile.library.preview")
  const source = project.thumbnail ? thumbnailDataUrl(project.thumbnail) : null

  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-sm border bg-viewport-background",
        presentation === "page" ? "h-40 w-full" : "row-span-2 h-24 w-36",
      )}
    >
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

type LocalProjectListProps = {
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
  presentation?: "dialog" | "page"
}

const projectCardLayout = {
  page: "flex min-w-0 flex-col",
  dialog: "grid grid-cols-[auto_minmax(0,1fr)] items-center",
}
const projectHeadingTag = { page: "h2", dialog: "h3" } as const

const projectGridLayout = {
  page: "gap-4 md:grid-cols-2 xl:grid-cols-3",
  dialog: "max-h-64 gap-2 overflow-y-auto pr-1",
}

function LocalProjectCard({
  project,
  activeDocumentId,
  controller,
  disabled,
  duplicatingDocumentId,
  onDelete,
  onDeleted,
  onDuplicate,
  onOpen,
  onPendingDeleteChange,
  onRenamed,
  presentation = "dialog",
  switchingDocumentId,
}: Omit<LocalProjectListProps, "projects" | "onCreate"> & { project: LocalProjectSummary }) {
  const t = useTranslations("app.projectFile.library")
  const formatter = useFormatter()
  const isCurrent = project.documentId === activeDocumentId
  const currentBadge = isCurrent ? (
    <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
      {t("current")}
    </span>
  ) : null
  return (
    <li
      className={cn("gap-3 rounded-md border bg-card p-3", projectCardLayout[presentation])}
      aria-current={isCurrent ? "page" : undefined}
    >
      <ProjectPreview project={project} presentation={presentation} />
      <div className="min-w-0 grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="truncate text-sm font-medium">{project.name}</h4>
          {currentBadge}
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
      <ProjectCardActions
        project={project}
        isCurrent={isCurrent}
        controller={controller}
        disabled={disabled}
        duplicatingDocumentId={duplicatingDocumentId}
        onDelete={onDelete}
        onDeleted={onDeleted}
        onDuplicate={onDuplicate}
        onOpen={onOpen}
        onPendingDeleteChange={onPendingDeleteChange}
        onRenamed={onRenamed}
        switchingDocumentId={switchingDocumentId}
      />
    </li>
  )
}

function ProjectCardActions({
  project,
  isCurrent,
  controller,
  disabled,
  duplicatingDocumentId,
  onDelete,
  onDeleted,
  onDuplicate,
  onOpen,
  onPendingDeleteChange,
  onRenamed,
  switchingDocumentId,
}: Omit<LocalProjectListProps, "projects" | "onCreate" | "activeDocumentId" | "presentation"> & {
  project: LocalProjectSummary
  isCurrent: boolean
}) {
  const t = useTranslations("app.projectFile.library")
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isCurrent ? (
        <DocumentRenameDialog controller={controller} disabled={disabled} onRenamed={onRenamed} />
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
  presentation = "dialog",
}: LocalProjectListProps) {
  const t = useTranslations("app.projectFile.library")
  const headingId = useId()
  const Heading = projectHeadingTag[presentation]

  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <Heading id={headingId} className="text-sm font-medium">
            {t("title")}
          </Heading>
          <p hidden={presentation === "page"} className="text-xs text-muted-foreground">
            {t("description")}
          </p>
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
        <ul className={cn("grid", projectGridLayout[presentation])} aria-label={t("listLabel")}>
          {projects.map((project) => (
            <LocalProjectCard
              key={project.documentId}
              project={project}
              activeDocumentId={activeDocumentId}
              controller={controller}
              disabled={disabled}
              duplicatingDocumentId={duplicatingDocumentId}
              onDelete={onDelete}
              onDeleted={onDeleted}
              onDuplicate={onDuplicate}
              onOpen={onOpen}
              onPendingDeleteChange={onPendingDeleteChange}
              onRenamed={onRenamed}
              presentation={presentation}
              switchingDocumentId={switchingDocumentId}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

export function ProjectLibrary({
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
  presentation = "dialog",
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
  presentation?: "dialog" | "page"
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
      presentation={presentation}
    />
  )
}
