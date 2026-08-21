import type { SketchId, SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
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
import type { DocumentMutationResult } from "../../document/document-controller"

type SketchDeleteActionProps = Readonly<{
  baseRevision: number
  blocked: boolean
  disabled: boolean
  onDeleted: () => void
  onRemove: (baseRevision: number, sketchId: SketchId) => Promise<DocumentMutationResult>
  sketch: SketchRecord
  sketchName: string
}>

export function SketchDeleteAction({
  baseRevision,
  blocked,
  disabled,
  onDeleted,
  onRemove,
  sketch,
  sketchName,
}: SketchDeleteActionProps) {
  const t = useTranslations("app.shell.modelTree")
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const unavailable = disabled || blocked
  const triggerLabel = t("deleteSketch", { sketch: sketchName })
  const disabledLabel = blocked ? t("deleteSketchInUse") : t("deleteSketchReadOnly")

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return
    setOpen(nextOpen)
    if (!nextOpen) setFailed(false)
  }

  const handleRemove = async () => {
    setPending(true)
    setFailed(false)
    try {
      const result = await onRemove(baseRevision, sketch.id)
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
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={triggerLabel}
              disabled={unavailable}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{unavailable ? disabledLabel : triggerLabel}</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteSketchTitle", { sketch: sketchName })}</AlertDialogTitle>
          <AlertDialogDescription>{t("deleteSketchDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        {failed ? (
          <p className="text-sm text-destructive" role="alert">
            {t("deleteSketchFailed")}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {t("deleteSketchCancel")}
            </Button>
          </AlertDialogCancel>
          <Button type="button" variant="destructive" isLoading={pending} onClick={handleRemove}>
            {t("deleteSketchConfirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
