import type { FeatureRecord } from "@vibeshape/domain"
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
import type { ComponentProps } from "react"
import { useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"

type FeatureDeleteCopy = Readonly<{
  action: string
  title: string
  description: string
  confirm: string
  cancel: string
  failed: string
  readOnly: string
}>

type FeaturePreserveIntentCopy = Readonly<{
  action: string
  title: string
  description: string
  confirm: string
  affectedReferences: string
  affectedItems: readonly Readonly<{ id: string; label: string }>[]
  remainingAffectedItems: string | null
  failed: string
}>

type FeatureDeleteActionProps = Readonly<{
  baseRevision: number
  copy: FeatureDeleteCopy
  blockedReason: string | null
  disabled: boolean
  feature: FeatureRecord
  onDeleted: () => void
  onRemove: (baseRevision: number, featureId: FeatureRecord["id"]) => Promise<FeatureMutationResult>
  onRemovePreservingIntent?: (
    baseRevision: number,
    featureId: FeatureRecord["id"],
  ) => Promise<FeatureMutationResult>
  preserveIntent?: FeaturePreserveIntentCopy
}>

type FeatureDeleteDialogCopy = FeatureDeleteCopy &
  Partial<
    Pick<
      FeaturePreserveIntentCopy,
      "affectedItems" | "affectedReferences" | "remainingAffectedItems"
    >
  >

type FeatureDeleteDialogProps = Readonly<{
  copy: Omit<FeatureDeleteDialogCopy, "readOnly">
  baseRevision: number
  disabled: boolean
  feature: FeatureRecord
  onDeleted: () => void
  onRemove: (baseRevision: number, featureId: FeatureRecord["id"]) => Promise<FeatureMutationResult>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: ComponentProps<typeof AlertDialogContent>["onCloseAutoFocus"]
  showTrigger?: boolean
}>

function useFeatureDeleteOperation(
  baseRevision: number,
  feature: FeatureRecord,
  onDeleted: () => void,
  onRemove: FeatureDeleteDialogProps["onRemove"],
  controlledOpen?: boolean,
  onOpenChange?: (open: boolean) => void,
) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (nextOpen: boolean) => {
    setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return
    setOpen(nextOpen)
    if (!nextOpen) setFailed(false)
  }
  const handleRemove = async () => {
    setPending(true)
    setFailed(false)
    try {
      const result = await onRemove(baseRevision, feature.id)
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
  return { failed, handleOpenChange, handleRemove, open, pending }
}

function AffectedReferenceList({
  affectedItems,
  affectedReferences,
  remainingAffectedItems,
}: Pick<
  FeatureDeleteDialogCopy,
  "affectedItems" | "affectedReferences" | "remainingAffectedItems"
>) {
  if (!affectedItems || affectedItems.length === 0) return null
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-medium">{affectedReferences}</p>
      <ul className="grid gap-1 text-sm text-muted-foreground">
        {affectedItems.map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
      </ul>
      {remainingAffectedItems ? (
        <p className="text-xs text-muted-foreground">{remainingAffectedItems}</p>
      ) : null}
    </div>
  )
}

export function FeatureDeleteDialog({
  copy,
  baseRevision,
  disabled,
  feature,
  onDeleted,
  onRemove,
  open: controlledOpen,
  onOpenChange,
  onCloseAutoFocus,
  showTrigger = true,
}: FeatureDeleteDialogProps) {
  const { failed, handleOpenChange, handleRemove, open, pending } = useFeatureDeleteOperation(
    baseRevision,
    feature,
    onDeleted,
    onRemove,
    controlledOpen,
    onOpenChange,
  )

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {showTrigger ? (
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive" disabled={disabled}>
            {copy.action}
          </Button>
        </AlertDialogTrigger>
      ) : null}
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AffectedReferenceList {...copy} />
        {failed ? <Alert>{copy.failed}</Alert> : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {copy.cancel}
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={disabled}
            isLoading={pending}
            onClick={handleRemove}
          >
            {copy.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function FeatureDeleteAction({
  baseRevision,
  copy,
  blockedReason,
  disabled,
  feature,
  onDeleted,
  onRemove,
  onRemovePreservingIntent,
  preserveIntent,
}: FeatureDeleteActionProps) {
  const blocked = blockedReason !== null
  return (
    <section className="mt-4 grid gap-2 border-t pt-4" aria-label={copy.action}>
      <FeatureDeleteDialog
        copy={copy}
        baseRevision={baseRevision}
        disabled={disabled || blocked}
        feature={feature}
        onDeleted={onDeleted}
        onRemove={onRemove}
      />
      {blocked ? <p className="text-xs text-muted-foreground">{blockedReason}</p> : null}
      {preserveIntent && onRemovePreservingIntent ? (
        <FeatureDeleteDialog
          copy={{ ...preserveIntent, cancel: copy.cancel }}
          baseRevision={baseRevision}
          disabled={disabled}
          feature={feature}
          onDeleted={onDeleted}
          onRemove={onRemovePreservingIntent}
        />
      ) : null}
      {disabled ? <p className="text-xs text-muted-foreground">{copy.readOnly}</p> : null}
    </section>
  )
}
