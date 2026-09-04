import { useEffect, useRef } from "react"
import type { EditorCommandShortcut, ResolvedEditorCommand } from "./editor-command"

function hasTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return (
    target.matches("input, textarea, select, [contenteditable='true'], [role='textbox']") ||
    target.closest("[contenteditable='true'], [role='textbox']") !== null
  )
}

function matchesShortcut(event: KeyboardEvent, shortcut: EditorCommandShortcut) {
  const modifiers = new Set(shortcut.modifiers ?? [])
  const modPressed = event.metaKey || event.ctrlKey
  if (modPressed !== modifiers.has("mod")) return false
  if (event.altKey !== modifiers.has("alt")) return false
  if (event.shiftKey !== modifiers.has("shift")) return false
  return event.key.toLowerCase() === shortcut.key.toLowerCase()
}

function isPaletteShortcut(event: KeyboardEvent) {
  return (
    !event.altKey &&
    !event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "k"
  )
}

function isSketchShortcutToolbarShortcut(event: KeyboardEvent) {
  return (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "s"
  )
}

function shouldIgnoreEditorShortcut(event: KeyboardEvent) {
  return event.defaultPrevented || event.isComposing || event.repeat
}

function matchingEditorCommand(event: KeyboardEvent, commands: readonly ResolvedEditorCommand[]) {
  return commands.find(
    ({ descriptor, eligibility }) =>
      eligibility.enabled &&
      descriptor.shortcut !== undefined &&
      matchesShortcut(event, descriptor.shortcut),
  )
}

function canInvokeFromTarget(event: KeyboardEvent, command: ResolvedEditorCommand) {
  return !hasTextInputTarget(event.target) || command.descriptor.shortcut?.key === "Escape"
}

function consumeSketchShortcutToolbarKey({
  available,
  event,
  open,
  onOpenChange,
}: {
  available: boolean
  event: KeyboardEvent
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (open) {
    if (event.key === "Escape" || isSketchShortcutToolbarShortcut(event)) {
      event.preventDefault()
      onOpenChange(false)
      return true
    }
    return false
  }
  if (!available || !isSketchShortcutToolbarShortcut(event) || hasTextInputTarget(event.target)) {
    return false
  }
  event.preventDefault()
  onOpenChange(true)
  return true
}

function invokeMatchingEditorCommand(
  event: KeyboardEvent,
  commands: readonly ResolvedEditorCommand[],
) {
  const command = matchingEditorCommand(event, commands)
  if (!command || !canInvokeFromTarget(event, command)) return
  event.preventDefault()
  command.invoke()
}

export function useEditorCommandShortcuts({
  commands,
  paletteOpen,
  sketchShortcutToolbarAvailable,
  sketchShortcutToolbarOpen,
  onPaletteOpenChange,
  onSketchShortcutToolbarOpenChange,
}: {
  commands: readonly ResolvedEditorCommand[]
  paletteOpen: boolean
  sketchShortcutToolbarAvailable: boolean
  sketchShortcutToolbarOpen: boolean
  onPaletteOpenChange: (open: boolean) => void
  onSketchShortcutToolbarOpenChange: (open: boolean) => void
}) {
  const commandsRef = useRef(commands)
  commandsRef.current = commands

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isPaletteShortcut(event)) {
        event.preventDefault()
        if (sketchShortcutToolbarOpen) onSketchShortcutToolbarOpenChange(false)
        onPaletteOpenChange(!paletteOpen)
        return
      }
      if (shouldIgnoreEditorShortcut(event) || paletteOpen) return
      if (
        consumeSketchShortcutToolbarKey({
          available: sketchShortcutToolbarAvailable,
          event,
          open: sketchShortcutToolbarOpen,
          onOpenChange: onSketchShortcutToolbarOpenChange,
        })
      )
        return
      invokeMatchingEditorCommand(event, commandsRef.current)
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [
    onPaletteOpenChange,
    onSketchShortcutToolbarOpenChange,
    paletteOpen,
    sketchShortcutToolbarAvailable,
    sketchShortcutToolbarOpen,
  ])
}
