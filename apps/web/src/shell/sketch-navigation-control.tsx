import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import type { ResolvedEditorCommand } from "../commands/editor-command"
import {
  EditorCommandIconView,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"

export function SketchNavigationControl({ command }: { command: ResolvedEditorCommand }) {
  const copy = useEditorCommandCopy()
  const t = useTranslations("app.commands.items.sketchNavigateView")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
      <TooltipContent>{t("holdHint")}</TooltipContent>
    </Tooltip>
  )
}
