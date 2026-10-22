import { useTranslations } from "@vibeshape/i18n"
import type { LocalProjectSummary } from "@vibeshape/persistence"
import { Alert } from "@vibeshape/ui/components/alert"
import {
  AlertDialog,
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

export function ProjectDeleteAction({
  disabled,
  isCurrent,
  iconOnly = false,
  onDelete,
  onDeleted,
  onPendingChange,
  project,
}: {
  disabled: boolean
  isCurrent: boolean
  iconOnly?: boolean
  onDelete: (documentId: string, expectedHeadRevision: number) => Promise<ProjectDeleteResult>
  onDeleted: () => Promise<void>
  onPendingChange: (pending: boolean) => void
  project: LocalProjectSummary
}) {
  const t = useTranslations("app.projectFile.library.delete")
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const changeOpen = (nextOpen: boolean) => {
    if (pending) return
    setOpen(nextOpen)
    if (!nextOpen) setFailed(false)
  }

  const remove = async () => {
    setPending(true)
    setFailed(false)
    onPendingChange(true)
    try {
      const result = await onDelete(project.documentId, project.headRevision)
      if (!result.ok) {
        setFailed(true)
        return
      }
      await onDeleted()
      setOpen(false)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
      onPendingChange(false)
    }
  }

  const trigger = (
    <Button
      type="button"
      size={iconOnly ? "icon-sm" : "sm"}
      variant={iconOnly ? "ghost" : "outline"}
      className="text-destructive hover:text-destructive"
      disabled={disabled || isCurrent}
      aria-label={t("actionLabel", {
        name: project.name,
        revision: project.headRevision,
      })}
    >
      {iconOnly ? <Trash2 aria-hidden="true" /> : t("action")}
    </Button>
  )

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      {iconOnly ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent>{isCurrent ? t("currentBlocked") : t("action")}</TooltipContent>
        </Tooltip>
      ) : (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { name: project.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("description", { revision: project.headRevision })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failed ? <Alert>{t("failed")}</Alert> : null}
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
