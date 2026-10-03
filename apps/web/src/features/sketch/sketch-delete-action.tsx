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
} from "@vibeshape/ui/components/alert-dialog"
import { Button } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import { Ellipsis, Trash2 } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { useId, useRef, useState } from "react"
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const disabledDescriptionId = useId()
  const unavailable = disabled || blocked
  const triggerLabel = t("sketchActions", { sketch: sketchName })
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
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={triggerRef}
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={triggerLabel}
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{triggerLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (open) event.preventDefault()
          }}
        >
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={unavailable}
            aria-describedby={unavailable ? disabledDescriptionId : undefined}
            onSelect={() => handleOpenChange(true)}
          >
            <Trash2 aria-hidden="true" />
            {t("deleteSketch", { sketch: sketchName })}
          </DropdownMenuItem>
          {unavailable ? (
            <p
              id={disabledDescriptionId}
              className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground"
            >
              {disabledLabel}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
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
