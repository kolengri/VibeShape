import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import type { HistoryFolder } from "@vibeshape/domain/history-folders"
import { useTranslations } from "@vibeshape/i18n"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@vibeshape/ui/components/alert-dialog"
import { Button } from "@vibeshape/ui/components/button"
import { ChevronDown, FolderOpen, Trash2 } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import { type ReactNode, useState } from "react"
import { AuthoredItemRename, type AuthoredMetadataCommit } from "./authored-item-rename"
import { HistoryFolderDialog } from "./history-folder-dialog"
import { type HistoryViewRow, historyRefKey } from "./model-tree-history"

function RemoveFolder({
  folder,
  revision,
  disabled,
  onCommit,
}: {
  folder: HistoryFolder
  revision: number
  disabled: boolean
  onCommit: AuthoredMetadataCommit
}) {
  const t = useTranslations("app.authoredTree")
  const [baseRevision, setBaseRevision] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    if (baseRevision === null) return
    setPending(true)
    setError(null)
    try {
      const result = await onCommit(baseRevision, { kind: "folder.remove", folderId: folder.id })
      if (result.ok) setBaseRevision(null)
      else
        setError(
          t(result.diagnostic.sourceCode === "stale-revision" ? "staleRevision" : "saveFailed"),
        )
    } catch {
      setError(t("saveFailed"))
    } finally {
      setPending(false)
    }
  }
  return (
    <AlertDialog
      open={baseRevision !== null}
      onOpenChange={(open) => {
        if (!pending) {
          setBaseRevision(open ? revision : null)
          setError(null)
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={t("removeFolder", { name: folder.name })}
              disabled={disabled}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("ungroup")}</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("removeFolder", { name: folder.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("removeFolderDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("cancel")}</AlertDialogCancel>
          <Button variant="destructive" onClick={remove}>
            {t("ungroup")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function folderVisualRange(folder: HistoryFolder, rows: readonly HistoryViewRow[]) {
  const first = folder.items[0]
  if (!first) return null
  const start = rows.findIndex((row) => historyRefKey(row.ref) === historyRefKey(first))
  if (
    start < 0 ||
    !folder.items.every((item, offset) => {
      const row = rows[start + offset]
      return row && historyRefKey(row.ref) === historyRefKey(item)
    })
  )
    return null
  const end = start + folder.items.length - 1
  return { start, end, first: historyRefKey(first), last: historyRefKey(rows[end]?.ref ?? first) }
}
export function HistoryFolderGroup({
  authority,
  folder,
  rows,
  disabled,
  onCommit,
  children,
  horizontal = false,
}: {
  authority: AuthoredDocumentSnapshot
  folder: HistoryFolder
  rows: readonly HistoryViewRow[]
  disabled: boolean
  onCommit: AuthoredMetadataCommit
  children: ReactNode
  horizontal?: boolean
}) {
  const t = useTranslations("app.authoredTree")
  const [expanded, setExpanded] = useState(true)
  const range = horizontal ? folderVisualRange(folder, rows) : null
  return (
    <div
      role="none"
      data-folder-id={folder.id}
      data-history-expanded={horizontal ? String(expanded) : undefined}
      data-history-range-start={range?.start}
      data-history-range-end={range?.end}
      data-history-range-first={range?.first}
      data-history-range-last={range?.last}
      className={horizontal ? "shrink-0 border-x" : undefined}
    >
      <div role="none" className="flex min-w-0 items-center">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          role="treeitem"
          aria-label={t("folderLabel", { name: folder.name })}
          aria-expanded={expanded}
          tabIndex={-1}
          className="min-w-0 flex-1 justify-start pl-3 font-normal"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown
            className={cn("size-3 shrink-0", !expanded && "-rotate-90")}
            aria-hidden="true"
          />
          <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{folder.name}</span>
          <span className="ml-auto text-xs text-muted-foreground" aria-hidden="true">
            {folder.items.length}
          </span>
        </Button>
        <AuthoredItemRename
          item={folder}
          kind="folder"
          revision={authority.revision}
          disabled={disabled}
          onCommit={onCommit}
        />
        <RemoveFolder
          folder={folder}
          revision={authority.revision}
          disabled={disabled}
          onCommit={onCommit}
        />
      </div>
      {expanded && (
        <fieldset className={horizontal ? "flex items-start" : "ml-3 border-l border-border pl-1"}>
          <legend className="sr-only">{folder.name}</legend>
          <HistoryFolderDialog
            authority={authority}
            folder={folder}
            rows={rows}
            disabled={disabled}
            onCommit={onCommit}
          />
          {children}
        </fieldset>
      )}
    </div>
  )
}
