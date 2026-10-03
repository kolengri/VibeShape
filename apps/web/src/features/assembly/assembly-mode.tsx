import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { type ReactNode, useCallback, useState } from "react"
import { editorCommandIds, type ResolvedEditorCommand } from "../../commands/editor-command"
import type { DocumentControllerState } from "../../document/document-controller"
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
export function AssemblyModeSwitch({
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
