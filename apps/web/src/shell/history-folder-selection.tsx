import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { type HistoryFolder, historyItemKey } from "@vibeshape/domain/history-folders"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@vibeshape/ui/components/context-menu"
import { Check } from "@vibeshape/ui/components/icons"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useRef,
  useState,
} from "react"
import type { AuthoredMetadataCommit } from "./authored-item-rename"
import { folderItemsWithSelection, selectedFolderItems } from "./authored-tree-state"
import { HistoryFolderDialog } from "./history-folder-dialog"
import type { HistoryViewRow } from "./model-tree-history"

type FolderSelection = { keys: readonly string[]; anchor: string | null }
type SelectionGesture = { additive: boolean; range: boolean }

function nextSelection(
  authority: AuthoredDocumentSnapshot,
  previous: FolderSelection,
  key: string,
  gesture: SelectionGesture,
): FolderSelection {
  const keys = authority.history.map(historyItemKey)
  const currentKeys = new Set(keys)
  const selected = new Set(previous.keys.filter((item) => currentKeys.has(item)))
  const anchorIndex = keys.indexOf(previous.anchor ?? "")
  const index = keys.indexOf(key)
  if (gesture.range && anchorIndex >= 0 && index >= 0) {
    const range = keys.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1)
    return {
      keys: gesture.additive ? [...new Set([...selected, ...range])] : range,
      anchor: previous.anchor,
    }
  }
  if (!gesture.additive) return { keys: [key], anchor: key }
  if (selected.has(key)) selected.delete(key)
  else selected.add(key)
  return {
    keys: [...selected],
    anchor: key,
  }
}

type FolderSelectionContext = {
  authority: AuthoredDocumentSnapshot
  disabled: boolean
  keys: readonly string[]
  selected: ReadonlySet<string>
  select: (key: string, gesture: SelectionGesture) => void
  create: (key?: string, focusTarget?: HTMLElement | null) => void
  add: (folder: HistoryFolder, baseRevision: number, key: string) => void
  rows: readonly HistoryViewRow[]
  onCommit: AuthoredMetadataCommit
  controlsRef: RefObject<HTMLDivElement | null>
  clear: () => void
  error: string | null
}
const SelectionContext = createContext<FolderSelectionContext | null>(null)

type HistoryInsertionSide = "above" | "below"
function useHistoryInsertion(
  onInsert: ((side: HistoryInsertionSide) => Promise<boolean>) | undefined,
  disabled: boolean,
) {
  const t = useTranslations("app.authoredTree")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const run = async (side: HistoryInsertionSide) => {
    if (!onInsert || disabled || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      if (!(await onInsert(side))) setError(t("insertFailed"))
    } catch {
      setError(t("insertFailed"))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  return { run, error, pending, available: onInsert !== undefined, disabled }
}

function useFolderAppend(
  authority: AuthoredDocumentSnapshot,
  onCommit: AuthoredMetadataCommit,
  disabled: boolean,
  onApplied: () => void,
) {
  const t = useTranslations("app.authoredTree")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const add = async (folder: HistoryFolder, baseRevision: number, keys: readonly string[]) => {
    if (disabled || pendingRef.current) return
    if (authority.revision !== baseRevision) {
      setError(t("folderMembershipStale"))
      return
    }
    const combined = folderItemsWithSelection(authority, folder, keys)
    if (!combined) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      const result = await onCommit(baseRevision, {
        kind: "folder.set-items",
        folderId: folder.id,
        items: [...combined],
      })
      if (result.ok) onApplied()
      else
        setError(
          t(
            result.diagnostic.sourceCode === "stale-revision"
              ? "folderMembershipStale"
              : "folderMembershipFailed",
          ),
        )
    } catch {
      setError(t("folderMembershipFailed"))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  return { add, error, pending, clearError: () => setError(null) }
}

export function HistoryFolderSelection({
  authority,
  disabled,
  rows,
  onCommit,
  children,
}: {
  authority: AuthoredDocumentSnapshot | null
  disabled: boolean
  rows: readonly HistoryViewRow[]
  onCommit: AuthoredMetadataCommit | undefined
  children: ReactNode
}) {
  if (!authority || !onCommit) return children
  return (
    <HistoryFolderSelectionScope
      key={authority.id}
      authority={authority}
      disabled={disabled}
      rows={rows}
      onCommit={onCommit}
    >
      {children}
    </HistoryFolderSelectionScope>
  )
}

function HistoryFolderSelectionScope({
  authority,
  disabled,
  rows,
  onCommit,
  children,
}: {
  authority: AuthoredDocumentSnapshot
  disabled: boolean
  rows: readonly HistoryViewRow[]
  onCommit: AuthoredMetadataCommit
  children: ReactNode
}) {
  const [selection, setSelection] = useState<FolderSelection>({ keys: [], anchor: null })
  const [creation, setCreation] = useState<{
    items: readonly HistoryItemRef[]
    focusTarget: HTMLElement | null
  } | null>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const clear = () => setSelection({ keys: [], anchor: null })
  const append = useFolderAppend(authority, onCommit, disabled, clear)
  const historyKeys = new Set(authority.history.map(historyItemKey))
  const keys = selection.keys.filter((key) => historyKeys.has(key))
  const selectedKeys = new Set(keys)
  const locked = disabled || append.pending
  const keysForRow = (key: string) => (selectedKeys.has(key) ? keys : [key])
  const select = (key: string, gesture: SelectionGesture) => {
    setSelection((previous) => nextSelection(authority, previous, key, gesture))
    append.clearError()
  }
  const create = (key?: string, focusTarget: HTMLElement | null = null) => {
    if (locked) return
    const selected = selectedFolderItems(authority, key ? keysForRow(key) : keys)
    if (selected) setCreation({ items: selected, focusTarget })
  }
  return (
    <SelectionContext
      value={{
        authority,
        disabled: locked,
        keys,
        selected: selectedKeys,
        select,
        create,
        add: (folder, revision, key) => {
          void append.add(folder, revision, keysForRow(key))
        },
        rows,
        onCommit,
        controlsRef,
        clear,
        error: append.error,
      }}
    >
      {children}
      {creation && (
        <HistoryFolderDialog
          authority={authority}
          rows={rows}
          disabled={locked}
          onCommit={async (revision, change) => {
            const result = await onCommit(revision, change)
            if (result.ok) clear()
            return result
          }}
          initialItems={creation.items}
          open
          onOpenChange={(open) => {
            if (!open) setCreation(null)
          }}
          showTrigger={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = creation.focusTarget?.isConnected
              ? creation.focusTarget
              : controlsRef.current?.querySelector<HTMLButtonElement>("button")
            target?.focus()
          }}
        />
      )}
    </SelectionContext>
  )
}

export function HistoryFolderSelectionControls() {
  const context = useContext(SelectionContext)
  const t = useTranslations("app.authoredTree")
  if (!context) return null
  const items = selectedFolderItems(context.authority, context.keys)
  return (
    <div ref={context.controlsRef} className="space-y-1 px-2 pb-1">
      <div className="flex flex-wrap items-center gap-1">
        <HistoryFolderDialog
          authority={context.authority}
          rows={context.rows}
          disabled={context.disabled}
          onCommit={context.onCommit}
        />
        {context.keys.length > 0 && (
          <>
            <Button
              size="xs"
              variant="ghost"
              disabled={context.disabled || !items}
              onClick={(event) => context.create(undefined, event.currentTarget)}
            >
              {t("addSelectionToFolder")}
            </Button>
            <Button size="xs" variant="ghost" onClick={context.clear}>
              {t("clearSelection")}
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("folderSelectionInstructions")}</p>
      {context.keys.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          {items ? t("selectedItems", { count: context.keys.length }) : t("invalidSelection")}
        </p>
      )}
      {context.error && (
        <p role="alert" className="text-xs text-destructive">
          {context.error}
        </p>
      )}
    </div>
  )
}

function captureHistorySelection(
  event: MouseEvent<HTMLDivElement>,
  context: FolderSelectionContext,
  key: string,
) {
  if (!(event.target instanceof Element) || !event.target.closest('[role="treeitem"]')) return
  const additive = event.metaKey || event.ctrlKey
  if (!additive && !event.shiftKey) return
  event.preventDefault()
  event.stopPropagation()
  context.select(key, { additive, range: event.shiftKey })
}

function openHistoryMenuFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
  if (!(event.target instanceof HTMLElement)) return
  event.preventDefault()
  event.stopPropagation()
  const bounds = event.target.getBoundingClientRect()
  event.target.dispatchEvent(
    new window.MouseEvent("contextmenu", {
      bubbles: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.bottom,
    }),
  )
}

function HistoryInsertionMenuItems({
  insertion,
}: {
  insertion: ReturnType<typeof useHistoryInsertion>
}) {
  const t = useTranslations("app.authoredTree")
  if (!insertion.available) return null
  const disabled = insertion.disabled || insertion.pending
  return (
    <>
      <ContextMenuItem
        disabled={disabled}
        onSelect={() => {
          void insertion.run("above")
        }}
      >
        {t("insertAbove")}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={disabled}
        onSelect={() => {
          void insertion.run("below")
        }}
      >
        {t("insertBelow")}
      </ContextMenuItem>
    </>
  )
}

function HistoryInsertionFeedback({
  insertion,
}: {
  insertion: ReturnType<typeof useHistoryInsertion>
}) {
  const t = useTranslations("app.authoredTree")
  return (
    <>
      {insertion.pending && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("insertPending")}
        </p>
      )}
      {insertion.error && (
        <p role="alert" className="text-xs text-destructive">
          {insertion.error}
        </p>
      )}
    </>
  )
}

function HistoryInsertionOnlyRow({
  insertion,
  children,
}: {
  insertion: ReturnType<typeof useHistoryInsertion>
  children: ReactNode
}) {
  if (!insertion.available) return children
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div role="none" onKeyDown={openHistoryMenuFromKeyboard}>
          {children}
          <HistoryInsertionFeedback insertion={insertion} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <HistoryInsertionMenuItems insertion={insertion} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function HistoryFolderRowMenu({
  context,
  itemKey,
  menuRevision,
  rowRef,
  openingDialogRef,
  insertion,
}: {
  context: FolderSelectionContext
  itemKey: string
  menuRevision: number | null
  rowRef: RefObject<HTMLDivElement | null>
  openingDialogRef: RefObject<boolean>
  insertion: ReturnType<typeof useHistoryInsertion>
}) {
  const t = useTranslations("app.authoredTree")
  if (menuRevision === null) return null
  const keys = context.selected.has(itemKey) ? context.keys : [itemKey]
  const canCreate = selectedFolderItems(context.authority, keys) !== null
  const locked = context.disabled || insertion.pending
  return (
    <ContextMenuContent
      onCloseAutoFocus={(event) => {
        if (openingDialogRef.current) {
          event.preventDefault()
          openingDialogRef.current = false
        }
      }}
    >
      <HistoryInsertionMenuItems insertion={insertion} />
      <ContextMenuItem
        disabled={locked || !canCreate}
        aria-haspopup="dialog"
        onSelect={() => {
          openingDialogRef.current = true
          context.create(itemKey, rowRef.current?.querySelector<HTMLElement>('[role="treeitem"]'))
        }}
      >
        {t("addSelectionToFolder")}
      </ContextMenuItem>
      {context.authority.folders.length > 0 && (
        <ContextMenuLabel>{t("addToExistingFolder")}</ContextMenuLabel>
      )}
      {context.authority.folders.map((folder) => (
        <ContextMenuItem
          key={folder.id}
          disabled={locked || !folderItemsWithSelection(context.authority, folder, keys)}
          onSelect={() => context.add(folder, menuRevision, itemKey)}
        >
          {t("addToFolder", { name: folder.name })}
        </ContextMenuItem>
      ))}
    </ContextMenuContent>
  )
}

export function HistoryFolderSelectableRow({
  row,
  children,
  onInsert,
  insertionDisabled = false,
}: {
  row: HistoryViewRow
  children: ReactNode
  onInsert?: ((side: HistoryInsertionSide) => Promise<boolean>) | undefined
  insertionDisabled?: boolean | undefined
}) {
  const context = useContext(SelectionContext)
  const t = useTranslations("app.authoredTree")
  const [menuRevision, setMenuRevision] = useState<number | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const openingDialogRef = useRef(false)
  const insertion = useHistoryInsertion(onInsert, insertionDisabled)
  if (!context)
    return <HistoryInsertionOnlyRow insertion={insertion}>{children}</HistoryInsertionOnlyRow>
  const key = historyItemKey(row.ref)
  const selected = context.selected.has(key)
  const label = row.record.label || t("unnamedItem")
  return (
    <ContextMenu onOpenChange={(open) => setMenuRevision(open ? context.authority.revision : null)}>
      <ContextMenuTrigger asChild>
        <div
          ref={rowRef}
          role="none"
          data-folder-selected={selected ? "true" : undefined}
          className={cn(
            "flex min-w-0 items-start",
            selected && "bg-accent ring-1 ring-primary ring-inset",
          )}
          onContextMenuCapture={() => {
            if (!selected) context.select(key, { additive: false, range: false })
          }}
          onClickCapture={(event) => captureHistorySelection(event, context, key)}
          onKeyDown={openHistoryMenuFromKeyboard}
        >
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t("selectHistoryItem", { name: label })}
            aria-pressed={selected}
            onClick={(event) =>
              context.select(key, { additive: !event.shiftKey, range: event.shiftKey })
            }
            className="shrink-0"
          >
            <span
              className={cn(
                "flex size-3.5 items-center justify-center rounded-sm border border-border",
                selected && "border-primary text-primary",
              )}
            >
              {selected && <Check aria-hidden="true" className="size-3" />}
            </span>
          </Button>
          <div className="min-w-0 flex-1">
            {children}
            <HistoryInsertionFeedback insertion={insertion} />
          </div>
        </div>
      </ContextMenuTrigger>
      <HistoryFolderRowMenu
        context={context}
        itemKey={key}
        menuRevision={menuRevision}
        rowRef={rowRef}
        openingDialogRef={openingDialogRef}
        insertion={insertion}
      />
    </ContextMenu>
  )
}
