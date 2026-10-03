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
import { Settings as SettingsIcon } from "@vibeshape/ui/components/icons"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useState } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { DocumentDisplayUnitsSettings } from "../document/document-display-units-dialog"
import { useViewerPreferences } from "./viewer-preferences"
import { WorkspaceLayoutSettings } from "./workspace-layout-settings"

export function SettingsDialog({
  controller,
  blocked,
}: {
  controller: DocumentControllerState
  blocked: boolean
}) {
  const t = useTranslations("app.settings")
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const preferences = useViewerPreferences((state) => state)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="xs"
          variant="outline"
          aria-label={t("title")}
          title={t("title")}
          className="max-sm:size-7 max-sm:p-0"
        >
          <SettingsIcon aria-hidden="true" />
          <span className="hidden sm:inline">{t("title")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!pending}
        closeLabel={t("close")}
        className="flex max-w-xl flex-col overflow-hidden p-4"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
          <section className="grid gap-3" aria-label={t("appearance")}>
            <h3 className="font-medium">{t("appearance")}</h3>
            <SelectField
              label={t("theme.label")}
              value={preferences.theme}
              onValueChange={(theme) => {
                if (theme === "dark" || theme === "light" || theme === "system")
                  preferences.actions.setTheme(theme)
              }}
            >
              <SelectOption value="dark">{t("theme.dark")}</SelectOption>
              <SelectOption value="light">{t("theme.light")}</SelectOption>
              <SelectOption value="system">{t("theme.system")}</SelectOption>
            </SelectField>
          </section>
          <section className="grid gap-3 border-t pt-4" aria-label={t("workspace")}>
            <h3 className="font-medium">{t("workspace")}</h3>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-primary"
                checked={preferences.autoHideConsumedSketches}
                onChange={(event) =>
                  preferences.actions.setAutoHideConsumedSketches(event.currentTarget.checked)
                }
              />
              <span>{t("autoHideConsumedSketches")}</span>
            </label>
            <p className="text-xs text-muted-foreground">{t("autoHideDescription")}</p>
            <WorkspaceLayoutSettings />
          </section>
          <section className="grid gap-3 border-t pt-4" aria-label={t("project")}>
            <h3 className="font-medium">{t("project")}</h3>
            <DocumentDisplayUnitsSettings
              controller={controller}
              blocked={blocked}
              onPendingChange={setPending}
            />
          </section>
          <section className="grid gap-3 border-t pt-4" aria-label={t("export")}>
            <h3 className="font-medium">{t("export")}</h3>
            <SelectField
              label={t("exportFormat")}
              value={preferences.preferredExportFormat}
              onValueChange={(format) => {
                if (format === "3mf" || format === "step" || format === "stl")
                  preferences.actions.setPreferredExportFormat(format)
              }}
            >
              <SelectOption value="3mf">3MF</SelectOption>
              <SelectOption value="step">STEP</SelectOption>
              <SelectOption value="stl">STL</SelectOption>
            </SelectField>
            <p className="text-xs text-muted-foreground">{t("exportDescription")}</p>
          </section>
        </div>
        <DialogFooter className="shrink-0">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {t("done")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
