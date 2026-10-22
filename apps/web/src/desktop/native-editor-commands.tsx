import {
  type DesktopCommand,
  desktopApplicationCommandSchema,
  desktopEditorCommandSchema,
} from "@vibeshape/automation-api/desktop-host"
import { useBlockingActivity } from "@vibeshape/ui/components/activity"
import { useLayoutEffect, useRef } from "react"
import { editorCommandIds, type ResolvedEditorCommand } from "../commands/editor-command"
import { hasTextInputTarget } from "../commands/editor-text-input"
import { getDesktopHost } from "./desktop-host"

const commandIds = {
  createSketch: editorCommandIds.createSketch,
  createBox: editorCommandIds.createBox,
  createCylinder: editorCommandIds.createCylinder,
  createExtrusion: editorCommandIds.createExtrusion,
  createRevolve: editorCommandIds.createRevolve,
  createFillet: editorCommandIds.createFillet,
  createChamfer: editorCommandIds.createChamfer,
  measure: editorCommandIds.measure,
} as const

function resolveCommand(
  id: (typeof desktopEditorCommandSchema.options)[number],
  commands: readonly ResolvedEditorCommand[],
) {
  if (id === "undo" || id === "redo") {
    const sketch = editorCommandIds[id === "undo" ? "sketchUndo" : "sketchRedo"]
    const activeSketch = commands.find(
      (command) => command.descriptor.id === sketch && command.toolbarVisible,
    )
    return (
      activeSketch ??
      commands.find(
        (command) =>
          command.descriptor.id ===
          editorCommandIds[id === "undo" ? "documentUndo" : "documentRedo"],
      )
    )
  }
  return commands.find((command) => command.descriptor.id === commandIds[id])
}

export function NativeEditorCommandBridge({
  commands,
}: {
  commands: readonly ResolvedEditorCommand[]
}) {
  const host = getDesktopHost()
  const blocking = useBlockingActivity() !== null
  const pending = useRef(false)
  useLayoutEffect(() => {
    if (!host) return
    let active = true
    const publish = () => {
      const text = hasTextInputTarget(document.activeElement)
      const enabled = blocking
        ? []
        : desktopEditorCommandSchema.options.filter(
            (id) =>
              ((id === "undo" || id === "redo") && text) ||
              resolveCommand(id, commands)?.eligibility.enabled,
          )
      void host.updateCommandState({ scope: "editor", enabled }).catch(() => undefined)
    }
    const unsubscribe = host.onCommand((incoming) => {
      const parsed = desktopEditorCommandSchema.safeParse(incoming)
      if (!active || blocking || !parsed.success || pending.current) return
      const id = parsed.data
      const action = () => {
        if (!active || blocking) return undefined
        if ((id === "undo" || id === "redo") && hasTextInputTarget(document.activeElement))
          return host.editText(id)
        const command = resolveCommand(id, commands)
        if (command?.eligibility.enabled) return command.invoke()
        return undefined
      }
      pending.current = true
      void Promise.resolve()
        .then(action)
        .catch((error: unknown) => {
          console.error("Native editor command failed:", error)
        })
        .finally(() => {
          pending.current = false
          if (active) publish()
        })
    })
    publish()
    document.addEventListener("focusin", publish)
    document.addEventListener("focusout", publish)
    return () => {
      active = false
      unsubscribe()
      document.removeEventListener("focusin", publish)
      document.removeEventListener("focusout", publish)
      void host.updateCommandState({ scope: "editor", enabled: [] }).catch(() => undefined)
    }
  }, [blocking, commands, host])
  return null
}

export function NativeApplicationCommandBridge({
  exportAvailable,
  onCommand,
  allowedCommands = desktopApplicationCommandSchema.options,
}: {
  exportAvailable: boolean
  allowedCommands?: readonly (typeof desktopApplicationCommandSchema.options)[number][]
  onCommand: (
    command: Extract<DesktopCommand, "projects" | "export" | "settings" | "faq" | "shortcuts">,
  ) => void
}) {
  const host = getDesktopHost()
  const blocking = useBlockingActivity() !== null
  useLayoutEffect(() => {
    if (!host) return
    let active = true
    const enabled = blocking
      ? []
      : desktopApplicationCommandSchema.options.filter(
          (id) => allowedCommands.includes(id) && (id !== "export" || exportAvailable),
        )
    void host.updateCommandState({ scope: "application", enabled }).catch(() => undefined)
    const unsubscribe = host.onCommand((id) => {
      if (!active || blocking) return
      const command = desktopApplicationCommandSchema.safeParse(id)
      if (command.success && enabled.includes(command.data)) onCommand(command.data)
    })
    return () => {
      active = false
      unsubscribe()
      void host.updateCommandState({ scope: "application", enabled: [] }).catch(() => undefined)
    }
  }, [blocking, host, exportAvailable, onCommand, allowedCommands])
  return null
}
