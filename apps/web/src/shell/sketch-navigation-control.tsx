import { Button } from "@vibeshape/ui/components/button"
import type { ResolvedEditorCommand } from "../commands/editor-command"
import {
  EditorCommandIconView,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"

export function SketchNavigationControl({ command }: { command: ResolvedEditorCommand }) {
  const copy = useEditorCommandCopy()
  return (
    <Button
      type="button"
      size="sm"
      variant={command.active ? "secondary" : "ghost"}
      aria-pressed={command.active}
      disabled={!command.eligibility.enabled}
      onClick={command.invoke}
    >
      <EditorCommandIconView icon={command.descriptor.icon} />
      {copy.label(command.descriptor)}
    </Button>
  )
}
