import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Popover, PopoverAnchor, PopoverContent } from "@vibeshape/ui/components/popover"
import { Toolbar, ToolbarButton } from "@vibeshape/ui/components/toolbar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { type CSSProperties, type KeyboardEvent, type RefObject, useEffect, useRef } from "react"
import type { ResolvedEditorCommand } from "../commands/editor-command"
import {
  EditorCommandIconView,
  editorCommandShortcutLabel,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"

export type SketchShortcutToolbarAnchor = Readonly<{ x: number; y: number }>

function dismissesShortcutToolbar(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key === "Escape") return true
  return (
    event.key.toLowerCase() === "s" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  )
}

function shortcutCommands(commands: readonly ResolvedEditorCommand[]) {
  return commands
    .filter(({ descriptor }) => descriptor.sketchPresentation?.shortcutOrder !== undefined)
    .sort((first, second) => {
      const order =
        (first.descriptor.sketchPresentation?.shortcutOrder ?? 0) -
        (second.descriptor.sketchPresentation?.shortcutOrder ?? 0)
      return order || first.descriptor.id.localeCompare(second.descriptor.id)
    })
}

function ShortcutAction({
  command,
  onInvoke,
}: Readonly<{
  command: ResolvedEditorCommand
  onInvoke: (command: ResolvedEditorCommand) => unknown
}>) {
  const copy = useEditorCommandCopy()
  const label = copy.label(command.descriptor)
  const disabledReason = command.eligibility.enabled
    ? null
    : copy.disabledReason(command.eligibility.reason)
  const shortcut = command.descriptor.shortcut
    ? editorCommandShortcutLabel(command.descriptor.shortcut)
    : null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <ToolbarButton asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={command.active ? "secondary" : "ghost"}
              aria-label={label}
              aria-pressed={command.active}
              disabled={!command.eligibility.enabled}
              onClick={() => onInvoke(command)}
            >
              <EditorCommandIconView icon={command.descriptor.icon} />
            </Button>
          </ToolbarButton>
        </span>
      </TooltipTrigger>
      <TooltipContent className="grid gap-1">
        <span className="flex items-center justify-between gap-3">
          <span>{label}</span>
          {shortcut ? (
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
              {shortcut}
            </kbd>
          ) : null}
        </span>
        {disabledReason ? <span className="text-muted-foreground">{disabledReason}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function SketchShortcutToolbar({
  anchor,
  commands,
  open,
  returnFocusRef,
  onOpenChange,
}: Readonly<{
  anchor: SketchShortcutToolbarAnchor
  commands: readonly ResolvedEditorCommand[]
  open: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
}>) {
  const t = useTranslations("app.shell.sketchShortcutToolbar")
  const contentRef = useRef<HTMLDivElement | null>(null)
  const availableCommands = shortcutCommands(commands)
  const anchorStyle = { left: anchor.x, top: anchor.y } satisfies CSSProperties
  useEffect(() => {
    if (!open) return
    queueMicrotask(() =>
      contentRef.current?.querySelector<HTMLElement>("[role='toolbar']")?.focus(),
    )
  }, [open])
  const invoke = (command: ResolvedEditorCommand) => {
    if (!command.eligibility.enabled) return
    onOpenChange(false)
    return command.invoke()
  }
  return (
    <Popover open={open} modal={false} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-px"
          data-sketch-shortcut-anchor
          style={anchorStyle}
        />
      </PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        aria-label={t("ariaLabel")}
        align="start"
        className="w-auto p-1"
        collisionPadding={8}
        side="right"
        sideOffset={8}
        onKeyDownCapture={(event) => {
          if (!dismissesShortcutToolbar(event)) return
          event.preventDefault()
          event.stopPropagation()
          onOpenChange(false)
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const returnTarget = returnFocusRef.current
          if (returnTarget?.isConnected) returnTarget.focus()
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          onOpenChange(false)
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
        }}
      >
        <Toolbar
          aria-label={t("ariaLabel")}
          className="grid grid-cols-6 gap-1"
          data-sketch-shortcut-toolbar
        >
          {availableCommands.map((command) => (
            <ShortcutAction key={command.descriptor.id} command={command} onInvoke={invoke} />
          ))}
        </Toolbar>
      </PopoverContent>
    </Popover>
  )
}
