import {
  type DocumentDisplayUnits,
  defaultDocumentDisplayUnits,
  documentDisplayUnitsSchema,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
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
import { Ruler } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { type DocumentControllerState, setActiveProjectDisplayUnits } from "./document-controller"

type UnitSettingsCopy = Readonly<{
  angleDescription: string
  angleLabel: string
  cancel: string
  closeLabel: string
  description: string
  lengthDescription: string
  lengthLabel: string
  save: string
  saveFailed: string
  staleRevision: string
  title: string
}>

function UnitSettingsForm({
  baseRevision,
  copy,
  displayUnits,
  onPendingChange,
  onSaved,
  pending,
  inline = false,
}: {
  baseRevision: number
  copy: UnitSettingsCopy
  displayUnits: DocumentDisplayUnits
  onPendingChange: (pending: boolean) => void
  onSaved: () => void
  pending: boolean
  inline?: boolean
}) {
  const t = useTranslations("app.unitSettings.options")
  const [message, setMessage] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: displayUnits,
    onSubmit: async ({ value }) => {
      if (pending) return
      const parsed = documentDisplayUnitsSchema.safeParse(value)
      if (!parsed.success) return
      if (parsed.data.length === displayUnits.length && parsed.data.angle === displayUnits.angle) {
        onSaved()
        return
      }
      setMessage(null)
      onPendingChange(true)
      try {
        const result = await setActiveProjectDisplayUnits(baseRevision, parsed.data)
        if (result.ok) {
          onSaved()
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
    },
  })

  return (
    <Form form={form} aria-label={copy.title} className="gap-4">
      <form.AppField name="length">
        {(field) => (
          <field.NativeSelectField
            disabled={pending}
            label={copy.lengthLabel}
            description={copy.lengthDescription}
            required
            onValueChange={() => setMessage(null)}
          >
            <option value="um">{t("um")}</option>
            <option value="mm">{t("mm")}</option>
            <option value="cm">{t("cm")}</option>
            <option value="m">{t("m")}</option>
            <option value="in">{t("in")}</option>
            <option value="ft">{t("ft")}</option>
          </field.NativeSelectField>
        )}
      </form.AppField>
      <form.AppField name="angle">
        {(field) => (
          <field.NativeSelectField
            disabled={pending}
            label={copy.angleLabel}
            description={copy.angleDescription}
            required
            onValueChange={() => setMessage(null)}
          >
            <option value="deg">{t("deg")}</option>
            <option value="rad">{t("rad")}</option>
          </field.NativeSelectField>
        )}
      </form.AppField>
      {message ? <Alert>{message}</Alert> : null}
      <DialogFooter>
        {inline ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              form.reset()
              setMessage(null)
            }}
          >
            {copy.cancel}
          </Button>
        ) : (
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {copy.cancel}
            </Button>
          </DialogClose>
        )}
        <form.SubmitButton disabled={pending}>{copy.save}</form.SubmitButton>
      </DialogFooter>
    </Form>
  )
}

export function DocumentDisplayUnitsDialog({
  controller,
}: {
  controller: DocumentControllerState
}) {
  const t = useTranslations("app.unitSettings")
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const report = controller.report
  const displayUnits = report?.snapshot.displayUnits ?? defaultDocumentDisplayUnits
  const writable = controller.status === "ready" && report?.mode === "read-write"
  const copy = useUnitSettingsCopy()
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
              aria-label={t("trigger", displayUnits)}
            >
              <Ruler aria-hidden="true" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{writable ? t("tooltip") : t("readOnly")}</TooltipContent>
      </Tooltip>
      {report ? (
        <DialogContent closeLabel={copy.closeLabel} showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <UnitSettingsForm
            baseRevision={report.snapshot.revision}
            copy={copy}
            displayUnits={displayUnits}
            onPendingChange={setPending}
            onSaved={() => setOpen(false)}
            pending={pending}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function useUnitSettingsCopy(): UnitSettingsCopy {
  const t = useTranslations("app.unitSettings")
  return {
    angleDescription: t("angleDescription"),
    angleLabel: t("angleLabel"),
    cancel: t("cancel"),
    closeLabel: t("closeLabel"),
    description: t("description"),
    lengthDescription: t("lengthDescription"),
    lengthLabel: t("lengthLabel"),
    save: t("save"),
    saveFailed: t("saveFailed"),
    staleRevision: t("staleRevision"),
    title: t("title"),
  }
}

export function DocumentDisplayUnitsSettings({
  controller,
  blocked,
  onPendingChange,
}: {
  controller: DocumentControllerState
  blocked: boolean
  onPendingChange?: (pending: boolean) => void
}) {
  const t = useTranslations("app.unitSettings")
  const [pending, setPending] = useState(false)
  const copy = useUnitSettingsCopy()
  const settingsT = useTranslations("app.settings")
  const report = controller.report
  if (!report) return <p className="text-xs text-muted-foreground">{t("readOnly")}</p>
  const writable = controller.status === "ready" && report.mode === "read-write" && !blocked
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{copy.description}</p>
      {!writable ? (
        <p className="text-xs text-muted-foreground">
          {report.mode === "read-write" ? settingsT("projectBlocked") : t("readOnly")}
        </p>
      ) : null}
      <UnitSettingsForm
        key={report.snapshot.revision}
        baseRevision={report.snapshot.revision}
        copy={copy}
        displayUnits={report.snapshot.displayUnits}
        onPendingChange={(next) => {
          setPending(next)
          onPendingChange?.(next)
        }}
        onSaved={() => {}}
        pending={pending || !writable}
        inline
      />
    </div>
  )
}
