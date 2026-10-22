import { useTranslations } from "@vibeshape/i18n"
import { printerProfileSchema } from "@vibeshape/protocol"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { useViewerPreferences } from "../shell/viewer-preferences"

const dimensions = ["width", "depth", "height", "margin"] as const

export function PrinterSettings() {
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
  return (
    <section className="grid gap-3 border-t pt-4" aria-label={t("title")}>
      <h3 className="font-medium">{t("title")}</h3>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <Form form={form} aria-label={t("form")} onChange={() => setError(false)}>
        <form.AppField name="name">
          {(field) => <field.TextField label={t("name")} maxLength={128} />}
        </form.AppField>
        <div className="grid gap-3 sm:grid-cols-2">
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
        {error ? <Alert>{t("invalid")}</Alert> : null}
        <form.SubmitButton requireDirty={false}>{t("apply")}</form.SubmitButton>
      </Form>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary"
          checked={preferences.printBedVisible}
          disabled={!profile}
          onChange={(event) => preferences.actions.setPrintBedVisible(event.currentTarget.checked)}
        />
        {t("showBed")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary"
          checked={preferences.groundGridVisible}
          onChange={(event) =>
            preferences.actions.setGroundGridVisible(event.currentTarget.checked)
          }
        />
        {t("showGrid")}
      </label>
      {profile ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            preferences.actions.setPrinterProfile(null)
            preferences.actions.setPrintBedVisible(false)
          }}
        >
          {t("remove")}
        </Button>
      ) : null}
    </section>
  )
}
