import { useTranslations } from "@vibeshape/i18n"
import { printerProfileSchema } from "@vibeshape/protocol"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { DialogBody, DialogFooter } from "@vibeshape/ui/components/dialog"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { cn } from "@vibeshape/ui/lib/cn"
import { type ReactNode, useState } from "react"
import { useViewerPreferences } from "../shell/viewer-preferences"

const dimensions = ["width", "depth", "height", "margin"] as const

export function PrinterSettings({ closeAction }: { closeAction?: ReactNode }) {
  const t = useTranslations("app.printer")
  const preferences = useViewerPreferences((state) => state)
  const [error, setError] = useState(false)
  const profile = preferences.printerProfile
  const form = useAppForm({
    defaultValues: {
      name: profile?.name ?? t("customName"),
      width: String(profile?.width ?? 220),
      depth: String(profile?.depth ?? 220),
      height: String(profile?.height ?? 250),
      margin: String(profile?.margin ?? 0),
    },
    onSubmit: ({ value }) => {
      const parsed = printerProfileSchema.safeParse({
        version: 1,
        name: value.name,
        ...Object.fromEntries(
          dimensions.map((key) => [key, value[key].trim() ? Number(value[key]) : Number.NaN]),
        ),
      })
      setError(!parsed.success)
      if (!parsed.success) return
      preferences.actions.setPrinterProfile(parsed.data)
      preferences.actions.setPrintBedVisible(true)
    },
  })
  const content = (
    <>
      <div className="flex items-center gap-1">
        <h3 className="font-medium">{t("title")}</h3>
        <FieldHelp label={t("title")}>{t("description")}</FieldHelp>
      </div>
      <div className="grid gap-2" onChange={() => setError(false)}>
        <form.AppField name="name">
          {(field) => <field.TextField label={t("name")} maxLength={128} />}
        </form.AppField>
        <div className="grid gap-2">
          {dimensions.map((name) => (
            <form.AppField key={name} name={name}>
              {(field) => (
                <field.TextField
                  label={t(name)}
                  type="number"
                  step="any"
                  min={name === "margin" ? 0 : 0.001}
                />
              )}
            </form.AppField>
          ))}
        </div>
      </div>
      {error ? <Alert>{t("invalid")}</Alert> : null}
      <label className={cn(fieldVariants({ orientation: "horizontal" }), "min-h-8 text-sm")}>
        <span>{t("showBed")}</span>
        <input
          type="checkbox"
          className="accent-primary"
          checked={preferences.printBedVisible}
          disabled={!profile}
          onChange={(event) => preferences.actions.setPrintBedVisible(event.currentTarget.checked)}
        />
      </label>
      <label className={cn(fieldVariants({ orientation: "horizontal" }), "min-h-8 text-sm")}>
        <span>{t("showGrid")}</span>
        <input
          type="checkbox"
          className="accent-primary"
          checked={preferences.groundGridVisible}
          onChange={(event) =>
            preferences.actions.setGroundGridVisible(event.currentTarget.checked)
          }
        />
      </label>
    </>
  )
  const removeAction = profile ? (
    <Button
      type="button"
      size={closeAction ? "default" : "sm"}
      variant="outline"
      onClick={() => {
        preferences.actions.setPrinterProfile(null)
        preferences.actions.setPrintBedVisible(false)
      }}
    >
      {t("remove")}
    </Button>
  ) : null
  const applyAction = <form.SubmitButton requireDirty={false}>{t("apply")}</form.SubmitButton>
  return (
    <Form
      form={form}
      aria-label={t("form")}
      className={closeAction ? "flex min-h-0 flex-1 flex-col overflow-hidden" : undefined}
    >
      {closeAction ? (
        <>
          <DialogBody>{content}</DialogBody>
          <DialogFooter>
            {removeAction}
            {closeAction}
            {applyAction}
          </DialogFooter>
        </>
      ) : (
        <section className="grid gap-2 border-t pt-4" aria-label={t("title")}>
          {content}
          {applyAction}
          {removeAction}
        </section>
      )}
    </Form>
  )
}
