import type { ParsedHotkey } from "@tanstack/hotkeys"
import { matchesKeyboardEvent, parseHotkey } from "@tanstack/hotkeys"
import { useEffect, useRef } from "react"
import {
  type EditorCommandShortcut,
  editorCommandIds,
  type ResolvedEditorCommand,
} from "./editor-command"

const parsedShortcuts = new WeakMap<EditorCommandShortcut, readonly ParsedHotkey[]>()
const paletteShortcut: EditorCommandShortcut = { key: "k", modifiers: ["mod"] }
const sketchShortcutToolbarShortcut: EditorCommandShortcut = { key: "s" }

function getParsedShortcuts(shortcut: EditorCommandShortcut) {
  const cached = parsedShortcuts.get(shortcut)
  if (cached) return cached

  const modifiers = new Set(shortcut.modifiers ?? [])
  const prefixes = [
    ...(modifiers.has("alt") ? ["Alt"] : []),
    ...(modifiers.has("shift") ? ["Shift"] : []),
  ]
  const modPrefixes = modifiers.has("mod") ? [["Control"], ["Meta"]] : [[]]
  const compiled = modPrefixes.map((modPrefix) =>
    parseHotkey([...modPrefix, ...prefixes, shortcut.key].join("+")),
  )
  parsedShortcuts.set(shortcut, compiled)
  return compiled
}

function hasTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return (
    target.matches(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
    ) ||
    target.closest("[contenteditable]:not([contenteditable='false']), [role='textbox']") !== null
  )
}

function matchesShortcut(event: KeyboardEvent, shortcut: EditorCommandShortcut) {
  return getParsedShortcuts(shortcut).some(
    (parsed) =>
      matchesKeyboardEvent(event, parsed, "windows") || matchesKeyboardEvent(event, parsed, "mac"),
  )
}

function isPaletteShortcut(event: KeyboardEvent) {
  return matchesShortcut(event, paletteShortcut)
}

function isSketchShortcutToolbarShortcut(event: KeyboardEvent) {
  return matchesShortcut(event, sketchShortcutToolbarShortcut)
}

function shouldIgnoreEditorShortcut(event: KeyboardEvent) {
  return event.defaultPrevented || event.isComposing || event.repeat
}

function isInsideModal(event: KeyboardEvent) {
  return (
    event.target instanceof Element &&
    event.target.closest(
      '[role="alertdialog"], [role="dialog"][aria-modal="true"], [data-slot="dialog-content"]',
    ) !== null
  )
}

function matchingEditorCommand(event: KeyboardEvent, commands: readonly ResolvedEditorCommand[]) {
  const matches = commands.filter(
    ({ descriptor, eligibility }) =>
      eligibility.enabled &&
      descriptor.shortcut !== undefined &&
      matchesShortcut(event, descriptor.shortcut),
  )
  return matches.length === 1 ? matches[0] : undefined
}

function canInvokeFromTarget(event: KeyboardEvent, command: ResolvedEditorCommand) {
  return (
    !hasTextInputTarget(event.target) ||
    command.descriptor.shortcut?.key === "Escape" ||
    command.descriptor.id === editorCommandIds.openShortcutHelp
  )
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
      if (hasTextInputTarget(event.target)) return false
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
      if (shouldIgnoreEditorShortcut(event) || isInsideModal(event)) return
      if (isPaletteShortcut(event)) {
        event.preventDefault()
        if (sketchShortcutToolbarOpen) onSketchShortcutToolbarOpenChange(false)
        onPaletteOpenChange(!paletteOpen)
        return
      }
      if (paletteOpen) return
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
