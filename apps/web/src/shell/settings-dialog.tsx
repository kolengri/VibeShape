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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@vibeshape/ui/components/tabs"
import { useState } from "react"
import { type DialogOpenProps, useDialogOpen } from "../components/use-dialog-open"
import { DesktopMcpSettings } from "../desktop/desktop-mcp-settings"
import type { DocumentControllerState } from "../document/document-controller"
import { DocumentDisplayUnitsSettings } from "../document/document-display-units-dialog"
import { PrinterSettings } from "../printing/printer-settings"
import { useViewerPreferences } from "./viewer-preferences"
import { WorkspaceLayoutSettings } from "./workspace-layout-settings"

export function SettingsDialog({
  controller,
  blocked,
  showTrigger = true,
  open: controlledOpen,
  onOpenChange,
  onCloseAutoFocus,
}: DialogOpenProps & {
  controller: DocumentControllerState
  blocked: boolean
}) {
  const t = useTranslations("app.settings")
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const [pending, setPending] = useState(false)
  const [category, setCategory] = useState("appearance")
  const printerT = useTranslations("app.printer")
  const categories = [
    { value: "appearance", label: t("appearance") },
    { value: "workspace", label: t("workspace") },
    { value: "printer", label: printerT("title") },
    { value: "project", label: t("project") },
    { value: "export", label: t("export") },
    { value: "connections", label: t("connections") },
    { value: "about", label: t("about.title") },
  ]
  const preferences = useViewerPreferences((state) => state)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next)
      }}
    >
      {showTrigger ? (
        <DialogTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label={t("title")}
            title={t("title")}
          >
            <SettingsIcon aria-hidden="true" />
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        showCloseButton={!pending}
        closeLabel={t("close")}
        className="flex max-w-3xl flex-col overflow-hidden p-4"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Tabs
          value={category}
          onValueChange={(next) => {
            if (!pending) setCategory(next)
          }}
          className="flex min-h-0 flex-col gap-4"
        >
          <TabsList aria-label={t("title")} className="shrink-0">
            {categories.map(({ value, label }) => (
              <TabsTrigger key={value} value={value} disabled={pending}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="min-h-0 overflow-y-auto pr-1">
            <TabsContent
              forceMount
              value="appearance"
              hidden={category !== "appearance"}
              className="grid gap-3"
            >
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
            </TabsContent>
            <TabsContent
              forceMount
              value="workspace"
              hidden={category !== "workspace"}
              className="grid gap-3"
            >
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
            </TabsContent>
            <TabsContent forceMount value="printer" hidden={category !== "printer"}>
              <PrinterSettings />
            </TabsContent>
            <TabsContent
              forceMount
              value="project"
              hidden={category !== "project"}
              className="grid gap-3"
            >
              <h3 className="font-medium">{t("project")}</h3>
              <DocumentDisplayUnitsSettings
                controller={controller}
                blocked={blocked}
                onPendingChange={setPending}
              />
            </TabsContent>
            <TabsContent
              forceMount
              value="export"
              hidden={category !== "export"}
              className="grid gap-3"
            >
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
            </TabsContent>
            <TabsContent
              forceMount
              value="connections"
              hidden={category !== "connections"}
              className="grid gap-3"
            >
              <DesktopMcpSettings />
            </TabsContent>
            <TabsContent
              forceMount
              value="about"
              hidden={category !== "about"}
              className="grid gap-3"
            >
              <h3 className="font-medium">{t("about.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("about.licenses")}</p>
              <Button variant="link" className="w-fit px-0" asChild>
                <a href="/sources/index.html" target="_blank" rel="noopener noreferrer">
                  {t("about.sources")}
                </a>
              </Button>
            </TabsContent>
          </div>
        </Tabs>
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
