import { useTranslations } from "@vibeshape/i18n"
import type { LocalProjectSummary } from "@vibeshape/persistence"
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
import { useState } from "react"
import type { ProjectDeleteResult } from "./document-controller"

export function ProjectDeleteAction({
  disabled,
  isCurrent,
  onDelete,
  onDeleted,
  onPendingChange,
  project,
}: {
  disabled: boolean
  isCurrent: boolean
  onDelete: (documentId: string, expectedHeadRevision: number) => Promise<ProjectDeleteResult>
  onDeleted: () => void
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
      setOpen(false)
      onDeleted()
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
      onPendingChange(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={disabled || isCurrent}
          aria-label={t("actionLabel", {
            name: project.name,
            revision: project.headRevision,
          })}
          title={isCurrent ? t("currentBlocked") : undefined}
        >
          {t("action")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { name: project.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("description", { revision: project.headRevision })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failed ? (
          <p className="text-sm text-destructive" role="alert">
            {t("failed")}
          </p>
        ) : null}
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
