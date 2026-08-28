import type { FeatureRecord } from "@vibeshape/domain"
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

type FeatureDeleteDialogProps = Readonly<{
  action: string
  affectedItems?: readonly Readonly<{ id: string; label: string }>[]
  affectedReferences?: string
  baseRevision: number
  cancel: string
  confirm: string
  description: string
  disabled: boolean
  failed: string
  feature: FeatureRecord
  onDeleted: () => void
  onRemove: (baseRevision: number, featureId: FeatureRecord["id"]) => Promise<FeatureMutationResult>
  remainingAffectedItems?: string | null
  title: string
}>

function useFeatureDeleteOperation(
  baseRevision: number,
  feature: FeatureRecord,
  onDeleted: () => void,
  onRemove: FeatureDeleteDialogProps["onRemove"],
) {
  const [open, setOpen] = useState(false)
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
  FeatureDeleteDialogProps,
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

function FeatureDeleteDialog({
  action,
  affectedItems = [],
  affectedReferences = "",
  baseRevision,
  cancel,
  confirm,
  description,
  disabled,
  failed: failedCopy,
  feature,
  onDeleted,
  onRemove,
  remainingAffectedItems = null,
  title,
}: FeatureDeleteDialogProps) {
  const { failed, handleOpenChange, handleRemove, open, pending } = useFeatureDeleteOperation(
    baseRevision,
    feature,
    onDeleted,
    onRemove,
  )

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" disabled={disabled}>
          {action}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AffectedReferenceList
          affectedItems={affectedItems}
          affectedReferences={affectedReferences}
          remainingAffectedItems={remainingAffectedItems}
        />
        {failed ? (
          <p className="text-sm text-destructive" role="alert">
            {failedCopy}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {cancel}
            </Button>
          </AlertDialogCancel>
          <Button type="button" variant="destructive" isLoading={pending} onClick={handleRemove}>
            {confirm}
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
        action={copy.action}
        baseRevision={baseRevision}
        cancel={copy.cancel}
        confirm={copy.confirm}
        description={copy.description}
        disabled={disabled || blocked}
        failed={copy.failed}
        feature={feature}
        onDeleted={onDeleted}
        onRemove={onRemove}
        title={copy.title}
      />
      {blocked ? <p className="text-xs text-muted-foreground">{blockedReason}</p> : null}
      {preserveIntent && onRemovePreservingIntent ? (
        <FeatureDeleteDialog
          action={preserveIntent.action}
          affectedItems={preserveIntent.affectedItems}
          affectedReferences={preserveIntent.affectedReferences}
          baseRevision={baseRevision}
          cancel={copy.cancel}
          confirm={preserveIntent.confirm}
          description={preserveIntent.description}
          disabled={disabled}
          failed={preserveIntent.failed}
          feature={feature}
          onDeleted={onDeleted}
          onRemove={onRemovePreservingIntent}
          remainingAffectedItems={preserveIntent.remainingAffectedItems}
          title={preserveIntent.title}
        />
      ) : null}
      {disabled ? <p className="text-xs text-muted-foreground">{copy.readOnly}</p> : null}
    </section>
  )
}
