import type { KeyboardEvent } from "react"
import { hasTextInputTarget } from "../commands/editor-text-input"
import { getProjectActiveWorkBlock } from "../document/document-controller"

function isDeleteGesture(event: KeyboardEvent<HTMLElement>) {
  return (
    !event.defaultPrevented &&
    (event.key === "Delete" || event.key === "Backspace") &&
    !event.repeat &&
    !event.nativeEvent.isComposing &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  )
}

function focusedTreeItem(event: KeyboardEvent<HTMLElement>) {
  const target = event.target
  if (!(target instanceof HTMLElement) || hasTextInputTarget(target)) return null
  if (target.getAttribute("role") !== "treeitem" || target !== document.activeElement) return null
  return event.currentTarget.contains(target) ? target : null
}

export function historyDeleteKeyboardTarget(event: KeyboardEvent<HTMLElement>) {
  if (!isDeleteGesture(event)) return null
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return null
  if (getProjectActiveWorkBlock() !== null) return null
  return focusedTreeItem(event)
}
