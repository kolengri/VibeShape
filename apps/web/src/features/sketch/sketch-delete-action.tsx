import type { SketchId, SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
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
} from "@vibeshape/ui/components/alert-dialog"
import { Button } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import { Ellipsis, PenLine, Trash2 } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { type RefObject, useId, useRef, useState } from "react"
import type { DocumentMutationResult } from "../../document/document-controller"

type SketchRenameAction = Readonly<{
  onSelect: () => void
  disabled: boolean
  open: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
}>

type SketchDeleteActionProps = Readonly<{
  baseRevision: number
  blocked: boolean
  disabled: boolean
  onDeleted: () => void
  onRemove: (baseRevision: number, sketchId: SketchId) => Promise<DocumentMutationResult>
  sketch: SketchRecord
  sketchName: string
  renameAction?: SketchRenameAction
  dependenciesAction?: { onSelect: () => void; open: boolean }
}>

function SketchActionsMenu(props: {
  triggerRef: RefObject<HTMLButtonElement | null>
  renameAction: SketchRenameAction | undefined
  dependenciesAction: SketchDeleteActionProps["dependenciesAction"]
  onDelete: () => void
  open: boolean
  unavailable: boolean
  disabledLabel: string
  sketchName: string
  t: ReturnType<typeof useTranslations>
}) {
  const disabledDescriptionId = useId()
  const t = props.t
  const triggerLabel = t("sketchActions", { sketch: props.sketchName })
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={props.triggerRef}
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={triggerLabel}
              dropdown
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
          if (props.open || props.renameAction?.open || props.dependenciesAction?.open)
            event.preventDefault()
        }}
      >
        {props.dependenciesAction && (
          <DropdownMenuItem onSelect={props.dependenciesAction.onSelect}>
            {t("dependencies.action")}
          </DropdownMenuItem>
        )}
        {props.renameAction ? (
          <DropdownMenuItem
            disabled={props.renameAction?.disabled}
            onSelect={props.renameAction?.onSelect}
          >
            <PenLine aria-hidden="true" />
            {t("renameHistoryItem", { item: props.sketchName })}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          disabled={props.unavailable}
          aria-describedby={props.unavailable ? disabledDescriptionId : undefined}
          onSelect={props.onDelete}
        >
          <Trash2 aria-hidden="true" />
          {t("deleteSketch", { sketch: props.sketchName })}
        </DropdownMenuItem>
        {props.unavailable ? (
          <p
            id={disabledDescriptionId}
            className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground"
          >
            {props.disabledLabel}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SketchDeleteAction({
  baseRevision,
  blocked,
  disabled,
  onDeleted,
  onRemove,
  sketch,
  sketchName,
  renameAction,
  dependenciesAction,
}: SketchDeleteActionProps) {
  const t = useTranslations("app.shell.modelTree")
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const ownTriggerRef = useRef<HTMLButtonElement>(null)
  const triggerRef = renameAction?.triggerRef ?? ownTriggerRef
  const unavailable = disabled || blocked
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
      <SketchActionsMenu
        triggerRef={triggerRef}
        renameAction={renameAction}
        dependenciesAction={dependenciesAction}
        onDelete={() => handleOpenChange(true)}
        open={open}
        unavailable={unavailable}
        disabledLabel={disabledLabel}
        sketchName={sketchName}
        t={t}
      />
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteSketchTitle", { sketch: sketchName })}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription>{t("deleteSketchDescription")}</AlertDialogDescription>
          {failed ? <Alert>{t("deleteSketchFailed")}</Alert> : null}
        </AlertDialogBody>
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
