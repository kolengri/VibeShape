import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import type { DocumentV2MetadataChange } from "@vibeshape/domain/document-v2-command-schemas"
import { type HistoryFolder, historyItemKey } from "@vibeshape/domain/history-folders"
import { historyFolderIdSchema } from "@vibeshape/domain/identifiers"
import { authoredItemNameSchema } from "@vibeshape/domain/parts"
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
import { FolderPlus } from "@vibeshape/ui/components/icons"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { browserAuthoredUuid } from "../document/authored-document-session"
import type { AuthoredMetadataCommit } from "./authored-item-rename"
import { folderRangeItems, selectedFolderItems } from "./authored-tree-state"
import type { HistoryViewRow } from "./model-tree-history"

type FolderDialogProps = {
  authority: AuthoredDocumentSnapshot
  folder?: HistoryFolder
  rows: readonly HistoryViewRow[]
  disabled: boolean
  onCommit: AuthoredMetadataCommit
  initialItems?: readonly HistoryItemRef[] | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
  showTrigger?: boolean | undefined
  onCloseAutoFocus?: ((event: Event) => void) | undefined
}

function initialFolderItem(authority: AuthoredDocumentSnapshot, folder?: HistoryFolder) {
  const occupied = new Set(authority.folders.flatMap((item) => item.items.map(historyItemKey)))
  const first =
    folder?.items[0] ?? authority.history.find((item) => !occupied.has(historyItemKey(item)))
  return first ? historyItemKey(first) : ""
}

function folderFormChange(
  base: AuthoredDocumentSnapshot,
  folder: HistoryFolder | undefined,
  values: { name: string; first: string; last: string },
  initialItems?: readonly HistoryItemRef[],
):
  | { ok: true; change: DocumentV2MetadataChange }
  | { ok: false; reason: "invalidName" | "invalidRange" } {
  const items = initialItems
    ? selectedFolderItems(base, initialItems.map(historyItemKey))
    : folderRangeItems(base, values.first, values.last, folder?.id)
  if (!items) return { ok: false, reason: "invalidRange" }
  if (folder)
    return {
      ok: true,
      change: { kind: "folder.set-items", folderId: folder.id, items: [...items] },
    }
  const name = authoredItemNameSchema.safeParse(values.name)
  if (!name.success) return { ok: false, reason: "invalidName" }
  return {
    ok: true,
    change: {
      kind: "folder.create",
      folder: {
        schemaVersion: 0,
        id: historyFolderIdSchema.parse(browserAuthoredUuid()),
        name: name.data,
        items: [...items],
      },
    },
  }
}

function FolderForm({
  authority,
  folder,
  rows,
  onCommit,
  onDone,
  pending,
  setPending,
  initialItems,
  disabled,
}: FolderDialogProps & {
  onDone: () => void
  pending: boolean
  setPending: (pending: boolean) => void
}) {
  const t = useTranslations("app.authoredTree")
  const [base] = useState(authority)
  const [error, setError] = useState<string | null>(null)
  const first = initialFolderItem(base, folder)
  const last = folder?.items.at(-1)
  const form = useAppForm({
    defaultValues: { name: "", first, last: last ? historyItemKey(last) : first },
    onSubmit: async ({ value }) => {
      if (pending || disabled) return
      const parsed = folderFormChange(base, folder, value, initialItems)
      if (!parsed.ok) {
        setError(t(parsed.reason))
        return
      }
      if (base.id !== authority.id || base.revision !== authority.revision) {
        setError(t("staleRevision"))
        return
      }
      setError(null)
      setPending(true)
      try {
        const result = await onCommit(base.revision, parsed.change)
        if (result.ok) onDone()
        else
          setError(
            t(result.diagnostic.sourceCode === "stale-revision" ? "staleRevision" : "saveFailed"),
          )
      } catch {
        setError(t("saveFailed"))
      } finally {
        setPending(false)
      }
    },
  })
  const occupied = new Set(
    base.folders
      .filter((item) => item.id !== folder?.id)
      .flatMap((item) => item.items.map(historyItemKey)),
  )
  const initialKeys = new Set(initialItems?.map(historyItemKey))
  return (
    <Form form={form} aria-label={t(folder ? "editMembership" : "createFolder")}>
      {!folder && (
        <form.AppField name="name">
          {(field) => (
            <field.TextField
              autoFocus
              required
              autoComplete="off"
              disabled={pending || disabled}
              label={t("folderName")}
              description={t("nameDescription")}
            />
          )}
        </form.AppField>
      )}
      {initialItems ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t("selectedItems", { count: initialItems.length })}</p>
          <ul className="max-h-40 overflow-y-auto">
            {rows
              .filter((row) => initialKeys.has(historyItemKey(row.ref)))
              .map((row) => (
                <li key={historyItemKey(row.ref)}>{row.record.label || t("unnamedItem")}</li>
              ))}
          </ul>
        </div>
      ) : (
        (["first", "last"] as const).map((key) => (
          <form.Field key={key} name={key}>
            {(field) => (
              <SelectField
                label={t(key === "first" ? "firstItem" : "lastItem")}
                value={field.state.value}
                onValueChange={field.handleChange}
                onBlur={field.handleBlur}
                disabled={pending || disabled}
              >
                {rows.map((row, index) => (
                  <SelectOption
                    key={historyItemKey(row.ref)}
                    value={historyItemKey(row.ref)}
                    disabled={occupied.has(historyItemKey(row.ref))}
                  >
                    {t("historyOption", {
                      position: index + 1,
                      name: row.record.label || t("unnamedItem"),
                    })}
                  </SelectOption>
                ))}
              </SelectField>
            )}
          </form.Field>
        ))
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {t("cancel")}
          </Button>
        </DialogClose>
        <form.SubmitButton disabled={disabled}>
          {t(folder ? "saveMembership" : "createFolder")}
        </form.SubmitButton>
      </DialogFooter>
    </Form>
  )
}

export function HistoryFolderDialog(props: FolderDialogProps) {
  const t = useTranslations("app.authoredTree")
  const [localOpen, setLocalOpen] = useState(false)
  const open = props.open ?? localOpen
  const setOpen = props.onOpenChange ?? setLocalOpen
  const [pending, setPending] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) setOpen(value)
      }}
    >
      {props.showTrigger !== false && (
        <Tooltip {...(props.folder ? { open: false } : {})}>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                type="button"
                size={props.folder ? "xs" : "icon-xs"}
                variant="ghost"
                disabled={props.disabled || !initialFolderItem(props.authority, props.folder)}
                aria-label={
                  props.folder
                    ? t("editFolderItems", { name: props.folder.name })
                    : t("createFolder")
                }
              >
                {props.folder ? t("items") : <FolderPlus aria-hidden="true" />}
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {props.folder ? t("editFolderItems", { name: props.folder.name }) : t("createFolder")}
          </TooltipContent>
        </Tooltip>
      )}
      <DialogContent
        closeLabel={t("closeFolder")}
        showCloseButton={!pending}
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {props.folder ? t("folderItemsTitle", { name: props.folder.name }) : t("createFolder")}
          </DialogTitle>
          <DialogDescription>{t("folderDescription")}</DialogDescription>
        </DialogHeader>
        <FolderForm
          {...props}
          pending={pending}
          setPending={setPending}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
