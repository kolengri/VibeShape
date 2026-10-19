import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Settings as SettingsIcon } from "@vibeshape/ui/components/icons"
import { useRef, useState } from "react"
import { NativeApplicationCommandBridge } from "../desktop/native-editor-commands"
import type { DocumentControllerState } from "../document/document-controller"
import { FaqDialog } from "../shell/faq-dialog"
import { SettingsDialog } from "../shell/settings-dialog"

const libraryCommands = ["settings", "faq"] as const
export function ProjectLibraryActions({ controller }: { controller: DocumentControllerState }) {
  const t = useTranslations("app.settings")
  const [dialog, setDialog] = useState<(typeof libraryCommands)[number] | null>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  return (
    <div className="ml-auto flex items-center gap-2">
      <NativeApplicationCommandBridge
        exportAvailable={false}
        allowedCommands={libraryCommands}
        onCommand={(command) => {
          if (command === "settings" || command === "faq") setDialog(command)
        }}
      />
      <Button
        ref={settingsTrigger}
        type="button"
        size="icon"
        variant="outline"
        aria-label={t("title")}
        title={t("title")}
        onClick={() => setDialog("settings")}
      >
        <SettingsIcon aria-hidden="true" />
      </Button>
      {dialog === "settings" ? (
        <SettingsDialog
          controller={controller}
          blocked
          showTrigger={false}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            settingsTrigger.current?.focus()
          }}
        />
      ) : null}
      <FaqDialog open={dialog === "faq"} onOpenChange={(open) => setDialog(open ? "faq" : null)} />
    </div>
  )
}
