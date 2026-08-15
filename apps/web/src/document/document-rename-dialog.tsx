import { documentNameInputSchema } from "@vibeshape/domain/document"
import { useTranslations } from "@vibeshape/i18n"
import { useState } from "react"
import {
  SemanticRenameDialog,
  type SemanticRenameDialogCopy,
} from "../components/semantic-rename-dialog"
import { type DocumentControllerState, renameActiveProject } from "./document-controller"

export function DocumentRenameDialog({
  controller,
  disabled = false,
  onRenamed,
}: {
  controller: DocumentControllerState
  disabled?: boolean
  onRenamed?: (name: string) => void
}) {
  const t = useTranslations("app.projectRename")
  const [open, setOpen] = useState(false)
  const report = controller.report
  const currentName = report?.snapshot.name ?? t("title")
  const writable = controller.status === "ready" && report?.mode === "read-write"
  const copy: SemanticRenameDialogCopy = {
    cancel: t("cancel"),
    closeLabel: t("closeLabel"),
    description: t("description"),
    fieldDescription: t("fieldDescription"),
    fieldLabel: t("fieldLabel"),
    invalidName: t("invalidName"),
    save: t("save"),
    saveFailed: t("saveFailed"),
    staleRevision: t("staleRevision"),
    title: t("title"),
    unchangedName: t("unchangedName"),
  }

  return (
    <SemanticRenameDialog
      copy={copy}
      currentName={currentName}
      disabled={disabled || !writable}
      disabledTooltip={t("readOnly")}
      nameSchema={documentNameInputSchema}
      open={open}
      triggerLabel={report ? t("trigger", { name: currentName }) : t("tooltip")}
      triggerTooltip={t("tooltip")}
      onOpenChange={setOpen}
      onRename={(name) => renameActiveProject(report?.snapshot.revision ?? 0, name)}
      {...(onRenamed ? { onRenamed } : {})}
    />
  )
}
