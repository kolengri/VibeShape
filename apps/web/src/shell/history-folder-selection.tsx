import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { type HistoryFolder, historyItemKey } from "@vibeshape/domain/history-folders"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@vibeshape/ui/components/context-menu"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useId,
  useRef,
  useState,
} from "react"
import type { DocumentControllerState } from "../document/document-controller"
import type { AuthoredMetadataCommit } from "./authored-item-rename"
import { folderItemsWithSelection, selectedFolderItems } from "./authored-tree-state"
import { HistoryFolderDialog } from "./history-folder-dialog"
import { useHistorySelectionDelete } from "./history-selection-delete"
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
  anchor: (key: string) => void
  create: (key?: string, focusTarget?: HTMLElement | null) => void
  add: (folder: HistoryFolder, baseRevision: number, key: string) => void
  rows: readonly HistoryViewRow[]
  onCommit: AuthoredMetadataCommit
  controlsRef: RefObject<HTMLDivElement | null>
  clear: () => void
  error: string | null
  deleteKeyDown: (event: KeyboardEvent<HTMLElement>, key: string) => void
}
const SelectionContext = createContext<FolderSelectionContext | null>(null)

export function useHistoryFolderSelectionDescription(item: HistoryItemRef) {
  const context = useContext(SelectionContext)
  const t = useTranslations("app.authoredTree")
  const id = useId()
  if (!context) return undefined
  return {
    id,
    text: t(
      context.selected.has(historyItemKey(item))
        ? "folderSelectionSelected"
        : "folderSelectionNotSelected",
    ),
  }
}

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
  controller,
  authority,
  disabled,
  rows,
  onCommit,
  children,
}: {
  controller?: DocumentControllerState | undefined
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
      controller={controller}
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
  controller,
  authority,
  disabled,
  rows,
  onCommit,
  children,
}: {
  controller: DocumentControllerState | undefined
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
  const deletion = useHistorySelectionDelete({
    controller,
    targets: authority.history.filter((item) => selectedKeys.has(historyItemKey(item))),
    disabled: locked || creation !== null,
    onDeleted: clear,
  })
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
        anchor: (key) => setSelection((previous) => ({ ...previous, anchor: key })),
        create,
        add: (folder, revision, key) => {
          void append.add(folder, revision, keysForRow(key))
        },
        rows,
        onCommit,
        controlsRef,
        clear,
        error: append.error,
        deleteKeyDown: (event, key) => {
          const selected = new Set(keysForRow(key))
          deletion.onKeyDown(
            event,
            authority.history.filter((item) => selected.has(historyItemKey(item))),
          )
        },
      }}
    >
      {children}
      {deletion.confirmation}
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

export function HistoryFolderSelectionControls({ compact = false }: { compact?: boolean }) {
  const context = useContext(SelectionContext)
  const t = useTranslations("app.authoredTree")
  if (!context) return null
  const items = selectedFolderItems(context.authority, context.keys)
  return (
    <div ref={context.controlsRef} className={compact ? "min-w-0" : "space-y-1 px-2 pb-1"}>
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
      <p className={compact ? "sr-only" : "text-xs text-muted-foreground"}>
        {t("folderSelectionInstructions")}
      </p>
      {context.keys.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          {items ? t("selectedItems", { count: context.keys.length }) : t("invalidSelection")}
        </p>
      )}
      {context.error && <Alert>{context.error}</Alert>}
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
  if (!additive && !event.shiftKey) {
    context.anchor(key)
    return
  }
  event.preventDefault()
  event.stopPropagation()
  context.select(key, { additive, range: event.shiftKey })
}

function captureHistoryKeyboardSelection(
  event: KeyboardEvent<HTMLDivElement>,
  context: FolderSelectionContext,
  key: string,
) {
  if (event.key !== " " || !event.shiftKey) return
  if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "treeitem")
    return
  event.preventDefault()
  event.stopPropagation()
  context.select(key, { additive: event.metaKey || event.ctrlKey, range: true })
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
      {insertion.error && <Alert>{insertion.error}</Alert>}
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
  const [menuRevision, setMenuRevision] = useState<number | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const openingDialogRef = useRef(false)
  const insertion = useHistoryInsertion(onInsert, insertionDisabled)
  if (!context)
    return <HistoryInsertionOnlyRow insertion={insertion}>{children}</HistoryInsertionOnlyRow>
  const key = historyItemKey(row.ref)
  const selected = context.selected.has(key)
  return (
    <ContextMenu onOpenChange={(open) => setMenuRevision(open ? context.authority.revision : null)}>
      <ContextMenuTrigger asChild>
        <div
          ref={rowRef}
          role="none"
          data-folder-selected={selected ? "true" : undefined}
          className={cn(
            "relative flex min-w-0 shrink-0 items-start",
            selected && "rounded-md bg-accent ring-1 ring-primary ring-inset",
          )}
          onContextMenuCapture={() => {
            if (!selected) context.select(key, { additive: false, range: false })
          }}
          onClickCapture={(event) => captureHistorySelection(event, context, key)}
          onKeyDownCapture={(event) => captureHistoryKeyboardSelection(event, context, key)}
          onKeyDown={(event) => {
            context.deleteKeyDown(event, key)
            openHistoryMenuFromKeyboard(event)
          }}
        >
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
