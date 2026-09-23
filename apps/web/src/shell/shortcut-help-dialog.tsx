import { useTranslations } from "@vibeshape/i18n"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { Input } from "@vibeshape/ui/components/input"
import { type RefObject, useRef, useState } from "react"
import type { ResolvedEditorCommand } from "../commands/editor-command"
import {
  editorCommandShortcutLabel,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"

export function useShortcutHelp() {
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const show = (returnFocusTarget?: HTMLElement) => {
    returnFocusRef.current =
      returnFocusTarget ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setOpen(true)
  }
  return { open, setOpen, show, returnFocusRef }
}

export function ShortcutHelpDialog({
  commands,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  commands: readonly ResolvedEditorCommand[]
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const t = useTranslations("app.commands.shortcutHelp")
  const copy = useEditorCommandCopy()
  const [query, setQuery] = useState("")
  const entries = commands.flatMap(({ descriptor, eligibility }) => {
    if (!descriptor.shortcut) return []
    return [
      {
        id: descriptor.id,
        label: copy.label(descriptor),
        keys: editorCommandShortcutLabel(descriptor.shortcut),
        context: copy.group(descriptor.group),
        reason: eligibility.enabled ? null : copy.disabledReason(eligibility.reason),
      },
    ]
  })
  const rows = [
    {
      id: "palette",
      label: t("palette"),
      keys: editorCommandShortcutLabel({ key: "k", modifiers: ["mod"] }),
      context: t("global"),
      reason: null,
    },
    {
      id: "sketch-toolbar",
      label: t("sketchToolbar"),
      keys: "S",
      context: t("sketch"),
      reason: null,
    },
    {
      id: "history-rename",
      label: t("renameHistoryItem"),
      keys: "F2",
      context: t("history"),
      reason: null,
    },
    {
      id: "sketch-delete",
      label: t("deleteSelection"),
      keys: "Delete / Backspace",
      context: t("sketch"),
      reason: null,
    },
    ...entries,
  ].filter((row) =>
    `${row.label} ${row.keys} ${row.context}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        closeLabel={t("close")}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocusRef.current?.isConnected) {
            returnFocusRef.current.focus()
            return
          }
          document.querySelector<HTMLElement>("[data-shortcut-help-trigger]")?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Input
          aria-label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="max-h-[45svh] overflow-y-auto overscroll-contain">
          <dl className="divide-y" aria-label={t("list")}>
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2"
              >
                <dt className="min-w-0 break-words">
                  <span>{row.label}</span>
                  <span className="block text-xs text-muted-foreground">{row.context}</span>
                  {row.reason ? (
                    <span className="block text-xs text-muted-foreground">{row.reason}</span>
                  ) : null}
                </dt>
                <dd>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {row.keys}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
          {rows.length === 0 ? (
            <p role="status" className="py-3 text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("dragHelp")}</p>
      </DialogContent>
    </Dialog>
  )
}
