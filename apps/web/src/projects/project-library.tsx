import { useFormatter, useTranslations } from "@vibeshape/i18n"
import type { LocalProjectSummary } from "@vibeshape/persistence"
import { Button } from "@vibeshape/ui/components/button"
import { Copy } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
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

function ProjectPreview({ project }: { project: LocalProjectSummary }) {
  const t = useTranslations("app.projectFile.library.preview")
  const source = project.thumbnail ? thumbnailDataUrl(project.thumbnail) : null

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-sm border bg-viewport-background",
        "h-40 w-full",
      )}
    >
      {source ? (
        <img
          className="size-full object-contain"
          src={source}
          alt={t("alt", { name: project.name })}
        />
      ) : (
        <svg
          role="img"
          aria-label={t("alt", { name: project.name })}
          viewBox="0 0 240 160"
          className="size-full text-muted-foreground"
        >
          <path
            d="m20 105 100-50 100 50-100 50Z M45 92l100 50 M70 80l100 50 M95 67l100 50 M45 117l100-50 M70 130l100-50 M95 142l100-50"
            fill="none"
            stroke="currentColor"
            opacity=".12"
          />
          <path d="M120 105V45" fill="none" className="stroke-axis-z" strokeWidth="1.5" />
          <path d="m120 105 50 25" fill="none" className="stroke-axis-x" strokeWidth="1.5" />
          <path d="m120 105-50 25" fill="none" className="stroke-axis-y" strokeWidth="1.5" />
          <circle cx="120" cy="105" r="2" fill="currentColor" />
        </svg>
      )}
    </span>
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
      className="flex min-w-0 flex-col gap-3 rounded-md border bg-card p-3"
      aria-current={isCurrent ? "page" : undefined}
    >
      <Button
        type="button"
        variant="ghost"
        disabled={disabled || isCurrent}
        isLoading={switchingDocumentId === project.documentId}
        aria-label={t("openLabel", { name: project.name, revision: project.headRevision })}
        onClick={() => onOpen(project.documentId)}
        className={cn(
          "h-auto w-full justify-start gap-3 whitespace-normal p-0 text-left disabled:opacity-100",
          "flex min-w-0 flex-col items-stretch",
        )}
      >
        <ProjectPreview project={project} />
        <span className="grid min-w-0 gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{project.name}</span>
            {currentBadge}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("revision", { revision: project.headRevision })}
            {" · "}
            {t("updated")}{" "}
            <time dateTime={project.updatedAt}>
              {formatter.dateTime(new Date(project.updatedAt), "shortTime")}
            </time>
          </span>
          {isCurrent ? (
            <span className="text-xs text-muted-foreground">{t("delete.currentBlocked")}</span>
          ) : null}
        </span>
      </Button>
      <ProjectCardActions
        project={project}
        isCurrent={isCurrent}
        controller={controller}
        disabled={disabled}
        duplicatingDocumentId={duplicatingDocumentId}
        onDelete={onDelete}
        onDeleted={onDeleted}
        onDuplicate={onDuplicate}
        onPendingDeleteChange={onPendingDeleteChange}
        onRenamed={onRenamed}
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
  onPendingDeleteChange,
  onRenamed,
}: Pick<
  LocalProjectListProps,
  | "controller"
  | "disabled"
  | "duplicatingDocumentId"
  | "onDelete"
  | "onDeleted"
  | "onDuplicate"
  | "onPendingDeleteChange"
  | "onRenamed"
> & {
  project: LocalProjectSummary
  isCurrent: boolean
}) {
  const t = useTranslations("app.projectFile.library")
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isCurrent ? (
        <DocumentRenameDialog controller={controller} disabled={disabled} onRenamed={onRenamed} />
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            isLoading={duplicatingDocumentId === project.documentId}
            aria-label={t("duplicate.actionLabel", {
              name: project.name,
              revision: project.headRevision,
            })}
            onClick={() => onDuplicate(project)}
          >
            <Copy aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("duplicate.action")}</TooltipContent>
      </Tooltip>
      <ProjectDeleteAction
        iconOnly
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
}: LocalProjectListProps) {
  const t = useTranslations("app.projectFile.library")
  const headingId = useId()

  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id={headingId} className="text-sm font-medium">
            {t("title")}
          </h2>
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
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={t("listLabel")}>
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
