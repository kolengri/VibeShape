import { documentNameInputSchema } from "@vibeshape/domain/document"
import { useTranslations } from "@vibeshape/i18n"
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
import {
  type DocumentControllerState,
  type DocumentMutationResult,
  renameActiveProject,
} from "./document-controller"

type RenameProjectCopy = Readonly<{
  cancel: string
  description: string
  fieldDescription: string
  fieldLabel: string
  invalidName: string
  readOnly: string
  save: string
  saveFailed: string
  staleRevision: string
  title: string
  unchangedName: string
}>

function projectNameIssue(value: string, currentName: string, copy: RenameProjectCopy) {
  const parsed = documentNameInputSchema.safeParse(value)
  if (!parsed.success) return copy.invalidName
  return parsed.data === currentName ? copy.unchangedName : undefined
}

function RenameProjectForm({
  baseRevision,
  copy,
  currentName,
  onPendingChange,
  onRenamed,
  onRename,
  pending,
}: {
  baseRevision: number
  copy: RenameProjectCopy
  currentName: string
  onPendingChange: (pending: boolean) => void
  onRenamed: () => void
  onRename: (baseRevision: number, name: string) => Promise<DocumentMutationResult>
  pending: boolean
}) {
  const [message, setMessage] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: { name: currentName },
    onSubmit: async ({ value }) => {
      const parsed = documentNameInputSchema.safeParse(value.name)
      if (!parsed.success || parsed.data === currentName) return

      setMessage(null)
      onPendingChange(true)
      let renamed = false
      try {
        const result = await onRename(baseRevision, parsed.data)
        if (result.ok) {
          renamed = true
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

      if (renamed) onRenamed()
    },
  })

  return (
    <Form form={form} aria-label={copy.title} className="gap-4">
      <form.AppField
        name="name"
        validators={{
          onChange: ({ value }) => projectNameIssue(value, currentName, copy),
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

export function DocumentRenameDialog({ controller }: { controller: DocumentControllerState }) {
  const t = useTranslations("app.projectRename")
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const report = controller.report
  const currentName = report?.snapshot.name ?? ""
  const writable = controller.status === "ready" && report?.mode === "read-write"
  const copy: RenameProjectCopy = {
    cancel: t("cancel"),
    description: t("description"),
    fieldDescription: t("fieldDescription"),
    fieldLabel: t("fieldLabel"),
    invalidName: t("invalidName"),
    readOnly: t("readOnly"),
    save: t("save"),
    saveFailed: t("saveFailed"),
    staleRevision: t("staleRevision"),
    title: t("title"),
    unchangedName: t("unchangedName"),
  }

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && pending) return
    setOpen(nextOpen)
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
              disabled={!writable}
              aria-label={t("trigger", { name: currentName })}
            >
              <PenLine aria-hidden="true" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{writable ? t("tooltip") : copy.readOnly}</TooltipContent>
      </Tooltip>
      {report ? (
        <DialogContent closeLabel={t("closeLabel")} showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <RenameProjectForm
            baseRevision={report.snapshot.revision}
            copy={copy}
            currentName={report.snapshot.name}
            onPendingChange={setPending}
            onRenamed={() => setOpen(false)}
            onRename={renameActiveProject}
            pending={pending}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
