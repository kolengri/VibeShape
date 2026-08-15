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

function shouldIgnoreEditorShortcut(event: KeyboardEvent, paletteOpen: boolean) {
  return paletteOpen || event.defaultPrevented || event.isComposing || event.repeat
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

export function useEditorCommandShortcuts({
  commands,
  paletteOpen,
  onPaletteOpenChange,
}: {
  commands: readonly ResolvedEditorCommand[]
  paletteOpen: boolean
  onPaletteOpenChange: (open: boolean) => void
}) {
  const commandsRef = useRef(commands)
  commandsRef.current = commands

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isPaletteShortcut(event)) {
        event.preventDefault()
        onPaletteOpenChange(!paletteOpen)
        return
      }
      if (shouldIgnoreEditorShortcut(event, paletteOpen)) return
      const command = matchingEditorCommand(event, commandsRef.current)
      if (!command || !canInvokeFromTarget(event, command)) return
      event.preventDefault()
      command.invoke()
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onPaletteOpenChange, paletteOpen])
}
