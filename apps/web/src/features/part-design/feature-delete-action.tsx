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
  inUse: string
  readOnly: string
}>

type FeatureDeleteActionProps = Readonly<{
  baseRevision: number
  copy: FeatureDeleteCopy
  dependentFeatures: readonly FeatureRecord[]
  disabled: boolean
  feature: FeatureRecord
  onDeleted: () => void
  onRemove: (baseRevision: number, featureId: FeatureRecord["id"]) => Promise<FeatureMutationResult>
}>

export function FeatureDeleteAction({
  baseRevision,
  copy,
  dependentFeatures,
  disabled,
  feature,
  onDeleted,
  onRemove,
}: FeatureDeleteActionProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const blocked = dependentFeatures.length > 0

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return
    setOpen(nextOpen)
    if (!nextOpen) setFailed(false)
  }

  const handleRemove = async () => {
    setPending(true)
    setFailed(false)
    let result: FeatureMutationResult
    try {
      result = await onRemove(baseRevision, feature.id)
    } catch {
      setPending(false)
      setFailed(true)
      return
    }
    if (!result.ok) {
      setPending(false)
      setFailed(true)
      return
    }
    setPending(false)
    setOpen(false)
    onDeleted()
  }

  return (
    <section className="mt-4 grid gap-2 border-t pt-4" aria-label={copy.action}>
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive" disabled={disabled || blocked}>
            {copy.action}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {failed ? (
            <p className="text-sm text-destructive" role="alert">
              {copy.failed}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline" disabled={pending}>
                {copy.cancel}
              </Button>
            </AlertDialogCancel>
            <Button type="button" variant="destructive" isLoading={pending} onClick={handleRemove}>
              {copy.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {blocked ? <p className="text-xs text-muted-foreground">{copy.inUse}</p> : null}
      {disabled ? <p className="text-xs text-muted-foreground">{copy.readOnly}</p> : null}
    </section>
  )
}
