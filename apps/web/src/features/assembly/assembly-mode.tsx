import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { type ReactNode, useCallback, useState } from "react"
import { editorCommandIds, type ResolvedEditorCommand } from "../../commands/editor-command"
import type { DocumentControllerState } from "../../document/document-controller"
import { CommandToolbar } from "../../shell/command-toolbar"
import { AssemblyWorkspace } from "./assembly-workspace"

const assemblyCommands = new Set<string>([
  editorCommandIds.openShortcutHelp,
  editorCommandIds.documentUndo,
  editorCommandIds.documentRedo,
])
export function assemblyModeCommands(
  commands: readonly ResolvedEditorCommand[],
  assembly: boolean,
) {
  return assembly
    ? commands.filter(({ descriptor }) => assemblyCommands.has(descriptor.id))
    : commands
}
function AssemblyModeSwitch({
  active,
  disabled,
  onChange,
}: {
  active: boolean
  disabled: boolean
  onChange: (assembly: boolean) => void
}) {
  const t = useTranslations("app.assembly")
  return (
    <fieldset className="flex shrink-0 items-center gap-1 px-2" aria-label={t("mode")}>
      <Button
        type="button"
        variant={active ? "ghost" : "secondary"}
        size="sm"
        aria-pressed={!active}
        disabled={disabled}
        onClick={() => onChange(false)}
      >
        {t("modelMode")}
      </Button>
      <Button
        type="button"
        variant={active ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={active}
        disabled={disabled}
        onClick={() => onChange(true)}
      >
        {t("assemblyMode")}
      </Button>
    </fieldset>
  )
}
export function useAssemblyMode(switchWorkspace: (workspace: "model") => void) {
  const [active, setActive] = useState(false)
  const onChange = useCallback(
    (assembly: boolean) => {
      switchWorkspace("model")
      setActive(assembly)
    },
    [switchWorkspace],
  )
  return { active, onChange }
}
export function AssemblyToolbar({
  commands,
  active,
  controller,
  editing,
  onChange,
}: {
  commands: readonly ResolvedEditorCommand[]
  active: boolean
  controller: DocumentControllerState
  editing: { part: unknown; sketch: unknown }
  onChange: (assembly: boolean) => void
}) {
  const disabled =
    controller.status !== "ready" ||
    controller.saveStatus === "saving" ||
    Boolean(editing.part || editing.sketch)
  return (
    <div className="flex min-w-0 items-center border-b bg-panel">
      <div className="min-w-0 flex-1">
        <CommandToolbar commands={commands} />
      </div>
      <AssemblyModeSwitch active={active} disabled={disabled} onChange={onChange} />
    </div>
  )
}
export function AssemblyContent({
  active,
  controller,
  selectedPartId,
  children,
}: {
  active: boolean
  controller: DocumentControllerState
  selectedPartId: string | null
  children: ReactNode
}) {
  return active ? (
    <AssemblyWorkspace controller={controller} selectedPartId={selectedPartId} />
  ) : (
    children
  )
}
