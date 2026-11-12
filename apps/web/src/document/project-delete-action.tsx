import { useTranslations } from "@vibeshape/i18n"
import type { LocalProjectSummary } from "@vibeshape/persistence"
import { Alert } from "@vibeshape/ui/components/alert"
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@vibeshape/ui/components/alert-dialog"
import { Button } from "@vibeshape/ui/components/button"
import { Trash2 } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { useState } from "react"
import type { ProjectDeleteResult } from "./document-controller"

/** Why Delete is unavailable: the visible project, or one whose session this window retains. */
export type ProjectDeleteBlock = "current" | "open" | null

const blockedTooltipKeys = {
  current: "currentBlocked",
  open: "openBlocked",
} as const

/** A session retained by this window is not "another tab"; name the actual owner. */
function deleteFailure(result: ProjectDeleteResult) {
  return !result.ok && result.diagnostic.code === "project-open" ? "openBlocked" : "failed"
}

function ProjectDeleteTrigger({
  blocked,
  blockedDescriptionId,
  disabled,
  iconOnly,
  project,
}: {
  blocked: ProjectDeleteBlock
  blockedDescriptionId: string | undefined
  disabled: boolean
  iconOnly: boolean
  project: LocalProjectSummary
}) {
  const t = useTranslations("app.projectFile.library.delete")
  const trigger = (
    <AlertDialogTrigger asChild>
      <Button
        type="button"
        size={iconOnly ? "icon-sm" : "sm"}
        variant={iconOnly ? "ghost" : "outline"}
        className="text-destructive hover:text-destructive"
        disabled={disabled || blocked !== null}
        aria-describedby={blocked === null ? undefined : blockedDescriptionId}
        aria-label={t("actionLabel", { name: project.name, revision: project.headRevision })}
      >
        {iconOnly ? <Trash2 aria-hidden="true" /> : t("action")}
      </Button>
    </AlertDialogTrigger>
  )
  if (!iconOnly) return trigger
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent>{t(blocked ? blockedTooltipKeys[blocked] : "action")}</TooltipContent>
    </Tooltip>
  )
}

export function ProjectDeleteAction({
  blocked,
  blockedDescriptionId,
  disabled,
  iconOnly = false,
  onDelete,
  onDeleted,
  onPendingChange,
  project,
}: {
  blocked: ProjectDeleteBlock
  blockedDescriptionId?: string
  disabled: boolean
  iconOnly?: boolean
  onDelete: (documentId: string, expectedHeadRevision: number) => Promise<ProjectDeleteResult>
  onDeleted: () => Promise<void>
  onPendingChange: (pending: boolean) => void
  project: LocalProjectSummary
}) {
  const t = useTranslations("app.projectFile.library.delete")
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<"failed" | "openBlocked" | null>(null)

  const changeOpen = (nextOpen: boolean) => {
    if (pending) return
    setOpen(nextOpen)
    if (!nextOpen) setFailure(null)
  }

  const remove = async () => {
    setPending(true)
    setFailure(null)
    onPendingChange(true)
    try {
      const result = await onDelete(project.documentId, project.headRevision)
      if (!result.ok) {
        setFailure(deleteFailure(result))
        return
      }
      await onDeleted()
      setOpen(false)
    } catch {
      setFailure("failed")
    } finally {
      setPending(false)
      onPendingChange(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <ProjectDeleteTrigger
        blocked={blocked}
        blockedDescriptionId={blockedDescriptionId}
        disabled={disabled}
        iconOnly={iconOnly}
        project={project}
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { name: project.name })}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription>
            {t("description", { revision: project.headRevision })}
          </AlertDialogDescription>
          {failure ? <Alert>{t(failure)}</Alert> : null}
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {t("cancel")}
            </Button>
          </AlertDialogCancel>
          <Button type="button" variant="destructive" isLoading={pending} onClick={remove}>
            {t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
