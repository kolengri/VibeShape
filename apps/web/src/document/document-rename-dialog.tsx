import { documentNameInputSchema } from "@vibeshape/domain/document"
import { useTranslations } from "@vibeshape/i18n"
import { type ComponentProps, useState } from "react"
import {
  SemanticRenameDialog,
  type SemanticRenameDialogCopy,
} from "../components/semantic-rename-dialog"
import {
  type DocumentControllerState,
  getProjectActionBlock,
  renameActiveProject,
} from "./document-controller"

export function projectRenameAvailable(controller: DocumentControllerState) {
  return (
    controller.status === "ready" &&
    controller.report?.mode === "read-write" &&
    controller.saveStatus !== "saving" &&
    !getProjectActionBlock()
  )
}

export function DocumentRenameDialog({
  controller,
  disabled = false,
  onRenamed,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
  onCloseAutoFocus,
}: {
  controller: DocumentControllerState
  disabled?: boolean
  onRenamed?: (name: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
  onCloseAutoFocus?: ComponentProps<typeof SemanticRenameDialog>["onCloseAutoFocus"]
}) {
  const t = useTranslations("app.projectRename")
  const [localOpen, setLocalOpen] = useState(false)
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
      open={controlledOpen ?? localOpen}
      showTrigger={showTrigger}
      triggerLabel={report ? t("trigger", { name: currentName }) : t("tooltip")}
      triggerTooltip={t("tooltip")}
      onOpenChange={onOpenChange ?? setLocalOpen}
      onCloseAutoFocus={onCloseAutoFocus}
      onRename={(name) => renameActiveProject(report?.snapshot.revision ?? 0, name)}
      {...(onRenamed ? { onRenamed } : {})}
    />
  )
}
