import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { PenLine } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import type { z } from "zod"

export type SemanticRenameResult =
  | { ok: true }
  | { ok: false; diagnostic: Readonly<{ sourceCode: string | null }> }

export type SemanticRenameDialogCopy = Readonly<{
  cancel: string
  closeLabel: string
  description: string
  fieldDescription: string
  fieldLabel: string
  invalidName: string
  save: string
  saveFailed: string
  staleRevision: string
  title: string
  unchangedName: string
}>

function semanticNameIssue(
  value: string,
  currentName: string,
  nameSchema: z.ZodType<string>,
  copy: SemanticRenameDialogCopy,
) {
  const parsed = nameSchema.safeParse(value)
  if (!parsed.success) return copy.invalidName
  return parsed.data === currentName ? copy.unchangedName : undefined
}

function SemanticRenameForm({
  copy,
  currentName,
  nameSchema,
  onPendingChange,
  onRename,
  onRenamed,
  pending,
}: {
  copy: SemanticRenameDialogCopy
  currentName: string
  nameSchema: z.ZodType<string>
  onPendingChange: (pending: boolean) => void
  onRename: (name: string) => Promise<SemanticRenameResult>
  onRenamed: (name: string) => void
  pending: boolean
}) {
  const [message, setMessage] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: { name: currentName },
    onSubmit: async ({ value }) => {
      const parsed = nameSchema.safeParse(value.name)
      if (!parsed.success || parsed.data === currentName) return

      setMessage(null)
      onPendingChange(true)
      let renamedName: string | null = null
      try {
        const result = await onRename(parsed.data)
        if (result.ok) {
          renamedName = parsed.data
        } else {
          setMessage(
            result.diagnostic.sourceCode === "stale-revision"
              ? copy.staleRevision
              : copy.saveFailed,
          )
        }
      } catch {
        setMessage(copy.saveFailed)
      } finally {
        onPendingChange(false)
      }

      if (renamedName) onRenamed(renamedName)
    },
  })

  return (
    <Form form={form} aria-label={copy.title} className="gap-4">
      <form.AppField
        name="name"
        validators={{
          onChange: ({ value }) => semanticNameIssue(value, currentName, nameSchema, copy),
        }}
      >
        {(field) => (
          <field.TextField
            autoFocus
            required
            autoComplete="off"
            disabled={pending}
            label={copy.fieldLabel}
            description={copy.fieldDescription}
          />
        )}
      </form.AppField>
      {message ? (
        <p className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {copy.cancel}
          </Button>
        </DialogClose>
        <form.SubmitButton>{copy.save}</form.SubmitButton>
      </DialogFooter>
    </Form>
  )
}

export function SemanticRenameDialog({
  copy,
  currentName,
  disabled = false,
  disabledTooltip,
  nameSchema,
  onOpenChange,
  onRename,
  onRenamed,
  open,
  triggerLabel,
  triggerTooltip,
}: {
  copy: SemanticRenameDialogCopy
  currentName: string
  disabled?: boolean
  disabledTooltip?: string
  nameSchema: z.ZodType<string>
  onOpenChange: (open: boolean) => void
  onRename: (name: string) => Promise<SemanticRenameResult>
  onRenamed?: (name: string) => void
  open: boolean
  triggerLabel: string
  triggerTooltip: string
}) {
  const [pending, setPending] = useState(false)
  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && pending) return
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled}
              aria-label={triggerLabel}
            >
              <PenLine aria-hidden="true" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{disabled ? disabledTooltip : triggerTooltip}</TooltipContent>
      </Tooltip>
      <DialogContent closeLabel={copy.closeLabel} showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <SemanticRenameForm
          copy={copy}
          currentName={currentName}
          nameSchema={nameSchema}
          onPendingChange={setPending}
          onRename={onRename}
          onRenamed={(name) => {
            onOpenChange(false)
            onRenamed?.(name)
          }}
          pending={pending}
        />
      </DialogContent>
    </Dialog>
  )
}
