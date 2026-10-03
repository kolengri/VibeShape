import type { DocumentV2MetadataChange } from "@vibeshape/domain/document-v2-command-schemas"
import type { HistoryFolder } from "@vibeshape/domain/history-folders"
import { authoredItemNameSchema, type PartRecord } from "@vibeshape/domain/parts"
import { useTranslations } from "@vibeshape/i18n"
import { useState } from "react"
import { SemanticRenameDialog } from "../components/semantic-rename-dialog"
import type { DocumentMutationResult } from "../document/document-controller"

export type AuthoredMetadataCommit = (
  revision: number,
  change: DocumentV2MetadataChange,
) => Promise<DocumentMutationResult>

type RenameTarget = { kind: "part"; item: PartRecord } | { kind: "folder"; item: HistoryFolder }

export function AuthoredItemRename({
  item,
  kind,
  revision,
  disabled,
  onCommit,
}: RenameTarget & {
  revision: number
  disabled: boolean
  onCommit: AuthoredMetadataCommit
}) {
  const t = useTranslations("app.authoredTree")
  const [baseRevision, setBaseRevision] = useState<number | null>(null)
  return (
    <SemanticRenameDialog
      copy={{
        cancel: t("cancel"),
        closeLabel: t("renameClose"),
        description: t("renameDescription"),
        fieldDescription: t("nameDescription"),
        fieldLabel: t("name"),
        invalidName: t("invalidName"),
        save: t("renameSave"),
        saveFailed: t("saveFailed"),
        staleRevision: t("staleRevision"),
        title: t("renameTitle"),
        unchangedName: t("unchangedName"),
      }}
      currentName={item.name}
      disabled={disabled}
      disabledTooltip={t("editingBlocked")}
      nameSchema={authoredItemNameSchema}
      open={baseRevision !== null}
      onOpenChange={(open) => setBaseRevision(open ? revision : null)}
      onRename={(name) =>
        onCommit(
          baseRevision ?? revision,
          kind === "part"
            ? { kind: "part.rename", partId: item.id, name }
            : { kind: "folder.rename", folderId: item.id, name },
        )
      }
      triggerLabel={t(kind === "part" ? "renamePart" : "renameFolder", { name: item.name })}
      triggerTooltip={t("renameTitle")}
    />
  )
}
